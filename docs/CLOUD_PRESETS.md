# Cloud sync for user visualizer presets — design note (0.9.15)

## Scope

The flat user preset store only: the `.json` / `.milk` files a user dropped or
converted into `<app_data>/presets/` (what `presets_list` returns). Explicitly
out of scope: marketplace-installed presets (`presets/marketplace/<id>/` —
those already have a cloud source of truth and reinstall from it), bundles,
and any other settings. One cloud store per marketplace account, not per
device or per profile.

## Sync model — manual push/pull, local wins

No background sync, no timers, no merge machinery. Two explicit actions:

- **Back up** (push): every local user preset whose sha256 differs from (or is
  absent in) the cloud list is uploaded; identical files are skipped. Uploads
  overwrite the cloud copy — the cloud store is "latest backup", not a
  history. Nothing is ever deleted from the cloud by a push.
- **Restore** (pull): every cloud preset that does **not** exist locally is
  downloaded and written. A file that exists on both sides with different
  content is a conflict, and **local wins** — the file is skipped and counted,
  never overwritten. Restoring is therefore always safe to click.

The result line reports both directions honestly: "Backed up 3 (11 already up
to date)", "Restored 2 · kept 1 local file that differs from the cloud copy".

Rationale: presets are small standalone files with filename identity; the
failure a user actually fears is a sync silently clobbering a preset they
tweaked. Manual + local-wins makes both actions idempotent and unsurprising.
An automatic model can layer on top later without changing the protocol.

## Storage

Server (the in-repo marketplace server, axum + SQLite): new table

```sql
user_presets (
  user_id    INTEGER NOT NULL,
  file       TEXT    NOT NULL,   -- filename only, validated
  content    BLOB    NOT NULL,   -- the preset text bytes
  sha256     TEXT    NOT NULL,
  size       INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, file)
)
```

Stored in the DB, not a directory — same reasoning as avatars (avatar.rs):
one file to back up, and no filesystem paths derived from user input.

### Endpoints (all bearer-authed via `auth::bearer_user`)

- `GET  /account/presets` → `{ presets: [{ file, sha256, size, updatedAt }] }`
  (list only, no content — push diffs against this).
- `POST /account/presets` `{ file, content: base64 }` → upsert one preset.
- `POST /account/presets/get` `{ file }` → `{ file, content: base64 }`.
- `POST /account/presets/delete` `{ file }` → remove one (quota remedy; no
  client UI in v1, but the server contract shouldn't need a version bump to
  add one). POST-body addressing (not `/:file` path params) because preset
  filenames contain spaces/parentheses and the rest of this API is
  POST-shaped (`/notifications/read`, `/admin/decide`).

### Server-side validation & quota

- Filename: same rule as the client's `is_safe_name` (no separators, no `..`,
  no leading dot), plus: ≤ 120 chars and a `.json` / `.milk` extension
  (case-insensitive). The server never trusts the client either.
- Per-file cap 256 KB (a large Butterchurn JSON is ~50 KB), 200 files and
  10 MB total per user; exceeding any returns a 4xx whose body message the
  client surfaces verbatim.

## Client (Rust: `presets_cloud.rs` beside `presets.rs`)

Three async commands (blocking HTTP in `spawn_blocking`, per the
sync-command rule), registered in lib.rs + app-commands.toml:

- `presets_cloud_list(url)` → the cloud manifest.
- `presets_cloud_push(url)` → reads local files (`presets_dir`), diffs by
  sha256, uploads; returns `{ uploaded, skipped }`.
- `presets_cloud_pull(url)` → downloads cloud-only files; returns
  `{ downloaded, conflicts }`.

Auth reuses `marketplace.rs`'s existing plumbing exactly: the session token is
resolved Rust-side via `session_token()` (DPAPI secret store — it never
crosses IPC), requests go through `get_capped_auth` / `post_capped_json`
(https-only, redirects(0), capped reads). Those helpers become `pub(crate)`.
The server URL arrives as a command arg from `cfgUrl()`, the same shape as
`marketplace_rate`.

**Pull hardening (the note this feature was specced with):** every filename in
a server response is re-validated with `is_safe_name` + the extension
whitelist before any write, and content is size-capped, so a hostile or
corrupted server can never write outside the presets dir or fill the disk.
Names that fail validation are skipped and counted as conflicts.

## UI entry points

One shared component, `PresetCloudSync` (in viz-milkdrop.tsx), rendered in
both specced places:

- the **preset picker**'s user-presets section (under the drop-folder hint);
- **Settings → Visualizer**, a "Preset cloud backup" row after the Style /
  Album-art rows.

Signed out (or in browser dev, no Tauri): the buttons are replaced by a hint —
"Sign in to the marketplace (Community tab) to back up presets." Offline or
server errors: the command's error string shows inline; no state is changed.

## Verified against the codebase before implementing

- `presets.rs::presets_dir` + `is_safe_name` exist as described; user store
  is flat files, marketplace presets live in an excluded subfolder.
- `marketplace.rs` has `session_token`, `get_capped_auth`, `post_capped_json`
  (private today; this note is the reason they go pub(crate)).
- `marketplaceAuth.ts` exposes `useMarketplaceAuth` state and `cfgUrl()`
  (marketplaceConfig.ts) — the UI can gate on signed-in without touching
  tokens.
- The server is the in-repo axum app with `bearer_user`, `state.db.lock()`,
  and base64-blob JSON bodies as the established pattern (avatar.rs); new
  tables are created via `CREATE TABLE IF NOT EXISTS` in db.rs::init (new
  tables do get created on existing DBs; only new columns need the ALTER
  path).

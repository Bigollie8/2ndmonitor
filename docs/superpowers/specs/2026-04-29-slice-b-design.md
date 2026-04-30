# Slice B — Design

**Date:** 2026-04-29
**Project:** 2ndmonitor (`C:\Users\bigol\Documents\Projects\2ndmonitor\app`)
**Scope:** Two unrelated-but-similar-sized features bundled because each is too small for its own slice.

## Features

1. **Discord voice controls fix** — Mute / Deafen / Leave buttons currently appear to do nothing. Diagnose, surface errors, and verify the IPC round-trip actually completes.
2. **Real profile system** — Replace the cosmetic top-chrome profile buttons with a working profile system that owns layout + tile visibility. User can create, rename, delete, recolor profiles. The existing `ProfileSwitcher` overlay gets wired up.

## Out of scope

- Per-profile todos / weather / viz settings (user explicitly chose: those stay global).
- Auto-switching profile based on focused app / fullscreen game (the existing UI hints at this — defer to later).
- Profile import / export.

---

## Feature 1: Discord voice controls

### Diagnosis

The current `discord_rpc_set_voice_settings` and `discord_rpc_leave_voice` commands write the IPC frame and return `Ok(())` immediately. They never wait for Discord's response. If Discord rejects the frame (rate-limit, permission, malformed payload, no active voice session), the error is logged to stderr but never surfaces to the user. The toggle button doesn't change because Discord didn't actually flip the state and didn't send back a `VOICE_SETTINGS_UPDATE` event.

### Fix

Add **nonce-keyed response tracking**:

- A `static PENDING: Mutex<HashMap<String, Sender<Value>>>` in `discord_rpc.rs`. When a Tauri command writes a frame with nonce `N`, it inserts `(N, tx)` into the map and `await`s on `rx`.
- The IPC read loop, on every received frame, checks if `msg.nonce` is in PENDING. If yes, send the parsed value through the channel and remove the entry.
- Commands return after either: (a) a response arrives (transformed to `Result<(), String>` based on whether `evt == "ERROR"`), or (b) a 2-second timeout (returns `"Discord did not respond"`). 2 seconds is plenty for a local IPC.
- Frontend `discordVoice.setMute / setDeaf / leave` already use try/catch with empty handlers; switch to surface the error into a transient banner inside `VoiceSection` (a small red strip at the top of the voice section that fades after 5 seconds).

### Why this is enough

Once errors surface, one of two things happens:
- The user sees the actual error message ("missing scope", "rate limited", "no active voice session", whatever) and we have a real bug to fix.
- The buttons start working — meaning the silent-error suspicion was right and surfacing them was sufficient.

Either way, we make progress instead of guessing.

### Files

- Modify: `app/src-tauri/src/discord_rpc.rs` — add `PENDING` map, response routing in read loop, await-with-timeout in `set_voice_settings` and `leave_voice`.
- Modify: `app/src/components/discord-tile.tsx` — add a `voiceError` state in `VoiceSection`, set it from the catch blocks, render a small dismissible banner above the buttons.

### Risks

- Channels with already-resolved senders: if Discord drops the connection between write and read, the sender hangs forever. Use `tokio::time::timeout` or a manual `recv_timeout` (we're using std threads + Mutex, so use `crossbeam-channel` or a 200ms-poll loop).
- `parking_lot::Mutex` doesn't poison, so we don't need `unwrap()` ceremony.
- The read loop in `run_session` already runs on a worker thread and doesn't know about Tokio. Use `std::sync::mpsc` (or `crossbeam-channel` if already a dep) and a poll-with-timeout pattern. Don't add tokio dep just for this.

---

## Feature 2: Real profile system

### Data model

```ts
// new
export interface Profile {
  id: string;       // crypto.randomUUID()
  name: string;     // user-editable, e.g. "Work"
  color: string;    // hex, used as accent in the switcher card and top-chrome button
  layout: Layout;   // (Partial<Record<TileId, Rect>>) — moved from top-level
  hidden: Partial<Record<TileId, boolean>>;  // moved from top-level
}
```

### Persistence schema change

**Before** (current TweakState):

```ts
{ vizMode, accentTheme, density, hidden, layout, vizArtBg, vizSensitivity,
  vizSmoothing, vizColorOverride, todos, weatherLocation }
```

**After:**

```ts
{
  // GLOBAL app settings (unchanged)
  vizMode, accentTheme, density, vizArtBg, vizSensitivity, vizSmoothing,
  vizColorOverride, todos, weatherLocation,

  // NEW: profile system
  activeProfileId: string,
  profiles: Profile[],
}
```

`hidden` and `layout` move OUT of the top-level TweakState and INTO the active profile.

### Migration (one-shot, on load)

In `useTweaks` (or a wrapper), after the load+merge:

```pseudo
if (loaded has top-level `layout` or `hidden` AND not `profiles`):
  // legacy shape — migrate
  oldLayout = loaded.layout ?? {}
  oldHidden = loaded.hidden ?? {}
  workId = uuid(); gamingId = uuid(); chillId = uuid()
  next = { ...loaded,
    layout: undefined, hidden: undefined,
    activeProfileId: workId,
    profiles: [
      { id: workId,   name: 'Work',   color: '#a78bfa', layout: oldLayout, hidden: oldHidden },
      { id: gamingId, name: 'Gaming', color: '#f59e0b', layout: {},        hidden: {} },
      { id: chillId,  name: 'Chill',  color: '#22d3ee', layout: {},        hidden: {} },
    ],
  }
  setValues(next); persist
```

Migration runs once. After it completes, future loads see `profiles` and skip the migration block.

### Active profile selectors

`App.tsx` reads `activeLayout` and `activeHidden` from the active profile:

```ts
const activeProfile = t.profiles.find((p) => p.id === t.activeProfileId) ?? t.profiles[0]!;
const activeLayout = activeProfile.layout;
const activeHidden = activeProfile.hidden;
```

When edits happen (`setHidden`, `<TileFrame onChange>`, `<EditModeOverlay setLayout>`, "Reset layout"), they update the active profile's fields:

```ts
const updateActiveProfile = (patch: Partial<Profile>) => {
  setTweak('profiles', t.profiles.map((p) =>
    p.id === t.activeProfileId ? { ...p, ...patch } : p
  ));
};
```

### Switching profiles

`switchProfile(id)` simply sets `activeProfileId`. The next render reads the new layout. No animation in this slice.

Cmd+1/2/3 keyboard shortcut (already exists) becomes "pick the Nth profile in the list, no-op if it doesn't exist."

### Top-chrome buttons

Currently hardcoded `<button>Work</button> <button>Gaming</button> <button>Chill</button>`. Becomes:

```tsx
{t.profiles.slice(0, 4).map((p) => (
  <button key={p.id} onClick={() => switchProfile(p.id)} ...>{p.name}</button>
))}
{t.profiles.length > 4 && <button onClick={onSwitcher}>+{t.profiles.length - 4}</button>}
```

The "⌃ More" button still opens the full switcher.

### ProfileSwitcher rewrite

Replace the cosmetic-only `ProfileSwitcher` overlay (`profile.tsx`) with a real one. Each card shows:

- Live SVG preview rendered from the profile's actual layout (small rectangles for each tile in `profile.layout`, fall back to `DEFAULT_LAYOUT` for missing entries). Render at 480×270 viewbox scaled from the 2560×1440 canvas.
- Editable name (click to edit inline → input → blur/Enter to commit).
- Color swatch (click → `<input type="color">` opens).
- Trash icon to delete (confirms via `window.confirm`; disabled if it's the only profile).
- "+ New profile" card at end: clones current profile's layout/hidden, name "Profile N", random pleasant color. Selected automatically.

Drop the cosmetic `subtitle` and `tileCount` fields — they were always fake.

Drop the existing hardcoded `ProfilePreview` SVG branches; replace with a single generic preview from layout data.

Drop the "Profiles auto-switch on app focus rules…" placeholder text — that feature isn't shipping in this slice.

### Files

- Modify: `app/src/types.ts` — add `Profile` interface; remove `Profile = 'work' | 'gaming' | 'chill'` (the type alias is replaced by a string id).
- Modify: `app/src/state/useTweaks.ts` — add migration step for the schema change.
- Modify: `app/src/App.tsx` — TweakState schema change; replace `hidden`/`layout` reads with active-profile-derived versions; replace `setHidden`/layout setters with `updateActiveProfile`; update `TopChrome` buttons; update keyboard shortcut.
- Rewrite: `app/src/components/profile.tsx` — new ProfileSwitcher with live preview, create/rename/delete/recolor.

### Risks

- Migration must be idempotent and safe to run on a partial JSON. Acceptance: write the migration as "if `profiles` is missing or empty, run; otherwise no-op." Don't try to be clever.
- `setSelectedTileId` from Phase 5 is not a profile concern — it's transient runtime state. Stays as-is.
- The `vizColorOverride` was kept global; users picking a per-profile color was rejected. Make sure no migration step tries to move it.
- "Top 4 profiles" in top-chrome is arbitrary — feel free to bump if you have 5+ short names.

---

## Implementation order

1. **Discord fix** (Phase B-1) — small, contained, ~150 lines of Rust + ~30 lines of TS.
2. **Profile data model + migration** (Phase B-2) — schema change + migration. Test by hand-editing tweaks.json.
3. **App.tsx wiring + top-chrome dynamic buttons** (Phase B-3) — switch reads/writes to active profile.
4. **ProfileSwitcher rewrite** (Phase B-4) — UI work for create/rename/delete/recolor.

Each phase is independently shippable. If anything looks too big, split.

---

## Testing

Manual smoke after each phase:

- Discord: clicking Mute when not in a voice channel should now show a clear error message instead of silently failing. Mute/Deafen/Leave while in a real voice channel should now successfully toggle the indicator on the user's pill.
- Profile migration: open existing tweaks.json (post slice A), launch app — verify it gets migrated to the new schema with 3 profiles, "Work" containing the existing layout/hidden.
- Switching: switch profile in top-chrome → tile layout changes immediately. Drag a tile → returns to original profile, layout unchanged. Switch back → drag persisted.
- Create/delete/rename: standard CRUD flow.
- Cmd+1/2/3 picks the Nth profile.

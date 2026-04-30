# Slice C — Design

**Date:** 2026-04-29
**Project:** 2ndmonitor (`C:\Users\bigol\Documents\Projects\2ndmonitor\app`)
**Scope:** Time-synced lyrics on the visualizer + a real Spotify queue ("Up next") in the Spotify tile.

## Features

1. **Lyrics** (via LRCLIB) — fetched per track; rendered as (a) a floating current-line overlay on the viz hero, (b) a scrollable lyrics panel inside the Spotify tile.
2. **Spotify Up next** (via Spotify Web API) — OAuth PKCE → polling `/me/player/queue` → list of next tracks in the Spotify tile.

## Out of scope

- Lyrics editing/correction submissions to LRCLIB.
- Manual offset adjustment for time-sync.
- Karaoke-style word-level highlighting (LRC format is line-level only).
- Spotify playback control (play / pause / next-track-API). GSMTC + the existing media commands already cover that.
- Spotify search / browse / playlists. Out of scope.

---

## Two phases, independently shippable

**C-1 (Lyrics):** no auth, works for any GSMTC source (Spotify, Apple Music, browser, local players). Ships first.

**C-2 (Spotify Up next):** OAuth dance, only works for Spotify Premium. Ships second. Doesn't depend on C-1.

---

## Phase C-1 — Lyrics

### Data flow

```
GSMTC tick (artist/title changed) → lyrics worker → LRCLIB GET
                                                  → emit lyrics:update event
                                                                ↓
                                  frontend useLyrics() updates state
                                                                ↓
                                  LyricsOverlay (viz hero) + LyricsPanel (Spotify tile tab)
```

### LRCLIB integration

Endpoint: `https://lrclib.net/api/get?track_name=X&artist_name=Y&album_name=Z&duration=N`

Response (200):
```json
{ "id": 123, "trackName": "...", "artistName": "...", "albumName": "...",
  "duration": 234, "instrumental": false,
  "plainLyrics": "...", "syncedLyrics": "[00:12.34]first line\n[00:15.78]second line\n..." }
```

Response 404 → no lyrics found. Treat as null.

We pass `duration` (float seconds, rounded). LRCLIB uses it for fuzzy match.

### Rust module: `app/src-tauri/src/lyrics.rs`

```rust
pub struct Lyrics {
    pub track_key: String,    // "artist|title|album"
    pub synced_lrc: Option<String>,
    pub plain_lyrics: Option<String>,
}
```

- Owns one worker thread.
- Receives `(artist, title, album, duration_secs)` over an `mpsc::channel` from `nowplaying.rs`.
- Caches the last-fetched `track_key` to dedupe.
- On change, calls LRCLIB; emits `lyrics:update` (or `lyrics:clear` on 404).
- Caches up to 50 results in a small LRU keyed by `track_key` so seeking back to a recent track is instant.

### Hook: `app/src-tauri/src/nowplaying.rs` integration

Add a `Sender<TrackInfo>` parameter passed to `nowplaying::spawn` from `lib.rs`. On every emit, if `(artist, title, album)` changed since last emit, send to the channel. The lyrics worker debounces and fetches.

### Frontend module: `app/src/state/lyrics.ts`

```ts
export interface LrcLine { tsMs: number; text: string }

export function parseLrc(lrc: string): LrcLine[] {
  // [mm:ss.xx]text → { tsMs: ms, text }
  // Multiple [mm:ss.xx] tags on one line: emit one entry per tag.
  // Lines without a timestamp are dropped.
  // Unsynced metadata tags like [ar:Artist], [ti:Title], [length:...]: dropped.
}

export interface LyricsState {
  trackKey: string | null;
  syncedLines: LrcLine[];   // empty if no synced
  plainLines: string[];     // for fallback display
}

export function useLyrics(): LyricsState { ... }

/** Returns the current synced line index (or -1) given a parsed LRC and the
 *  current playback position in seconds. */
export function currentLineIndex(lines: LrcLine[], positionSecs: number): number { ... }
```

LRC parsing rules (terse):
- Match `/^\[(\d+):(\d+(?:\.\d+)?)\]/` → `tsMs = (mm*60 + ss) * 1000`.
- Multiple timestamps per line: `[00:01.50][00:30.00]chorus` → emit two entries.
- Tag lines `[ar:...]`, `[ti:...]`, `[length:...]`, `[al:...]`, `[by:...]`, `[offset:...]` → drop.
- Empty text after timestamp is fine (acts as a pause marker). Keep it.
- Sort by `tsMs` ascending.

### UI: `<LyricsOverlay>` on viz hero

- Lives inside `VizHero`, between the gradient overlay (z=2) and the `VizOverlay` controls (z=3) — i.e., new layer at z=2.5 with `pointer-events: none`.
- Renders the **current line** large at the top-center of the viz: ~32px font, weight 600, accent color tint, drop-shadow for legibility over busy viz.
- Crossfade between lines: when current index changes, fade out old line over 300ms, fade in new line over 300ms (overlapping is fine).
- Hides entirely when:
  - No `playback.playing` (paused/stopped), OR
  - No synced lyrics for this track, OR
  - User toggled lyrics off (new tweak: `lyricsOverlayEnabled`, default true).
- A new `<TweakSection>` "Lyrics" with one checkbox controls `lyricsOverlayEnabled`.

### UI: Spotify tile gains a tab strip

The current `SpotifyTile` is a single-view "now playing" card. Add a tab strip at the top with three tabs:
- **Now** (default) — the existing now-playing UI moves under this tab.
- **Lyrics** — scrollable column of lines. Current line is highlighted (accent + bold). Auto-scroll keeps current line ~1/3 from top of viewport. If only `plainLyrics` exists, render those without highlight (no time-sync).
- **Up next** — disabled / "Connect Spotify in Tweaks → Spotify" placeholder until C-2 lands.

Tabs are visually small (10px font, JetBrains Mono, accent underline on active). Tab state is local to the tile (not persisted in tweaks).

### Files

- Create: `app/src-tauri/src/lyrics.rs`
- Modify: `app/src-tauri/src/nowplaying.rs` — emit track changes to lyrics worker
- Modify: `app/src-tauri/src/lib.rs` — register lyrics module
- Create: `app/src/state/lyrics.ts` — hook + LRC parser
- Modify: `app/src/components/viz.tsx` — `<LyricsOverlay>` inside `VizHero`
- Modify: `app/src/components/tiles.tsx` — `SpotifyTile` gains tabs + lyrics view
- Modify: `app/src/App.tsx` — add `lyricsOverlayEnabled` to TweakState; thread to `<VizHero>`; add Tweaks panel checkbox

### Risks

- **LRCLIB rate limiting**: per their docs, soft limit ~600 req/hour. Cache aggressively. Don't refetch on seek; only on track change.
- **Lyrics drift**: GSMTC position can lag by ~500ms; the overlay uses `playback.positionAtSync + (now - syncedAt)` interpolation already in place for the bar visualization, so we get ms-level precision.
- **No-lyrics tracks**: emit `lyrics:clear`, frontend hides overlay and shows "No lyrics found" in the tab.
- **Instrumental tracks**: LRCLIB returns `instrumental: true`. Show "♪ Instrumental" placeholder — don't try to render empty lyrics.

---

## Phase C-2 — Spotify Up next

Mirrors the existing Discord OAuth pattern (`app/src-tauri/src/discord.rs`).

### OAuth flow

1. User goes to `developer.spotify.com`, creates an app, copies the Client ID, adds redirect URL `http://localhost:14202/callback`.
2. User pastes Client ID into a "Spotify" section in the Tweaks panel (or a dedicated connect-flow inside the Spotify tile when not connected).
3. App generates a PKCE verifier, opens browser to:
   `https://accounts.spotify.com/authorize?client_id=X&response_type=code&redirect_uri=http://localhost:14202/callback&code_challenge_method=S256&code_challenge=Y&scope=user-read-currently-playing+user-read-playback-state`
4. Local server on port 14202 catches the callback, exchanges code for token at `https://accounts.spotify.com/api/token`.
5. Stores `{ client_id, access_token, refresh_token, expires_at }` in `app_config_dir()/spotify.json` (mirrors `discord.json`).

### Polling

Worker thread, every 10 seconds when connected:
- `GET https://api.spotify.com/v1/me/player/queue` with `Authorization: Bearer <token>`.
- Response: `{ currently_playing: {...}, queue: [{...}, ...] }`.
- We only use `queue[]` — we already have current track from GSMTC.
- On 401: refresh token via `https://accounts.spotify.com/api/token` (POST grant_type=refresh_token).
- On 403/404 (account isn't Premium, or no active player): emit empty queue + status flag.
- Emit `spotify:queue` event.

### Rust module: `app/src-tauri/src/spotify.rs`

Same shape as `discord.rs`:
- `static CREDS: Lazy<Mutex<StoredCreds>>` with persistence.
- `static STATE: Lazy<Mutex<SpotifyState>>` with `connected`, `connecting`, `error`, `queue`.
- Tauri commands: `spotify_connect(client_id)`, `spotify_disconnect()`, `spotify_status()`, `spotify_get_client_id()`.
- Local OAuth server using `tiny_http` (already a dep, used by Discord).

### Frontend hook: `app/src/state/tauri.ts`

Add:

```ts
export interface SpotifyTrack {
  id: string;
  title: string;
  artist: string;
  album: string;
  art_url: string | null;
  duration_ms: number;
}
export interface SpotifyState {
  connected: boolean;
  connecting: boolean;
  error: string | null;
  queue: SpotifyTrack[];
  /** True if the auth succeeded but the user isn't Premium / endpoint returned 403. */
  premium_required: boolean;
}

export function useSpotify(): {
  state: SpotifyState;
  connect: (clientId: string) => Promise<void>;
  disconnect: () => Promise<void>;
  getStoredClientId: () => Promise<string | null>;
};
```

### UI

Inside `SpotifyTile`'s "Up next" tab (which becomes enabled once C-2 lands):

- If not connected: a card explaining "Connect Spotify to see your queue" with a Connect button (same flow as Discord tile's connect view).
- If connected but `premium_required`: a card explaining "Spotify Premium required for queue access".
- Otherwise: scrollable list of next ~10 tracks. Each row: 32×32 album art, title (bold), artist (dimmed), small duration on the right.

### Files

- Create: `app/src-tauri/src/spotify.rs`
- Modify: `app/src-tauri/src/lib.rs` — register spotify module + commands
- Modify: `app/src/state/tauri.ts` — `useSpotify` hook + types
- Modify: `app/src/components/tiles.tsx` — wire Up next tab
- (Optional) Modify: `app/src/components/spotify-tile.tsx` if we extract the tile into its own file — see below.

### Tile size considerations

The Spotify tile is currently a small rail tile. Now that it has 3 tabs (Now / Lyrics / Up next), it might need more vertical space. Two options:

- **(a)** Keep current size; tabs add a 24px header strip; content area is just slightly smaller.
- **(b)** Bump the default rail row weight for `spotify` from 1.0 → 1.4 in `DEFAULT_LAYOUT` so the tile gets ~40% more height.

Pick **(a)** — users who want more space can resize via edit mode.

### Risks

- **OAuth callback port collision**: Discord uses 14201; Spotify uses 14202. If a user has a third tool on 14202, the connect button fails with a clear error. Acceptable for personal use.
- **Token leakage in tweaks.json**: tokens go to `spotify.json` (separate file in `app_config_dir`), not tweaks.json. They're not visible in the migrated tweaks blob.
- **Spotify dev app rate limits**: Spotify is generous for personal-use apps. 10s poll * 6 hours = 2160 requests, comfortably under limits.
- **`/me/player/queue` returns empty when nothing is playing**: handle that — show "Nothing queued" placeholder.

---

## Implementation order

1. **C-1 Phase 1 — Lyrics backend** — `lyrics.rs`, channel from `nowplaying.rs`, register module. Test by running app + console-log emitted events.
2. **C-1 Phase 2 — Lyrics frontend hook + parser** — `state/lyrics.ts` with parseLrc, useLyrics, currentLineIndex.
3. **C-1 Phase 3 — Lyrics overlay on viz** — `<LyricsOverlay>` component, integrate into `VizHero`, add `lyricsOverlayEnabled` tweak.
4. **C-1 Phase 4 — Lyrics tab in Spotify tile** — refactor SpotifyTile to use tabs, add `<LyricsPanel>`.
5. **C-2 Phase 1 — Spotify OAuth backend** — `spotify.rs` mirrors `discord.rs`, store tokens, `spotify_connect`/`spotify_status`/`spotify_disconnect`.
6. **C-2 Phase 2 — Spotify queue polling** — `/me/player/queue`, token refresh on 401, emit `spotify:queue`.
7. **C-2 Phase 3 — Up next UI** — wire the tab content to `useSpotify()`.

C-1 ships standalone (commits 1-4). C-2 ships standalone (commits 5-7). Each phase is a single subagent dispatch.

## Testing approach

Manual smoke after each phase:

- **C-1**: play a known-popular track (any source) → lyrics overlay appears + Spotify tile lyrics tab populates with synced lines highlighted on the current one.
- **C-1**: play an obscure track → "No lyrics found" placeholder; viz overlay hidden.
- **C-1**: switch tracks rapidly → lyrics worker dedupes, no rate-limit errors.
- **C-2**: connect Spotify, queue some songs → "Up next" tab shows the queue.
- **C-2**: connect with a non-Premium account → "Premium required" message.
- **C-2**: disconnect → tab returns to connect prompt.

## Risks summary (across phases)

- LRCLIB downtime → "No lyrics found" UX kicks in. Acceptable.
- Spotify API outage → queue stays stale until next successful poll. Acceptable.
- Both phases together touch the SpotifyTile, which is one of the busier components. The tab refactor is the highest-risk visual change. Mitigation: get the tab structure landed in C-1, so C-2 just slots into the existing Up next tab.

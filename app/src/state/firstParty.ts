// ─────────────────────────────────────────────────────────────────────────────
// Which catalog items cannot be marketplace bundles.
//
// Rule: an item is first-party if and only if it needs a capability the
// sandbox does not expose — local system access, an OS media API, or a
// transport other than `fetch`. An item that only needs HTTP is a bundle
// target even if it currently reaches the network through a Rust proxy
// command; those proxies exist for CORS, and `net:<host>` replaces them.
//
// This is a security boundary, not a convenience list. Adding an id here
// because migrating it is awkward is a misuse; adding one because sandboxed
// code would need `tauri:` access is correct. BROKER_COMMANDS stays empty.
// ─────────────────────────────────────────────────────────────────────────────

/** Tiles whose data comes from Rust. Each entry names the blocking capability. */
export const FIRST_PARTY_TILES = [
  'viz',          // live audio spectrum/waveform (audio.rs)
  'spotify',      // GSMTC session (nowplaying.rs, spotify.rs, lyrics.rs)
  'mixer',        // per-app volume via WASAPI/COM (mixer.rs)
  'sysmon',       // CPU/RAM/GPU counters (sysmon.rs)
  'discord',      // Discord IPC pipe (discord_rpc.rs)
  'claude',       // reads local session files (claude.rs)
  'streamDeck',   // dispatches app actions (actions.rs)
  'activeWindow', // foreground-window tracking (foreground.rs)
  'docker',       // local Docker socket (docker_tile.rs)
  'streamChat',   // Twitch IRC over WebSocket; sandbox CSP is default-src 'none'
] as const;

/** Visualizer entries that are engines, not styles: one hosts a bundled
 *  library and preset store, the other is the surface that authors bundles.
 *  Neither can meaningfully become a bundle itself. */
export const FIRST_PARTY_VIZ = ['milkdrop', 'scripted'] as const;

const TILES = new Set<string>(FIRST_PARTY_TILES);
const VIZ = new Set<string>(FIRST_PARTY_VIZ);

export function isFirstParty(kind: 'tile' | 'visualizer', id: string): boolean {
  return kind === 'tile' ? TILES.has(id) : VIZ.has(id);
}

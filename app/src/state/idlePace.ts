// ─────────────────────────────────────────────────────────────────────────────
// Idle frame-rate staging for the visualizer (0.9.15).
//
// The 0.9.6 idle gate fixed the RUST half of "app open, nothing playing":
// during sustained silence the audio thread stops FFTs and emits. But the
// FRONTEND half kept running — the procedural 120bpm fallback animates at the
// full display rate for as long as the window is visible, which on an
// always-visible second monitor is forever. Measured on the packaged app
// (0.9.14, MilkDrop style, nothing playing): ~100% of a core in the WebView
// GPU process + ~50% renderer, and ~0.85 MB/s of frame-payload churn in the
// main page whose GC cycles read as the reported CPU sawtooth.
//
// Policy, tuned to stay invisible: the moment real audio ends the fallback
// keeps the full rate for IDLE_AFTER_MS (so pause/track-change gaps never
// degrade), then drops to IDLE_FPS — the idle animation is a slow breathe and
// 30fps is visually indistinguishable for it — and after DEEP_IDLE_AFTER_MS
// of continuous silence settles at DEEP_IDLE_FPS. Any live frame restores the
// full rate instantly (the next tick sees live and resets the clock).
// ─────────────────────────────────────────────────────────────────────────────

export const IDLE_AFTER_MS = 10_000;
export const IDLE_FPS = 30;
export const DEEP_IDLE_AFTER_MS = 120_000;
export const DEEP_IDLE_FPS = 12;

/** The pure decision: given how long real audio has been absent, the FPS cap
 *  the idle stage imposes — or null for "no idle cap" (full rate). */
export function idleFpsCap(idleForMs: number): number | null {
  if (idleForMs < IDLE_AFTER_MS) return null;
  return idleForMs >= DEEP_IDLE_AFTER_MS ? DEEP_IDLE_FPS : IDLE_FPS;
}

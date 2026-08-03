// ─────────────────────────────────────────────────────────────────────────────
// Streamer mode (0.7.1 §2): pure display helpers. The tweak flag lives in
// App's TweakState; this module is the single definition of what "redacted
// location text" looks like, so every render site masks identically.
// ─────────────────────────────────────────────────────────────────────────────

/** What every masked location string renders as. */
export const REDACTED_TEXT = '•••';

/** Mask a location-revealing display string while streamer mode is on.
 *  Presentation only — never feed the result back into persisted state. */
export function redactLocation(text: string, on: boolean): string {
  return on ? REDACTED_TEXT : text;
}

// ─────────────────────────────────────────────────────────────────────────────
// Auto-update prompt gating — the pure decision behind UpdateToast.
//
// Pure module (no React, no Tauri) so it is node-testable; the toast component
// owns the effects: calling the updater plugin's check(), persisting the
// snooze in the tweaks store, and download/relaunch.
//
// Policy: prompt at most once per offered version per app session, honor a
// 24h snooze per version ("Later"), and never prompt for the version already
// running (the plugin shouldn't offer it, but a misconfigured latest.json
// must not produce an update loop).
// ─────────────────────────────────────────────────────────────────────────────

export const SNOOZE_MS = 24 * 60 * 60 * 1000;

export interface UpdaterPromptState {
  currentVersion: string;
  /** Version the updater endpoint offered, null when up to date / unreachable. */
  offeredVersion: string | null;
  /** Last version a toast was shown for in THIS session (not persisted). */
  promptedThisSession: string | null;
  /** Persisted "Later" state — version it applies to and when it expires. */
  snoozedVersion: string | null;
  snoozedUntil: number | null;
}

export function shouldPrompt(s: UpdaterPromptState, nowMs: number): boolean {
  if (s.offeredVersion == null) return false;
  if (s.offeredVersion === s.currentVersion) return false;
  if (s.promptedThisSession === s.offeredVersion) return false;
  if (
    s.snoozedVersion === s.offeredVersion
    && s.snoozedUntil != null
    && s.snoozedUntil > nowMs
  ) return false;
  return true;
}

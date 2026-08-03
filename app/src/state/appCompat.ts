// ─────────────────────────────────────────────────────────────────────────────
// Dotted-numeric version comparison, and whether a bundle's declared app
// floor admits the running app.
//
// Pure module — no React, no Tauri — so it is node-testable.
//
// Extracted from `state/catalog.ts`'s previously-private `isNewer` when
// Market v2 added `minAppVersion`: two callers needed the same comparison,
// and duplicating a version comparator is how the two copies drift.
// ─────────────────────────────────────────────────────────────────────────────

/** Negative if `a < b`, zero if equal, positive if `a > b`. Non-numeric
 *  segments compare as 0 — a malformed version is ordered, never thrown on. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((s) => Number.parseInt(s, 10) || 0);
  const pb = b.split('.').map((s) => Number.parseInt(s, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x !== y) return x - y;
  }
  return 0;
}

/** Is `available` strictly newer than `installed`? Fails CLOSED on a
 *  malformed version (reports no update) — a spurious update badge invites a
 *  pointless install. */
export function isNewer(available: string, installed: string): boolean {
  return compareVersions(available, installed) > 0;
}

/** May the running app install a bundle declaring this floor?
 *
 *  Fails OPEN, deliberately the opposite of `isNewer`: an absent, empty or
 *  malformed floor admits everything. Blocking an install because a publisher
 *  typo'd their floor would be a worse failure than allowing an install the
 *  bundle probably handles fine — and the sandbox is what actually contains a
 *  misbehaving bundle, not this check. */
export function isCompatible(minAppVersion: string | null, appVersion: string): boolean {
  if (!minAppVersion) return true;
  const looksNumeric = minAppVersion
    .split('.')
    .every((seg) => seg.length > 0 && /^\d+$/.test(seg));
  if (!looksNumeric) return true;
  return compareVersions(appVersion, minAppVersion) >= 0;
}

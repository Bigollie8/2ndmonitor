// What the visualizer listens to, and how its per-source gain is keyed.
// Pure module (no React, no Tauri) so it is node-testable, matching the
// convention state/milkdrop-presets.ts and state/catalog.ts follow.

export type AudioSource =
  | { mode: 'mix' }
  | { mode: 'only'; exe: string }
  | { mode: 'except'; exe: string };

export const DEFAULT_SENSITIVITY = 1.0;

/** Mirrors Rust's `source_key` exactly — the two must agree or a user's gain
 *  silently lands under a key nothing reads. */
export function sourceKey(s: AudioSource): string {
  return s.mode === 'mix' ? 'mix' : `${s.mode}:${s.exe}`;
}

/** Inverse of `sourceKey` — parses a `<select>` option value back into an
 *  `AudioSource`. An unrecognized key (corrupted storage, future format)
 *  degrades to `mix` rather than throwing, since this feeds straight into
 *  UI state on every keystroke of a dropdown. */
export function parseSourceKey(key: string): AudioSource {
  if (key.startsWith('only:')) return { mode: 'only', exe: key.slice('only:'.length) };
  if (key.startsWith('except:')) return { mode: 'except', exe: key.slice('except:'.length) };
  return { mode: 'mix' };
}

export function effectiveSensitivity(map: Record<string, number>, s: AudioSource): number {
  // `map` is whatever a `tweaks_import` handed us — `migrateTweaks` only
  // guards `undefined`, so a file with `"vizSensitivityBySource": null` (or
  // any other non-object) reaches here as-is. Indexing that directly would
  // throw during render (white screen) instead of just losing the tuning,
  // so treat anything that isn't a plain object as "nothing saved".
  if (typeof map !== 'object' || map === null || Array.isArray(map)) return DEFAULT_SENSITIVITY;
  const v = map[sourceKey(s)];
  return typeof v === 'number' && Number.isFinite(v) ? v : DEFAULT_SENSITIVITY;
}

/** Human-readable status-bar text for a source — "all system audio",
 *  "only Spotify", "except Discord". `nameOf` resolves an exe to its
 *  friendly display name (options/session list), falling back to the exe
 *  itself when the app isn't in either (e.g. it just quit). */
export function describeAudioSource(s: AudioSource, nameOf: (exe: string) => string): string {
  if (s.mode === 'mix') return 'all system audio';
  return `${s.mode} ${nameOf(s.exe)}`;
}

/** `vizSensitivity` used to be one number for all audio. Fold it into the
 *  per-source map as the mix entry so nobody's tuning resets on upgrade. */
export function migrateSensitivity(raw: unknown): Record<string, number> {
  if (typeof raw === 'number' && Number.isFinite(raw)) return { mix: raw };
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
    }
    return out;
  }
  return {};
}

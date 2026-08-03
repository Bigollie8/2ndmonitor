// What the visualizer listens to, and how its per-source gain is keyed.
// Pure module (no React, no Tauri) so it is node-testable, matching the
// convention state/milkdrop-presets.ts and state/catalog.ts follow.
//
// 0.6.6 model: a STRICT include list. Either the whole system mix, or up to
// MAX_AUDIO_APPS specific apps summed together — nothing in between, and no
// automatic switching between the two. (The state shape lives here; the
// capture policy lives in src-tauri/src/audio.rs.)

export type AudioSource =
  | { mode: 'mix' }
  | { mode: 'apps'; exes: string[] };

export const DEFAULT_SENSITIVITY = 1.0;

/** Hard cap on concurrent per-app captures — each selected exe is a real
 *  WASAPI process-loopback client. Enforced by the picker UI, by
 *  `toggleAppInSource`, and again by the Rust deserializer (`MAX_APPS`). */
export const MAX_AUDIO_APPS = 4;

/** Mirrors Rust's `source_key` exactly — the two must agree or a user's gain
 *  silently lands under a key nothing reads. The exes are sorted so the same
 *  *set* of apps resolves the same saved gain regardless of pick order. */
export function sourceKey(s: AudioSource): string {
  return s.mode === 'mix' ? 'mix' : `apps:${[...s.exes].sort().join('+')}`;
}

/** Inverse of `sourceKey` for sorted inputs. An unrecognized key (corrupted
 *  storage, the retired 0.6.4 `only:`/`except:` formats, a future format)
 *  degrades to `mix` rather than throwing. */
export function parseSourceKey(key: string): AudioSource {
  if (key.startsWith('apps:')) {
    const exes = key.slice('apps:'.length).split('+').filter((e) => e.length > 0);
    if (exes.length > 0) return { mode: 'apps', exes };
  }
  return { mode: 'mix' };
}

/** Normalize + migrate whatever `tweaks_load`/`tweaks_import` produced into
 *  the current union. 0.6.4 shapes: `only:<exe>` → `apps:[exe]`;
 *  `except:<exe>` → `mix` (an include list has no "everything but one app" —
 *  the 0.6.6 changelog notes the downgrade). Exes are lowercased and deduped,
 *  the list is capped at MAX_AUDIO_APPS, and anything malformed degrades to
 *  `mix` — `exes` is non-empty by contract everywhere downstream. */
export function migrateAudioSource(raw: unknown): AudioSource {
  if (raw !== null && typeof raw === 'object' && !Array.isArray(raw)) {
    const r = raw as Record<string, unknown>;
    if (r.mode === 'mix') return { mode: 'mix' };
    if (r.mode === 'apps' && Array.isArray(r.exes)) {
      const exes: string[] = [];
      for (const e of r.exes) {
        if (typeof e !== 'string' || e.length === 0) continue;
        const lower = e.toLowerCase();
        if (exes.includes(lower)) continue;
        exes.push(lower);
        if (exes.length === MAX_AUDIO_APPS) break;
      }
      if (exes.length > 0) return { mode: 'apps', exes };
    }
    if (r.mode === 'only' && typeof r.exe === 'string' && r.exe.length > 0) {
      return { mode: 'apps', exes: [r.exe.toLowerCase()] };
    }
  }
  return { mode: 'mix' };
}

/** One checkbox / headphone-button toggle: flip `exe`'s membership in the
 *  include set. From `mix` it starts the set as `[exe]`; removing the last
 *  member returns to `mix`; adding past the cap returns the SAME object so
 *  React state doesn't re-render on a refused add. */
export function toggleAppInSource(s: AudioSource, exe: string): AudioSource {
  const e = exe.toLowerCase();
  if (s.mode === 'mix') return { mode: 'apps', exes: [e] };
  if (s.exes.includes(e)) {
    const rest = s.exes.filter((x) => x !== e);
    return rest.length === 0 ? { mode: 'mix' } : { mode: 'apps', exes: rest };
  }
  if (s.exes.length >= MAX_AUDIO_APPS) return s;
  return { mode: 'apps', exes: [...s.exes, e] };
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

/** Human-readable status text, stating the literal truth: "all system
 *  audio", "Spotify + Discord", "Spotify (not running)". `nameOf` resolves
 *  an exe to its friendly display name, falling back to the exe itself when
 *  the app isn't known (e.g. it just quit). `liveExes` is the backend's list
 *  of exes with a live capture (`AudioSourceState.live_exes`); a selected
 *  exe missing from it is annotated "(not running)". Pass `null` when the
 *  backend state isn't known yet — no annotations, never a false claim. */
export function describeAudioSource(
  s: AudioSource,
  nameOf: (exe: string) => string,
  liveExes: readonly string[] | null,
): string {
  if (s.mode === 'mix') return 'all system audio';
  return s.exes
    .map((exe) => nameOf(exe) + (liveExes !== null && !liveExes.includes(exe) ? ' (not running)' : ''))
    .join(' + ');
}

/** Sensitivity-map migration, idempotent. `vizSensitivity` used to be one
 *  number for all audio — fold it into the per-source map as the `mix` entry
 *  so nobody's tuning resets on upgrade. 0.6.4 `only:` keys are respelled
 *  `apps:` (the same single-app listening situation under the new key
 *  format); `except:` keys are dropped — that situation no longer exists,
 *  so the gain has no home. */
export function migrateSensitivity(raw: unknown): Record<string, number> {
  if (typeof raw === 'number' && Number.isFinite(raw)) return { mix: raw };
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const entries = Object.entries(raw as Record<string, unknown>)
      .filter((kv): kv is [string, number] => typeof kv[1] === 'number' && Number.isFinite(kv[1]));
    const out: Record<string, number> = {};
    // Current-format keys first, then `only:` renames that don't collide —
    // a map that somehow holds both `only:x` and `apps:x` keeps the value
    // saved under the new format.
    for (const [k, v] of entries) {
      if (!k.startsWith('only:') && !k.startsWith('except:')) out[k] = v;
    }
    for (const [k, v] of entries) {
      if (!k.startsWith('only:')) continue;
      const key = `apps:${k.slice('only:'.length)}`;
      if (!(key in out)) out[key] = v;
    }
    return out;
  }
  return {};
}

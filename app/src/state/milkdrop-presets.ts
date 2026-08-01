// ─────────────────────────────────────────────────────────────────────────────
// MilkDrop preset library — merges the bundled butterchurn-presets pack with
// user files from <app_data_dir>/presets/ (served by the Rust presets_list /
// presets_read commands). Pure logic lives here (node-testable, no tauri
// imports); the viz-milkdrop component wires it to invoke().
// ─────────────────────────────────────────────────────────────────────────────

export interface PresetEntry {
  key: string;
  label: string;
  source: 'bundled' | 'user';
  /** user entries only */
  file?: string;
  ext?: string;
}

/** Pure merge: bundled presets (sorted by name) followed by user files in the
 *  order the store returned them. Keys are namespaced (`b:`/`u:`) so a user
 *  file named after a bundled preset can't collide. */
export function mergePresetLibrary(
  bundled: Record<string, object>,
  user: { name: string; file: string; ext: string }[],
): PresetEntry[] {
  const out: PresetEntry[] = Object.keys(bundled)
    .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))
    .map((name) => ({ key: `b:${name}`, label: name, source: 'bundled' as const }));
  for (const u of user) {
    out.push({ key: `u:${u.file}`, label: u.name, source: 'user', file: u.file, ext: u.ext });
  }
  return out;
}

export interface PresetDeps {
  bundled: Record<string, object>;
  readUserFile(file: string): Promise<string>;
}

/** Resolve an entry to a Butterchurn preset object. `.milk` conversion is
 *  best-effort: eel + HLSL → JS + GLSL needs a converter we don't bundle, so
 *  today it always reports a readable error the picker shows as a badge —
 *  pre-converted `.json` (e.g. from butterchurn.app) is the supported path. */
export async function resolvePreset(entry: PresetEntry, deps: PresetDeps): Promise<object> {
  if (entry.source === 'bundled') {
    const p = deps.bundled[entry.label];
    if (!p) throw new Error(`bundled preset missing: ${entry.label}`);
    return p;
  }
  const text = await deps.readUserFile(entry.file!);
  if (entry.ext === 'json') {
    try {
      const parsed: unknown = JSON.parse(text);
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        throw new Error('not an object');
      }
      return parsed as object;
    } catch {
      throw new Error('not valid Butterchurn preset JSON');
    }
  }
  throw new Error(
    '.milk conversion unavailable — convert to Butterchurn JSON (e.g. butterchurn.app) and drop the .json here',
  );
}

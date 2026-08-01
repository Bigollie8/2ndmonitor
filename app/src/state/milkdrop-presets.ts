// ─────────────────────────────────────────────────────────────────────────────
// MilkDrop preset library — names-based merging with load-source resolution.
// Bundled presets (packed in the sandbox frame) are referenced by name;
// user files are read host-side and travel as parsed JSON. Pure logic here
// (node-testable, no tauri imports); the viz-milkdrop host wires it to invoke().
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
  bundledNames: string[],
  user: { name: string; file: string; ext: string }[],
): PresetEntry[] {
  const out: PresetEntry[] = bundledNames
    .slice()
    .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))
    .map((name) => ({ key: `b:${name}`, label: name, source: 'bundled' as const }));
  for (const u of user) {
    out.push({ key: `u:${u.file}`, label: u.name, source: 'user', file: u.file, ext: u.ext });
  }
  return out;
}

/** What the host actually sends the frame for one load. Bundled presets live
 *  inside the frame (the pack ships in its code string), so they go by name;
 *  user files are read host-side over IPC and travel as parsed JSON — always
 *  structured-cloneable. */
export type MilkdropLoadSource = { bundled: string } | { preset: object };

export async function resolveLoadSource(
  entry: PresetEntry,
  readUserFile: (file: string) => Promise<string>,
): Promise<MilkdropLoadSource> {
  if (entry.source === 'bundled') return { bundled: entry.label };
  const text = await readUserFile(entry.file!);
  if (entry.ext === 'json') {
    try {
      const parsed: unknown = JSON.parse(text);
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('not an object');
      return { preset: parsed as object };
    } catch {
      throw new Error('not valid Butterchurn preset JSON');
    }
  }
  throw new Error(
    '.milk conversion unavailable — convert to Butterchurn JSON (e.g. butterchurn.app) and drop the .json here',
  );
}

/** Host→frame / frame→host payloads carried over the sandbox 'data' channel. */
export type MilkdropHostToFrame = { kind: 'milkdrop:load'; seq: number; source: MilkdropLoadSource; blend: number };
export type MilkdropFrameToHost =
  | { kind: 'milkdrop:names'; names: string[] }
  | { kind: 'milkdrop:load:result'; seq: number; ok: boolean; error?: string };

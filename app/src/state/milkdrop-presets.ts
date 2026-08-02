// ─────────────────────────────────────────────────────────────────────────────
// MilkDrop preset library — names-based merging with load-source resolution.
// Bundled presets (packed in the sandbox frame) are referenced by name;
// user files are read host-side and travel as parsed JSON. Pure logic here
// (node-testable, no tauri imports); the viz-milkdrop host wires it to invoke().
// ─────────────────────────────────────────────────────────────────────────────

export interface PresetEntry {
  key: string;
  label: string;
  source: 'original' | 'bundled' | 'market' | 'user';
  /** original entries only — the registry id the builder is looked up by;
   *  market entries only — the marketplace item id the reader is called with */
  id?: string;
  /** user entries only */
  file?: string;
  ext?: string;
}

/** Pure merge: original (first-party) presets in authored order, then
 *  installed marketplace presets (sorted by name), then bundled presets
 *  (sorted by name), then user files in the order the store returned them.
 *  Keys are namespaced (`o:`/`m:`/`b:`/`u:`) so names can't collide across
 *  sources. Originals go first — they're ours, there are few, and burying six
 *  hand-authored presets under a 90-name alphabetical pack is how they never
 *  get seen. Market goes next — the user deliberately installed those, so
 *  they shouldn't be buried under the bundled pack either. */
export function mergePresetLibrary(
  originals: { id: string; label: string }[],
  bundledNames: string[],
  user: { name: string; file: string; ext: string }[],
  market: { id: string; name: string }[] = [],
): PresetEntry[] {
  const out: PresetEntry[] = originals
    .map((o) => ({ key: `o:${o.id}`, label: o.label, source: 'original' as const, id: o.id }));
  for (const m of market
    .slice()
    .sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()))) {
    out.push({ key: `m:${m.id}`, label: m.name, source: 'market', id: m.id });
  }
  for (const name of bundledNames
    .slice()
    .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))) {
    out.push({ key: `b:${name}`, label: name, source: 'bundled' });
  }
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
  /** Builds an original preset's JSON by registry id (originals/index.ts —
   *  injected, like readUserFile, so this module stays dependency-free and
   *  the palette baking stays the caller's concern). */
  buildOriginal?: (id: string) => object,
  /** Reads a marketplace preset's JSON text by item id (presets_market_read
   *  over IPC — injected, like readUserFile, so this module stays
   *  dependency-free). */
  readMarketPreset?: (id: string) => Promise<string>,
): Promise<MilkdropLoadSource> {
  if (entry.source === 'original') {
    if (!buildOriginal) throw new Error('no builder for original presets');
    return { preset: buildOriginal(entry.id!) };
  }
  if (entry.source === 'bundled') return { bundled: entry.label };
  if (entry.source === 'market') {
    if (!readMarketPreset) throw new Error('no reader for marketplace presets');
    const text = await readMarketPreset(entry.id!);
    try {
      const parsed: unknown = JSON.parse(text);
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('not an object');
      return { preset: parsed as object };
    } catch {
      throw new Error('not valid Butterchurn preset JSON (marketplace preset)');
    }
  }
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

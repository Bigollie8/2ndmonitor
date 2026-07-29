// ─────────────────────────────────────────────────────────────────────────────
// Merges compile-time content tables with content installed at runtime.
//
// VIZ_STYLES used to be a static array, which made installed bundles
// second-class — reachable only through the "Scripted" style's picker. This
// module makes the catalog open: built-ins first, then installed bundles as
// `bundle:<id>` styles that behave like any other entry in the V-cycle, the
// Settings dropdown, the gallery and Stream Deck actions.
//
// Pure module — no React, no Tauri — so it is node-testable. The caller owns
// reading folders off disk.
// ─────────────────────────────────────────────────────────────────────────────
import type { VizMode } from '../types';
import type { VizStyle } from '../components/viz-styles';
import { BUILTIN_VIZ_STYLES } from '../components/viz-styles';

/** A visualizer folder as reported by the `visualizers_list` Tauri command. */
export interface InstalledVizFolder {
  id: string;
  name: string;
  author: string | null;
  version: string;
  api: number | null;
  manifest_error: string | null;
}

export interface VizStyleEntry {
  id: VizMode;
  label: string;
  desc: string;
  source: 'builtin' | 'bundle';
  /** Set only when `source === 'bundle'`. */
  bundleId?: string;
  author?: string | null;
  version?: string;
}

export const BUNDLE_PREFIX = 'bundle:';

export const bundleModeId = (id: string): VizMode => `${BUNDLE_PREFIX}${id}`;

export const isBundleMode = (mode: string): boolean => mode.startsWith(BUNDLE_PREFIX);

export const bundleIdOf = (mode: string): string | null =>
  isBundleMode(mode) ? mode.slice(BUNDLE_PREFIX.length) : null;

/** Built-ins in their declared order, then installed bundles sorted by label,
 *  then `scripted` moved to the end (it is the authoring entry point, not a
 *  style, and burying it behind N installed bundles hides it).
 *
 *  Folders are skipped when they failed manifest validation or declare an api
 *  this build does not implement — a broken folder must not become a selectable
 *  style that renders nothing. */
export function mergeVizStyles(
  builtin: VizStyle[],
  installed: InstalledVizFolder[],
): VizStyleEntry[] {
  const builtinIds = new Set<string>(builtin.map((s) => s.id));

  const builtinEntries: VizStyleEntry[] = builtin.map((s) => ({
    id: s.id,
    label: s.label,
    desc: s.desc,
    source: 'builtin',
  }));

  const bundleEntries: VizStyleEntry[] = installed
    .filter((f) => f.manifest_error === null && f.api === 1 && !builtinIds.has(f.id))
    .map((f) => ({
      id: bundleModeId(f.id),
      label: f.name.trim() || f.id,
      desc: f.author ? `by ${f.author}` : 'installed visualizer',
      source: 'bundle' as const,
      bundleId: f.id,
      author: f.author,
      version: f.version,
    }))
    .sort((a, b) => a.label.localeCompare(b.label));

  const merged = [...builtinEntries, ...bundleEntries];
  const scriptedAt = merged.findIndex((s) => s.id === 'scripted');
  if (scriptedAt >= 0) merged.push(...merged.splice(scriptedAt, 1));
  return merged;
}

/** Styles that shipped as built-ins and now live in the shop. A saved
 *  `vizMode` naming one is rewritten to its bundle id on load, so an existing
 *  user's selection keeps working the moment they install it — and falls back
 *  to Bars via the dispatch default until they do. */
export const RETIRED_BUILTIN_VIZ_MODES = [
  'starfield', 'perlin', 'orbital', 'aurora', 'city', 'strings',
  'hud', 'liquid', 'cassette', 'constellation', 'scope', 'spectrogram',
] as const;

const RETIRED = new Set<string>(RETIRED_BUILTIN_VIZ_MODES);

/** Derived from the built-in table so it can never drift from it. */
const BUILTIN_VIZ_MODE_SET = new Set<string>(BUILTIN_VIZ_STYLES.map((s) => s.id));

export function remapRetiredVizMode(mode: string): VizMode {
  if (isBundleMode(mode)) return mode as VizMode;
  if (RETIRED.has(mode)) return bundleModeId(mode);
  return (BUILTIN_VIZ_MODE_SET.has(mode) ? mode : 'bars') as VizMode;
}

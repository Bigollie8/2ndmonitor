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
  /** "marketplace" when the folder carries an `installed.json` marker written
   *  by `marketplace_install`; "local" for a hand-authored draft (e.g. the
   *  "+ New visualizer" template). See the filter in `mergeVizStyles` below. */
  source: 'marketplace' | 'local';
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
 *  style that renders nothing. They are also skipped when `source !== 'marketplace'`:
 *  a locally-authored draft (e.g. the template "+ New visualizer" writes) is
 *  reachable through the Scripted style's own picker, which is the surface
 *  built for editing it. The public catalog — this dropdown, the gallery, the
 *  V-cycle — is for content that was installed deliberately, not for a draft
 *  that merely happens to sit in the same folder tree. */
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
    .filter((f) => f.source === 'marketplace' && f.manifest_error === null && f.api === 1 && !builtinIds.has(f.id))
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
 *  user's selection keeps working the moment its seed zip installs — and
 *  resolves to whatever else exists (see `resolveVizSurface`) until it does.
 *
 *  The first twelve went in an earlier wave; the fifteen after them are the
 *  whole of what used to be `BUILTIN_VIZ_STYLES` minus `milkdrop`/`scripted`,
 *  which are first-party forever (see state/firstParty.ts). Every id here is
 *  pinned to a real `bundles/<id>/` folder by a test in sandbox/bundles.test.ts. */
export const RETIRED_BUILTIN_VIZ_MODES = [
  'starfield', 'perlin', 'orbital', 'aurora', 'city', 'strings',
  'hud', 'liquid', 'cassette', 'constellation', 'scope', 'spectrogram',
  'bars', 'waveform', 'radial', 'particles', 'ambient',
  'neonbars', 'splitmirror', 'circular', 'tunnel', 'pixelled',
  'ribbon', 'vinyl', 'kaleidoscope', 'freqgrid', 'minimal',
] as const;

const RETIRED = new Set<string>(RETIRED_BUILTIN_VIZ_MODES);

/** The style to land on when the requested one does not exist. Deliberately
 *  NOT a constant: `'bars'` used to be hardcoded here and in App.tsx, and the
 *  moment Bars left the binary every one of those pointed at nothing and the
 *  surface rendered a black void. `'bundle:bars'` is no better — a user who
 *  removed that bundle hits the identical dead end. The only answer that
 *  cannot rot is "the first thing that is actually in the catalog right now",
 *  and `null` when the catalog is genuinely empty, which callers must handle
 *  explicitly rather than substituting a guess. */
export function firstAvailableVizMode(available: readonly { id: VizMode }[]): VizMode | null {
  return available[0]?.id ?? null;
}

/** Rewrites a persisted `vizMode` at load time.
 *
 *  `available` defaults to the built-in table because this runs during tweak
 *  hydration, before `visualizers_list` has resolved — the built-ins are the
 *  only thing knowable synchronously. A `bundle:` mode is passed through
 *  untouched precisely because it may name a bundle that is installed, or is
 *  about to be by the startup seed sync; deciding it is absent here would
 *  discard a valid selection. Whether it can actually render is decided per
 *  frame by `resolveVizSurface` against the merged catalog.
 *
 *  Returns `null` only when `available` is empty — there is then no honest
 *  answer, and the caller should keep whatever was saved rather than invent
 *  one. (With the default argument this is unreachable: the built-in table
 *  always holds `milkdrop` and `scripted`.) */
export function remapRetiredVizMode(
  mode: string,
  available: readonly { id: VizMode }[] = BUILTIN_VIZ_STYLES,
): VizMode | null {
  if (isBundleMode(mode)) return mode as VizMode;
  if (RETIRED.has(mode)) return bundleModeId(mode);
  if (available.some((s) => s.id === mode)) return mode as VizMode;
  return firstAvailableVizMode(available);
}

/** What the viz surface should actually mount for a selected mode.
 *  - `style`: render this mode (either the requested one, or the fallback).
 *  - `pending`: the installed list has not resolved; render nothing rather
 *    than guessing. Guessing "absent" flashes the fallback over an installed
 *    bundle style on every cold start; guessing "present" flashes the
 *    sandbox's error banner for one that really is gone.
 *  - `empty`: the catalog resolved and holds nothing at all — every built-in
 *    tombstoned and no bundle installed. A real, reachable state now that the
 *    styles are removable content, and the one case with no style to fall back
 *    to, so it gets an explicit empty state instead of a black rectangle. */
export type VizSurfaceTarget =
  | { kind: 'style'; mode: VizMode }
  | { kind: 'pending' }
  | { kind: 'empty' };

export function resolveVizSurface(
  mode: string,
  styles: readonly { id: VizMode }[],
  loaded: boolean,
): VizSurfaceTarget {
  const match = styles.find((s) => s.id === mode);
  if (match) return { kind: 'style', mode: match.id };
  if (!loaded) return { kind: 'pending' };
  const first = firstAvailableVizMode(styles);
  return first === null ? { kind: 'empty' } : { kind: 'style', mode: first };
}

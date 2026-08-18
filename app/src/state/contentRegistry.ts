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
import type { VizStyle, VizCategory } from '../components/viz-styles';
import { BUILTIN_VIZ_STYLES } from '../components/viz-styles';
// Compile-time import: the repo's bundle metadata is the single source of
// truth for official-bundle categories, baked into the JS at build so a
// seeds-only install (no marketplace fetch yet) still groups correctly.
import bundleMetadata from '../../../bundles/metadata.json';
import { isFirstParty } from './firstParty';

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
  /** Gallery grouping (0.9.11). Builtins carry their compiled category;
   *  official bundles resolve through the repo metadata compiled in below;
   *  third-party bundles default to 'scene'. */
  category: VizCategory;
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
const VIZ_CATEGORIES: ReadonlySet<string> = new Set(['spectrum', 'wave', 'ambient', 'scene', 'engine', 'meter']);

/** Category for an official bundle from the compiled-in repo metadata;
 *  unknown ids (third-party marketplace bundles) file under 'scene'. */
export function officialBundleCategory(id: string): VizCategory {
  const entry = (bundleMetadata as Record<string, { category?: string }>)[id];
  const c = entry?.category;
  return c && VIZ_CATEGORIES.has(c) ? (c as VizCategory) : 'scene';
}

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
    category: s.category,
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
      category: officialBundleCategory(f.id),
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

/** True for the two first-party engines (`milkdrop`, `scripted`) and nothing
 *  else. Engine-ness is exactly first-party-ness for visualizers, by the rule
 *  in state/firstParty.ts: an entry is first-party iff it cannot be expressed
 *  as a bundle, and for visualizers that is precisely the two engines. Derived
 *  from that list rather than re-listing the ids, so the two can never drift.
 *
 *  A `bundle:` mode can never match: `isFirstParty` compares the whole string
 *  and the prefix is part of it, which is the correct answer — an installed
 *  bundle is never an engine, whatever it happens to be called. */
const isEngineVizMode = (mode: VizMode): boolean => isFirstParty('visualizer', mode);

/** The style to land on when the requested one does not exist. Deliberately
 *  NOT a constant: `'bars'` used to be hardcoded here and in App.tsx, and the
 *  moment Bars left the binary every one of those pointed at nothing and the
 *  surface rendered a black void. `'bundle:bars'` is no better — a user who
 *  removed that bundle hits the identical dead end. The only answer that
 *  cannot rot is "something that is actually in the catalog right now", and
 *  `null` when the catalog is genuinely empty, which callers must handle
 *  explicitly rather than substituting a guess.
 *
 *  Prefers the first NON-ENGINE entry. "First entry of the merged list" alone
 *  would be `milkdrop` essentially always — `mergeVizStyles` orders built-ins
 *  before bundles and moves only `scripted` to the end — and MilkDrop is the
 *  most expensive surface in the app: a WebGL2 context, a ~200 kB engine chunk
 *  and a ~646 kB preset pack. That is a bad thing to mount by accident, on a
 *  path that by definition fires when something is already not as expected.
 *  A bundle style is a canvas and a few kB.
 *
 *  Falls back to the first entry of any kind when every survivor is an engine
 *  (no bundles installed) — an engine is a real, working visualizer, so it is
 *  the right answer there; it just should not win while a cheaper one exists.
 *  Note this deliberately does NOT reorder the catalog: the V-cycle, Settings
 *  dropdown, gallery and quick strip all keep their existing order. Only the
 *  fallback choice changes. */
export function firstAvailableVizMode(available: readonly { id: VizMode }[]): VizMode | null {
  const style = available.find((s) => !isEngineVizMode(s.id));
  return style?.id ?? available[0]?.id ?? null;
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

/** What is ACTUALLY on screen, as a string, for perf attribution — the perf
 *  HUD's mounted-surface list and a spike snapshot's `vizMode` field.
 *
 *  Must be derived from the resolved target, never from the requested mode.
 *  Before the built-in styles were retired the dispatch always rendered
 *  exactly what was asked for, so "requested" and "rendering" were the same
 *  string by construction and the distinction did not exist. Now they diverge
 *  precisely in the fallback case — and a spike snapshot that says
 *  `bundle:bars` while MilkDrop is holding the WebGL context sends whoever
 *  reads it looking at the wrong code. Shared by App.tsx (`recordContext`) and
 *  HiFiVizSurface (`useRegisterSurface`) so the two can never disagree. */
export function resolvedVizModeLabel(target: VizSurfaceTarget, requested: string): string {
  switch (target.kind) {
    case 'style': return target.mode;
    // Nothing is mounted, and saying so is the point: a snapshot naming a
    // style while the empty state is on screen would be a false lead.
    case 'empty': return 'none';
    // Keeps the requested mode visible — "we are waiting on the catalog for
    // this id" is the useful fact — but tagged, so it never reads as "this
    // style is rendering".
    case 'pending': return `${requested}:pending`;
  }
}

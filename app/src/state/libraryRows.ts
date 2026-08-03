// ─────────────────────────────────────────────────────────────────────────────
// What the Library offers for one installed item, and what to call it.
//
// Pure module — no React, no Tauri — so it is node-testable.
//
// The labelling half exists because the old catalog lied slightly: every item
// showed "Remove", but `planRemoval` (state/catalog.ts) only actually
// uninstalls when `installedVersion` is set. For a compiled-in first-party
// tile it just writes a tombstone — the tile stays on disk and keeps
// shipping. "Hide" is what that button does.
// ─────────────────────────────────────────────────────────────────────────────
import type { CatalogItem } from './catalog';
import { EMPTY_FACETS, type Facets } from './catalogFilter';
import { isCompatible } from './appCompat';

export type RowAction = 'add' | 'setup' | 'update' | 'remove' | 'hide' | 'restore';

export interface RowPlan {
  /** In display order. The most blocking action leads. */
  actions: RowAction[];
  removeLabel: 'Remove' | 'Hide';
  /** Non-null when the running app is below the item's declared floor. */
  incompatibleNote: string | null;
}

export type LibrarySection = 'installed' | 'updates' | 'needs-setup' | 'removed';

export function sectionFacets(section: LibrarySection): Facets {
  switch (section) {
    case 'installed': return { ...EMPTY_FACETS, installed: true };
    case 'updates': return { ...EMPTY_FACETS, updates: true };
    case 'needs-setup': return { ...EMPTY_FACETS, needsSetup: true };
    case 'removed': return { ...EMPTY_FACETS, removed: true };
  }
}

export function rowPlanFor(item: CatalogItem, appVersion: string): RowPlan {
  // A removed item's row is a recovery surface and nothing else — every other
  // action would describe a state the row is not in.
  if (item.removed) {
    return { actions: ['restore'], removeLabel: 'Remove', incompatibleNote: null };
  }

  const compatible = isCompatible(item.minAppVersion, appVersion);
  const incompatibleNote = compatible ? null : `Requires app ${item.minAppVersion}`;

  // A first-party built-in ships compiled in: there is no folder to delete,
  // so removal is only ever a tombstone. See planRemoval's uninstall gate.
  const isBuiltIn = item.source === 'first-party' || item.installedVersion == null;
  const removeLabel: 'Remove' | 'Hide' = isBuiltIn ? 'Hide' : 'Remove';

  const actions: RowAction[] = [];
  if (item.needsSetup) actions.push('setup');
  if (item.updateAvailable && compatible) actions.push('update');
  // Only a tile has a dashboard instance to place. A broken one is excluded:
  // placing it would draw an error frame the user then has to remove again.
  if (item.kind === 'tile' && item.brokenReason === null) actions.push('add');
  actions.push(isBuiltIn ? 'hide' : 'remove');

  // 'setup' and 'update' lead; 'add' sits before the destructive action.
  const order: RowAction[] = ['setup', 'update', 'add', 'remove', 'hide'];
  actions.sort((a, b) => order.indexOf(a) - order.indexOf(b));

  return { actions, removeLabel, incompatibleNote };
}

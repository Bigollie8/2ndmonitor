// ─────────────────────────────────────────────────────────────────────────────
// Installing someone else's layout.
//
// Pure module — no React, no Tauri — so the resolution decision is
// node-testable.
//
// A published layout references tile types the installer may not have. Phase 7
// of Market v2 already built attributed multi-install consent for exactly this
// shape (`planMultiInstall`), so this resolves the layout's dependencies into
// catalog items and hands them there rather than inventing a second consent
// flow.
//
// Two rules the apply step must honour, both encoded here:
//   * It always creates a NEW layout. Overwriting one silently destroys
//     someone's dashboard, which is never an acceptable outcome of pressing
//     Install.
//   * A tile whose bundle could not be installed is KEPT, not dropped. The
//     arrangement survives intact and the gap renders as MissingTileCard,
//     which already exists for this case — visible and fixable beats
//     silently collapsed.
// ─────────────────────────────────────────────────────────────────────────────
import type { CatalogItem } from './catalog';
import type { PublishedLayout, PublishedTile } from './layoutPublish';
import { layoutDependencies } from './layoutPublish';
import type { TileInstance, TileType } from './layout';

export interface LayoutResolution {
  /** Bundle ids the layout needs that are not installed but ARE available. */
  installable: CatalogItem[];
  /** Already present — nothing to do, but counted so the numbers add up. */
  alreadyInstalled: CatalogItem[];
  /** Needed, but nothing in the catalog provides them. Named so the installer
   *  learns which tiles will land broken rather than discovering it after. */
  unavailable: string[];
}

/** Resolve a layout's dependencies against the merged catalog. */
export function resolveLayout(layout: PublishedLayout, items: CatalogItem[]): LayoutResolution {
  const byId = new Map(items.map((i) => [i.id, i]));
  const installable: CatalogItem[] = [];
  const alreadyInstalled: CatalogItem[] = [];
  const unavailable: string[] = [];

  for (const id of layoutDependencies(layout)) {
    const item = byId.get(id);
    if (!item) {
      unavailable.push(id);
      continue;
    }
    if (item.installed) alreadyInstalled.push(item);
    else installable.push(item);
  }
  return { installable, alreadyInstalled, unavailable };
}

/** A fresh instance id. Injected rather than imported so the apply step is
 *  deterministic under test — two installs of the same layout must produce
 *  different instance ids, and a test needs to be able to say what they are. */
export type NewId = () => string;

function toInstance(t: PublishedTile, newId: NewId): TileInstance {
  return {
    instanceId: newId(),
    type: t.type as TileType,
    rect: { ...t.rect },
    // No config, deliberately: the publisher's was never transmitted, and
    // fabricating one here would put made-up values in front of the user
    // instead of the tile's own setup prompt.
  };
}

export interface AppliedLayout {
  landscape: TileInstance[];
  portrait: TileInstance[];
  theme: PublishedLayout['theme'];
}

/** Turn a published layout into placed instances.
 *
 *  Every tile is kept, including ones whose bundle is missing — those render
 *  as `MissingTileCard`, which is how the user finds out and fixes it. */
export function applyLayout(layout: PublishedLayout, newId: NewId): AppliedLayout {
  return {
    landscape: layout.landscape.map((t) => toInstance(t, newId)),
    portrait: layout.portrait.map((t) => toInstance(t, newId)),
    theme: layout.theme,
  };
}

/** A layout name that does not collide with one the user already has.
 *
 *  Never returns an existing name: installing a layout must add one, never
 *  replace one, and silently overwriting "Work" because the author also
 *  called theirs "Work" would destroy a dashboard. */
export function uniqueLayoutName(desired: string, existing: string[]): string {
  const taken = new Set(existing.map((n) => n.trim().toLowerCase()));
  const base = desired.trim() || 'Layout';
  if (!taken.has(base.toLowerCase())) return base;
  for (let n = 2; n < 1000; n++) {
    const candidate = `${base} ${n}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
  return `${base} ${Date.now()}`;
}

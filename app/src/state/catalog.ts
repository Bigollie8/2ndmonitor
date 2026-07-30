// ─────────────────────────────────────────────────────────────────────────────
// The unified content catalog: one item type for every tile and visualizer,
// whatever backs it.
//
// Pure module — no React, no Tauri — so it is node-testable. The caller owns
// reading folders off disk and fetching the signed index.
//
// Distinct from tileRegistry/contentRegistry on purpose: those feed the
// dashboard and pickers and therefore HIDE broken or non-marketplace folders.
// The catalog SHOWS a broken install with its reason, because the catalog is
// where a user goes to remove it.
// ─────────────────────────────────────────────────────────────────────────────
import type { BuiltinTileType } from './layout';
import type { TileMeta, TileCategory } from './tileMeta';
import type { VizStyle, VizCategory } from '../components/viz-styles';
import type { InstalledTileFolder } from '../tiles/tileRegistry';
import type { InstalledVizFolder } from './contentRegistry';
import { isFirstParty } from './firstParty';

export type CatalogKind = 'tile' | 'visualizer';
export type CatalogSource = 'first-party' | 'bundle';

/** One entry in the signed marketplace index. Mirrors the server's index.json. */
export interface IndexBundle {
  id: string;
  version: string;
  kind: 'preset' | 'visualizer' | 'tile';
  name: string;
  author: string;
  permissions: string[];
  sha256: string;
  size: number;
  downloads: number;
}

export interface CatalogItem {
  /** `${kind}:${id}` — the identity used by every list, map and action. */
  key: string;
  kind: CatalogKind;
  id: string;
  name: string;
  description: string;
  category: TileCategory | VizCategory;
  source: CatalogSource;

  installed: boolean;
  installedVersion: string | null;
  availableVersion: string | null;
  updateAvailable: boolean;

  permissions: string[];
  needsSetup: boolean;
  downloads: number | null;
  brokenReason: string | null;
}

export interface MergeCatalogArgs {
  tileMeta: Record<BuiltinTileType, TileMeta>;
  vizStyles: VizStyle[];
  installedTiles: InstalledTileFolder[];
  installedViz: InstalledVizFolder[];
  /** Empty when the marketplace is unreachable — the catalog still renders. */
  index: IndexBundle[];
  /** Keys the user removed. Persisted; see state/removedContent.ts. */
  removed: string[];
  /** Keys whose declared secrets/config are still unset. */
  needsSetup: string[];
}

export const catalogKey = (kind: CatalogKind, id: string): string => `${kind}:${id}`;

/** Newer-than comparison over dotted numeric versions. Non-numeric segments
 *  compare as 0, so a malformed version never reports an update — failing
 *  closed is right here: a spurious update badge invites a pointless install. */
function isNewer(available: string, installed: string): boolean {
  const a = available.split('.').map((s) => Number.parseInt(s, 10) || 0);
  const b = installed.split('.').map((s) => Number.parseInt(s, 10) || 0);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? 0, y = b[i] ?? 0;
    if (x !== y) return x > y;
  }
  return false;
}

export function mergeCatalog(args: MergeCatalogArgs): CatalogItem[] {
  const removed = new Set(args.removed);
  const needsSetup = new Set(args.needsSetup);
  const items = new Map<string, CatalogItem>();

  const put = (item: CatalogItem) => { items.set(item.key, item); };

  // 1. Compile-time tables. A built-in that is not first-party is a bundle
  //    target: it reads as installed today because its code ships, and a
  //    migration wave later replaces this entry with a real bundle.
  for (const [id, meta] of Object.entries(args.tileMeta) as [string, TileMeta][]) {
    const key = catalogKey('tile', id);
    put({
      key, kind: 'tile', id,
      name: meta.label, description: meta.description, category: meta.category,
      source: isFirstParty('tile', id) ? 'first-party' : 'bundle',
      installed: true, installedVersion: null, availableVersion: null, updateAvailable: false,
      permissions: [], needsSetup: needsSetup.has(key), downloads: null, brokenReason: null,
    });
  }
  for (const s of args.vizStyles) {
    const key = catalogKey('visualizer', s.id);
    put({
      key, kind: 'visualizer', id: s.id,
      name: s.label, description: s.desc, category: s.category,
      source: isFirstParty('visualizer', s.id) ? 'first-party' : 'bundle',
      installed: true, installedVersion: null, availableVersion: null, updateAvailable: false,
      permissions: [], needsSetup: needsSetup.has(key), downloads: null, brokenReason: null,
    });
  }

  // 2. Installed folders. A folder overwrites the compile-time entry of the
  //    same id — that is the migrated-item rule, and it is what makes a
  //    migration wave a no-op for this UI.
  const installedFolder = (
    kind: CatalogKind,
    f: InstalledTileFolder | InstalledVizFolder,
    fallbackCategory: TileCategory | VizCategory,
  ) => {
    if (f.source !== 'marketplace') return; // a local draft is not catalog content
    const key = catalogKey(kind, f.id);
    if (removed.has(key)) return;
    const prev = items.get(key);
    put({
      key, kind, id: f.id,
      name: f.name.trim() || f.id,
      description: f.author ? `by ${f.author}` : prev?.description ?? '',
      category: prev?.category ?? fallbackCategory,
      source: 'bundle',
      installed: true,
      installedVersion: f.version,
      availableVersion: prev?.availableVersion ?? null,
      updateAvailable: false,
      permissions: prev?.permissions ?? [],
      needsSetup: needsSetup.has(key),
      downloads: prev?.downloads ?? null,
      brokenReason: f.manifest_error,
    });
  };
  for (const f of args.installedTiles) installedFolder('tile', f, 'integrations');
  for (const f of args.installedViz) installedFolder('visualizer', f, 'ambient');

  // 3. The signed index. Adds items nobody has installed, and supplies the
  //    available version, permissions and download count for those they do.
  for (const b of args.index) {
    if (b.kind === 'preset') continue; // presets are data, not catalog content
    const kind: CatalogKind = b.kind;
    const key = catalogKey(kind, b.id);
    const prev = items.get(key);
    // Preserve prior installed state rather than deriving it from
    // installedVersion alone: a table-only built-in (pass 1) is `installed:
    // true` with no installedVersion, and it still ships and works even if
    // the index also lists it — offering "Install" for it would be wrong.
    const installed = prev?.installed ?? false;
    put({
      key, kind, id: b.id,
      name: b.name || prev?.name || b.id,
      description: prev?.description ?? (b.author ? `by ${b.author}` : ''),
      category: prev?.category ?? (kind === 'tile' ? 'integrations' : 'ambient'),
      source: 'bundle',
      installed,
      installedVersion: prev?.installedVersion ?? null,
      availableVersion: b.version,
      updateAvailable: prev?.installedVersion != null && isNewer(b.version, prev.installedVersion),
      permissions: b.permissions,
      needsSetup: needsSetup.has(key),
      downloads: b.downloads,
      brokenReason: prev?.brokenReason ?? null,
    });
  }

  // 4. Removal. Applied last so an item the user removed is dropped when it is
  //    only local, but stays browsable (uninstalled) when the index offers it.
  const out: CatalogItem[] = [];
  for (const item of items.values()) {
    if (!removed.has(item.key)) { out.push(item); continue; }
    if (item.availableVersion != null) {
      out.push({ ...item, installed: false, installedVersion: null, updateAvailable: false });
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

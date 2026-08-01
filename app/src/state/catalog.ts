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
import type { BuiltinTileType, TileType } from './layout';
import type { TileMeta, TileCategory } from './tileMeta';
import { TILE_META } from './tileMeta';
import type { VizStyle, VizCategory } from '../components/viz-styles';
import type { InstalledTileFolder } from '../tiles/tileRegistry';
import { bundleTileId } from '../tiles/tileRegistry';
import type { InstalledVizFolder } from './contentRegistry';
import { isFirstParty } from './firstParty';
import { parsePermission } from '../sandbox/manifest';

export type CatalogKind = 'tile' | 'visualizer';
export type CatalogSource = 'first-party' | 'bundle';

/** One bundle's aggregate rating, as `GET /ratings` reports it (server/src/
 *  ratings.rs) — `avg` already rounded to one decimal server-side so every
 *  client shows the identical number. Never `{avg:0,count:0}`: a bundle with
 *  no votes is simply absent from the response, which is why every consumer
 *  models "no rating yet" as `null`, not a zero-valued object. */
export interface RatingAgg {
  avg: number;
  count: number;
}

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
  /** True when the server has a published preview image for this bundle
   *  (spec C §8's `preview IS NOT NULL AS hasPreview`). Optional because an
   *  older server's index simply omits the column — treated as `false` by
   *  the `=== true` check in pass 3 below, never as "unknown". */
  hasPreview?: boolean;
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
  /** True when `key` is in the caller's removal list. A removed item still
   *  appears in `mergeCatalog`'s output — flagged, not dropped — so the
   *  catalog UI can render a "Removed" rail row with a per-item Restore
   *  action (see catalogRail.ts and ContentLibrary.tsx). Every OTHER rail
   *  row and the default grid must exclude items with `removed: true`. */
  removed: boolean;
  /** Whether the marketplace has a published preview image for this item
   *  (spec C §6, branch 2). `false` for every compile-time table entry and
   *  installed folder (passes 1 and 2) — neither source knows about a
   *  published image, only the signed index does. See previewSource.ts for
   *  the rule that consumes this alongside `installed`/`brokenReason`. */
  hasPreview: boolean;
  /** Aggregate rating from `GET /ratings` — unsigned, deliberately not part
   *  of the index (see server/src/ratings.rs), so it comes from its own
   *  `MergeCatalogArgs.ratings` input rather than an `IndexBundle` field.
   *  `null` for every compile-time table entry and installed folder (passes
   *  1 and 2, same as `downloads`) and whenever the endpoint has nothing for
   *  this bundle's id — including when the whole fetch failed, in which case
   *  the caller passes `{}` and every item's rating is `null`. See
   *  StarRating.tsx's `ratingDisplay` for the rule that turns this into what
   *  the card shows. */
  rating: RatingAgg | null;
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
  /** Keys of installed bundles that declare at least one `secret:` permission
   *  and have at least one of those secrets still unset (see
   *  ContentLibrary.tsx's needs-setup effect and state/secrets.ts). Scoped to
   *  secrets only, not the full "secrets/config" the original design sketch
   *  named: a declared `config` value is per placed instance (see
   *  TileCredentialPanel.tsx), so there is no single catalog-level answer for
   *  it without restructuring that component to be instance-aware here too. */
  needsSetup: string[];
  /** Bundle id → aggregate rating, from `GET /ratings`. Keyed on the bare
   *  bundle id (server's `ratings.bundle_id`, no kind prefix) — NOT
   *  `catalogKey`, since the endpoint has no notion of tile-vs-visualizer.
   *  Pass `{}` when the fetch fails or hasn't resolved yet: every item's
   *  `rating` then comes out `null` and the catalog renders exactly as it
   *  does today, same silent-failure contract as a missing preview image. */
  ratings: Record<string, RatingAgg>;
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
      removed: false, hasPreview: false, rating: null,
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
      removed: false, hasPreview: false, rating: null,
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
      removed: false, hasPreview: false, rating: prev?.rating ?? null,
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
      removed: false, hasPreview: b.hasPreview === true,
      // Keyed by bare bundle id, not `key` — see MergeCatalogArgs.ratings'
      // doc comment. `undefined` (no votes yet, or the ratings fetch failed
      // and the caller passed `{}`) becomes `null`, exactly like `downloads`
      // has no equivalent fallback because the index always supplies it but
      // ratings is a separate, independently-fallible fetch.
      rating: args.ratings[b.id] ?? null,
    });
  }

  // 4. Removal. Applied last. A removed item is FLAGGED, not dropped — every
  //    id this function ever learns about (every compile-time table entry, at
  //    minimum) stays in the output so the catalog UI has a name and category
  //    to render a "Removed" rail row with a per-item Restore action (see
  //    catalogRail.ts, CatalogCard.tsx, ContentLibrary.tsx). Previously a
  //    removed item was kept only `if (item.availableVersion != null)` — i.e.
  //    only the ~15 published bundles — and every other removed item (most
  //    first-party tiles, every not-yet-migrated built-in visualizer style)
  //    vanished from the catalog with no way back short of "Restore defaults".
  //    Callers that want the ordinary browsable set (every rail row except
  //    "Removed") must filter on `!item.removed` themselves — see
  //    catalogRail.ts's `visible` helper.
  //
  //    `rating` (like every other field added since this comment was written)
  //    survives this pass via the `...item` spread in BOTH branches below,
  //    not because either branch names it explicitly — a prior task's review
  //    caught a field silently dropped here when an earlier version of this
  //    pass built the removed-item object by hand instead of spreading. Kept
  //    as a spread specifically so a future field addition to `CatalogItem`
  //    can't repeat that: see catalog.test.ts's
  //    "a removed item still carries its rating" test.
  const out: CatalogItem[] = [];
  for (const item of items.values()) {
    if (!removed.has(item.key)) { out.push(item); continue; }
    out.push({
      ...item, installed: false, installedVersion: null, updateAvailable: false, removed: true,
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** Is `id` one of the compile-time built-in tile types? Narrows so the
 *  candidate `TileType` for a catalog tile item can be computed without a
 *  cast — a bundle folder's tile always lives at `bundle:<id>` on the canvas
 *  (see tileRegistry.ts), a built-in lives at its bare id.
 *
 *  A marketplace tile whose bare id happens to collide with a built-in key
 *  resolves here as the built-in `TileType`, not `bundle:<id>` — mergeCatalog
 *  already collapses that collision to a single catalog item (the installed
 *  folder overwrites the compile-time entry of the same id), so there is no
 *  live case where the two disagree today. This ambiguity is deliberate, not
 *  an oversight: it only matters if a bundle and a built-in ever shared an id
 *  space without one winning in mergeCatalog, which nothing produces today. */
function isBuiltinTileId(id: string): id is BuiltinTileType {
  return Object.prototype.hasOwnProperty.call(TILE_META, id);
}

/** The dashboard `TileType` a tile catalog item resolves to — `null` for a
 *  visualizer, which has no dashboard instance of its own. Shared by
 *  `planRemoval` (strips placed instances of a removed tile) and
 *  ContentLibrary's "+ Add" action (places a new instance of an installed
 *  one) — both need the exact same built-in-vs-bundle resolution. */
export function tileInstanceType(item: CatalogItem): TileType | null {
  if (item.kind !== 'tile') return null;
  return isBuiltinTileId(item.id) ? item.id : bundleTileId(item.id);
}

export interface RemovalPlan {
  /** Whether to invoke `marketplace_uninstall`. True only when a real
   *  installed folder backs this item — `installedVersion` is set exclusively
   *  by mergeCatalog's installed-folder pass, so it is the honest "does a
   *  folder actually exist on disk" signal. `item.source === 'bundle'` is
   *  NOT a safe substitute: mergeCatalog labels every not-yet-migrated
   *  built-in (a compile-time table entry with no folder) `source: 'bundle'`
   *  too, and its id (e.g. "weatherRadar") can be camelCase — the Rust
   *  `is_safe_id` validator (`[a-z0-9-]` only) rejects that outright, so
   *  gating on `source` alone silently no-ops the removal instead of
   *  skipping the invoke it never needed to make. See task-9-report.md. */
  uninstall: boolean;
  /** The key to add to the removal tombstone list (state/removedContent.ts). */
  tombstoneKey: string;
  /** For a tile item, the dashboard `TileType` whose placed instances must be
   *  stripped so a removed tile's fixed `renderTile` case doesn't keep
   *  drawing it. Null for a visualizer — a visualizer has no dashboard
   *  instance of its own; removing the active one is handled by resetting
   *  `vizMode` instead (see App.tsx). */
  instanceType: TileType | null;
}

/** Pure decision for what `handleRemove` (ContentLibrary.tsx) must do for one
 *  `CatalogItem` — the honest gate, the tombstone key, and (for a tile) the
 *  dashboard type to strip. Extracted so the one real bug this task
 *  introduced (gating `uninstall` on `source` instead of `installedVersion`)
 *  is covered by a fast, deterministic test instead of living only in an
 *  async component method that only live testing exercised. */
export function planRemoval(item: CatalogItem): RemovalPlan {
  return {
    uninstall: item.installedVersion != null,
    tombstoneKey: item.key,
    instanceType: tileInstanceType(item),
  };
}

/** Pure decision for the catalog empty state's recovery path
 *  (ContentLibrary.tsx's handleRestoreDefaults) — extracted so the ordering
 *  below, which is load-bearing and easy to get backwards, is covered by a
 *  fast deterministic test instead of living only in an async component
 *  method that only live testing exercised (see task-10-report.md for the
 *  StrictMode bug that slipped through exactly that gap once already).
 *
 *  `clearRemoved` MUST run, and complete, before `seedSync` is called:
 *  `seed_sync` (the Rust command `seedSync` wraps) reads the removed list it
 *  is given and skips every key still on it. Clearing after syncing would
 *  leave the tombstones in place and the sync would skip everything —
 *  restore-defaults would silently do nothing. `seedSync` is always called
 *  with `[]` explicitly, never with whatever `clearRemoved` wrote, so this
 *  function has no dependency on `clearRemoved`'s write having been observed
 *  anywhere (relevant in the real caller, where it's a React state setter and
 *  not synchronously readable back).
 *
 *  If `seedSync` throws, the removal list is NOT rolled back: `clearRemoved`
 *  already ran and this function does not undo it. The user explicitly asked
 *  for a clean slate; a failed sync (the marketplace being unreachable, say)
 *  means fewer seed bundles got reinstalled, which is not a reason to
 *  silently restore old tombstones the user just asked to clear. The error
 *  propagates to the caller, which decides how to surface it. */
export async function restoreDefaults(deps: {
  clearRemoved: () => void;
  seedSync: (removed: string[]) => Promise<string[]>;
}): Promise<string[]> {
  deps.clearRemoved();
  return deps.seedSync([]);
}

export interface SecretSetupCandidate {
  /** The catalog key this candidate resolves to if it needs setup. */
  key: string;
  /** Bundle id — secrets are namespaced per bundle (`bundleSecretKey`), not
   *  per placed instance, so this alone is enough to check the store. */
  bundleId: string;
  /** Declared secret keys (bare, not namespaced) this bundle needs. */
  secretKeys: string[];
}

/** Installed bundles that declare at least one `secret:` permission in the
 *  signed index — the pure half of ContentLibrary's `needsSetup` wiring
 *  (Important 4 of the whole-branch review). The impure half (checking each
 *  declared secret against the store via `getSecret`) has to stay in the
 *  component, but which bundles are even candidates, and which of their
 *  permissions name a secret, does not — extracted so that part is covered
 *  by a fast, deterministic test instead of only by an async effect that
 *  needs a live Tauri secret store to exercise at all.
 *
 *  Scoped to secrets, not the full "secrets/config" the original design
 *  sketch named: `config` is per PLACED INSTANCE (TileCredentialPanel.tsx —
 *  `tile.config.<bundleId>.<instanceId>`), so a catalog item (which has no
 *  instance) has no single correct "is config set" answer without making
 *  this component instance-aware, which is out of scope for this fix. A
 *  secret, unlike config, is namespaced per bundle only
 *  (`bundleSecretKey(bundleId, key)`, no instanceId) — so it DOES have one
 *  correct catalog-level answer, which is what this computes.
 *
 *  Only considers items the signed index describes: an installed folder
 *  alone (mergeCatalog's pass 2) carries no `permissions` of its own — only
 *  the index does (pass 3) — so a bundle unreachable in the index right now
 *  (offline, or simply not currently listed) cannot be flagged. This mirrors
 *  every other index-sourced fact already on `CatalogItem` (`downloads`, the
 *  "new" tag, the permissions shown in the install-confirm dialog), not a
 *  new limitation this function introduces. */
export function secretSetupCandidates(
  installedTiles: InstalledTileFolder[],
  installedViz: InstalledVizFolder[],
  indexByKey: Map<string, IndexBundle>,
): SecretSetupCandidate[] {
  const out: SecretSetupCandidate[] = [];
  const add = (kind: CatalogKind, id: string) => {
    const bundle = indexByKey.get(catalogKey(kind, id));
    if (!bundle || bundle.permissions.length === 0) return;
    const secretKeys: string[] = [];
    for (const p of bundle.permissions) {
      const parsed = parsePermission(p);
      if (parsed.ok && parsed.perm.kind === 'secret') secretKeys.push(parsed.perm.key);
    }
    if (secretKeys.length > 0) out.push({ key: catalogKey(kind, id), bundleId: id, secretKeys });
  };
  for (const f of installedTiles) if (f.source === 'marketplace') add('tile', f.id);
  for (const f of installedViz) if (f.source === 'marketplace') add('visualizer', f.id);
  return out;
}

/** Recomputes a bundle's rating for immediate UI feedback the instant the
 *  local user casts a vote, while `marketplace_rate`'s POST is still in
 *  flight — the "optimistically updates" half of Task 3's StarRating widget.
 *  Pure so ContentLibrary's handler is a thin wrapper around a tested
 *  decision, same pattern as `planRemoval`/`restoreDefaults`.
 *
 *  `previousStars` is the stars value THIS content-library session already
 *  optimistically voted for this same bundle, or `null` if it hasn't
 *  (ContentLibrary tracks this per bundle id — see its `votedStars` state).
 *  The two cases are handled differently, and the distinction is the whole
 *  point of this function:
 *
 *  - `previousStars == null` (first vote this session): treated as an
 *    ADDITIONAL vote — `avg*count + stars`, `count + 1`. This app has no "my
 *    current rating" endpoint, so it genuinely cannot tell a first-ever vote
 *    from a vote cast in an EARLIER session apart from this one — that
 *    residual gap is real but bounded to at most one phantom vote per
 *    catalog session, and self-heals on the next real `GET /ratings` fetch
 *    (e.g. reopening the catalog).
 *  - `previousStars != null` (a re-vote THIS session already knows about):
 *    REPLACES that earlier optimistic contribution rather than adding a new
 *    one — `count` stays fixed, `avg` shifts by `(stars - previousStars) /
 *    count` — matching the server's real `(bundle_id, user_id)` REPLACE
 *    semantics (`INSERT OR REPLACE`, server/src/ratings.rs) exactly.
 *
 *  D3 review (2026-07-31) caught an earlier version of this function
 *  (`applyOptimisticRating`, no `previousStars` parameter) that treated
 *  EVERY vote as additive — so changing your mind twice in one open Content
 *  Library session overcounted the local optimistic average by two phantom
 *  votes, not the one the old doc comment claimed as the worst case. This
 *  version removes that drift entirely for the common "changed my mind"
 *  case: see the sequential-re-vote test in catalog.test.ts, which casts
 *  three votes for the same bundle and asserts the count never moves past
 *  the first vote's `+1` and the average always reflects only the LATEST
 *  vote's contribution, not an accumulation of every vote cast along the
 *  way. */
export function applyOptimisticVote(
  current: RatingAgg | null,
  stars: number,
  previousStars: number | null,
): RatingAgg {
  if (current == null || current.count <= 0) return { avg: stars, count: 1 };
  if (previousStars != null) {
    return { avg: current.avg + (stars - previousStars) / current.count, count: current.count };
  }
  const count = current.count + 1;
  const avg = (current.avg * current.count + stars) / count;
  return { avg, count };
}

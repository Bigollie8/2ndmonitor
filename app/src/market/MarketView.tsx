import {
  useCallback, useEffect, useMemo, useReducer, useRef, useState, type MutableRefObject,
} from 'react';
import type { CatalogItem, IndexBundle } from '../state/catalog';
import type { SpectrumState } from '../state/tauri';
import { TILE_META } from '../state/tileMeta';
import { withoutRemoval } from '../state/removedContent';
import { applyOptimisticVote } from '../state/catalog';
import { useCatalogData } from '../state/useCatalogData';
import { browseReducer, INITIAL_BROWSE } from '../state/browseState';
import { storeLayoutFor } from '../state/storeLayout';
import { filterItems, EMPTY_FACETS, type Facets } from '../state/catalogFilter';
import { sortItems, type SortMode } from '../state/catalogSort';
import { searchItems } from '../components/catalogSearch';
import { buildShelves } from '../state/catalogShelves';
import { buildRail } from '../components/catalogRail';
import { describePermission } from '../state/permissionBadges';
import { cfgUrl } from '../state/marketplaceConfig';
import { MarketHeader } from './MarketHeader';
import { MarketSidebar, MarketKindStrip } from './MarketSidebar';
import { FilterChips } from './FilterChips';
import { MarketGrid } from './MarketGrid';
import { MarketShelf } from './MarketShelf';
import { MarketDetail } from './MarketDetail';
import { CollectionDetail } from './CollectionDetail';
import { AuthorPage } from './AuthorPage';
import { CreatorProfile } from './CreatorProfile';
import { MultiInstallDialog } from './MultiInstallDialog';
import { authorIndexOf } from '../state/authorIndex';
import { planMultiInstall, type InstallPlan } from '../state/installPlan';

const MONO = '"JetBrains Mono", ui-monospace, monospace';

const isEditableTarget = (t: EventTarget | null): boolean => {
  const el = t as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable;
};

/** The full-bleed store.
 *
 *  Owns a `browseReducer` and renders one of its views over the shared
 *  `useCatalogData`. Every decision it makes — which layout, which items,
 *  which window of a long list — is a pure function tested in isolation
 *  (state/storeLayout.ts, state/catalogFilter.ts, state/gridWindow.ts); what
 *  is here is composition and effects. */
export function MarketView({
  accent, accent2, spectrumRef, catalogRemoved, setCatalogRemoved, onClose, onOpenLibrary,
  onOpenProfile, initialFacets,
}: {
  accent: string;
  accent2: string;
  spectrumRef?: MutableRefObject<SpectrumState>;
  catalogRemoved: string[];
  setCatalogRemoved: (next: string[]) => void;
  onClose: () => void;
  onOpenLibrary: () => void;
  /** Opens the profile popout. The store closes itself first (App owns
   *  both), so the popout never has to fight this view's capture-phase Esc
   *  handler. */
  onOpenProfile?: () => void;
  /** Open straight into a filtered grid instead of Discover — e.g. the
   *  MilkDrop picker's "browse presets". Read once at mount, like
   *  `ContentLibrary`'s old `initialRail`: this is the starting point for a
   *  freshly-opened store, not a controlled value that keeps following the
   *  prop while the user navigates. */
  initialFacets?: Facets;
}) {
  const [browse, dispatch] = useReducer(
    browseReducer,
    initialFacets,
    (f) => (f ? { ...INITIAL_BROWSE, view: 'grid' as const, facets: f, sort: 'name' as const } : INITIAL_BROWSE),
  );
  const data = useCatalogData({ catalogRemoved });
  const [width, setWidth] = useState(() => window.innerWidth);
  useEffect(() => {
    const onResize = () => setWidth(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  const layout = storeLayoutFor(width);

  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [ratingBusy, setRatingBusy] = useState<string | null>(null);
  const [votedStars, setVotedStars] = useState<Record<string, number>>({});
  const [confirming, setConfirming] = useState<{ item: CatalogItem; bundle: IndexBundle } | null>(null);
  const [notice, setNotice] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [columns, setColumns] = useState(1);
  const searchRef = useRef<HTMLInputElement>(null);

  // Same 3s auto-clear, same single-timer discipline as ContentLibrary's
  // flash: a second message clears the first timer rather than stacking two.
  const flashTimer = useRef<ReturnType<typeof setTimeout>>();
  const flash = useCallback((msg: string) => {
    if (flashTimer.current !== undefined) clearTimeout(flashTimer.current);
    setNotice(msg);
    flashTimer.current = setTimeout(() => setNotice(''), 3000);
  }, []);
  useEffect(() => () => {
    if (flashTimer.current !== undefined) clearTimeout(flashTimer.current);
  }, []);

  // ── navigation ────────────────────────────────────────────────────────────

  const [escapedAt, setEscapedAt] = useState(0);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // Esc pops ONE level (detail -> grid -> discover) and only closes the
        // store when there is nothing left to pop. `browseReducer` signals
        // that by returning the SAME state reference for 'back' at the root.
        // Capture phase + stopPropagation so App's own Esc cascade does not
        // also fire and close something underneath.
        e.stopPropagation();
        dispatch({ type: 'back' });
        setEscapedAt((n) => n + 1);
        return;
      }
      // '/' focuses search, unless the user is already typing into something —
      // otherwise it would swallow a literal slash in the search box itself.
      if (e.key === '/' && !isEditableTarget(e.target)) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  // A 'back' that changed nothing means the root — close the store. Comparing
  // the reference is exactly the contract browseReducer documents; comparing
  // `view === 'discover'` instead would wrongly close on a back from a grid
  // reached directly.
  const prevBrowse = useRef(browse);
  useEffect(() => {
    if (escapedAt > 0 && prevBrowse.current === browse) onClose();
    prevBrowse.current = browse;
  }, [browse, escapedAt, onClose]);

  // ── derived lists ─────────────────────────────────────────────────────────

  // filter -> search -> sort. Search runs on the FILTERED set so a hit in a
  // category you did not select cannot surface, and sort runs last because
  // 'relevance' is identity over search's already-scored order.
  const gridItems = useMemo(() => {
    const filtered = filterItems(data.items, browse.facets, data.appVersion);
    const searched = searchItems(filtered, browse.query);
    return sortItems(searched, browse.sort, data.dates);
  }, [data.items, data.appVersion, data.dates, browse.facets, browse.query, browse.sort]);

  const rail = useMemo(
    () => buildRail(data.items, data.appVersion),
    [data.items, data.appVersion],
  );

  const shelves = useMemo(() => buildShelves({
    items: data.items,
    collections: data.collections,
    dates: data.dates,
    nowSec: Math.floor(Date.now() / 1000),
    appVersion: data.appVersion,
  }), [data.items, data.collections, data.dates, data.appVersion]);

  const selected = browse.selectedKey
    ? data.items.find((i) => i.key === browse.selectedKey)
    : undefined;

  const authorIndex = useMemo(() => authorIndexOf(data.items), [data.items]);

  const collection = browse.collectionSlug
    ? data.collections.find((c) => c.slug === browse.collectionSlug)
    : undefined;
  // Declared order, never re-sorted: curation is the whole contribution a
  // collection makes over a facet.
  const collectionItems = useMemo(() => {
    if (!collection) return [];
    const byId = new Map(data.items.map((i) => [i.id, i]));
    return collection.items
      .map((id) => byId.get(id))
      .filter((i): i is CatalogItem => i != null && !i.removed);
  }, [collection, data.items]);

  const glyphOf = useCallback((item: CatalogItem): string | null => (
    item.kind === 'tile' && Object.prototype.hasOwnProperty.call(TILE_META, item.id)
      ? TILE_META[item.id as keyof typeof TILE_META].icon
      : null
  ), []);

  // Reset the keyboard selection whenever the list underneath it changes —
  // an index into a list that no longer exists points at the wrong card.
  useEffect(() => { setSelectedIndex(-1); }, [gridItems]);

  // ── mutations ─────────────────────────────────────────────────────────────

  // Lifted from ContentLibrary rather than reimplemented: same command, same
  // arguments, same tombstone clearing, same preset event.
  const runInstall = useCallback(async (item: CatalogItem, bundle: IndexBundle) => {
    setConfirming(null);
    setBusyKey(item.key);
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('marketplace_install', {
        url: cfgUrl(), id: bundle.id, version: bundle.version, sha256: bundle.sha256, kind: bundle.kind,
      });
      // Clear any tombstone from a prior removal — otherwise the next
      // seed_sync skips the thing the user just asked to install.
      setCatalogRemoved(withoutRemoval(catalogRemoved, item.key));
      await data.refreshInstalled();
      if (item.kind === 'preset') window.dispatchEvent(new Event('market-presets:changed'));
      flash(`Installed ${item.name}`);
    } catch (e) {
      flash(String(e));
    } finally {
      setBusyKey(null);
    }
  }, [catalogRemoved, setCatalogRemoved, data, flash]);

  const handleInstall = useCallback((item: CatalogItem) => {
    const bundle = data.indexByKey.get(item.key);
    if (!bundle) { flash('Not available from the marketplace right now.'); return; }
    // A preset's `IndexBundle.permissions` is always `[]` — it's data, not
    // sandboxed code — so every preset takes the direct path, same as any
    // bundle that happens to declare nothing.
    if (bundle.permissions.length > 0) setConfirming({ item, bundle });
    else void runInstall(item, bundle);
  }, [data.indexByKey, runInstall, flash]);

  // ── multi-install ─────────────────────────────────────────────────────────

  const [multiPlan, setMultiPlan] = useState<InstallPlan | null>(null);
  const [multiBusy, setMultiBusy] = useState(false);
  const [multiProgress, setMultiProgress] = useState('');

  const runMultiInstall = useCallback(async (plan: InstallPlan) => {
    setMultiBusy(true);
    const done: string[] = [];
    const failed: string[] = [];
    try {
      // Sequentially, NOT concurrently: the busy lock exists to serialize
      // tombstone writes (each install computes its next removal list from
      // state captured at call time), and firing five at once defeats it.
      for (let i = 0; i < plan.toInstall.length; i++) {
        const { item } = plan.toInstall[i];
        setMultiProgress(`${i + 1} of ${plan.toInstall.length}`);
        const bundle = data.indexByKey.get(item.key);
        if (!bundle) { failed.push(item.name); continue; }
        try {
          const { invoke } = await import('@tauri-apps/api/core');
          await invoke('marketplace_install', {
            url: cfgUrl(), id: bundle.id, version: bundle.version,
            sha256: bundle.sha256, kind: bundle.kind,
          });
          setCatalogRemoved(withoutRemoval(catalogRemoved, item.key));
          if (item.kind === 'preset') window.dispatchEvent(new Event('market-presets:changed'));
          done.push(item.name);
        } catch {
          failed.push(item.name);
        }
      }
      await data.refreshInstalled();
    } finally {
      setMultiBusy(false);
      setMultiProgress('');
      setMultiPlan(null);
    }
    // Report what actually happened rather than a blanket success: a bulk
    // action that half-worked and said "Installed" is worse than one that
    // says "Installed 3 of 5 — Radar and Pollen failed."
    flash(failed.length === 0
      ? `Installed ${done.length}`
      : `Installed ${done.length} of ${done.length + failed.length} — ${failed.join(', ')} failed`);
  }, [data, catalogRemoved, setCatalogRemoved, flash]);

  const handleRate = useCallback(async (item: CatalogItem, stars: number) => {
    const bundleId = item.id;
    const previousStars = votedStars[bundleId] ?? null;
    const previousRating = data.ratings[bundleId] ?? null;
    setRatingBusy(bundleId);
    data.setRatings((prev) => ({
      ...prev, [bundleId]: applyOptimisticVote(previousRating, stars, previousStars),
    }));
    setVotedStars((prev) => ({ ...prev, [bundleId]: stars }));
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('marketplace_rate', { url: cfgUrl(), id: bundleId, stars });
    } catch (e) {
      // Roll the optimistic vote back to exactly what the server last told
      // us, rather than to a recomputed guess.
      data.setRatings((prev) => {
        const next = { ...prev };
        if (previousRating) next[bundleId] = previousRating;
        else delete next[bundleId];
        return next;
      });
      setVotedStars((prev) => {
        const next = { ...prev };
        if (previousStars != null) next[bundleId] = previousStars;
        else delete next[bundleId];
        return next;
      });
      flash(String(e));
    } finally {
      setRatingBusy(null);
    }
  }, [votedStars, data, flash]);

  // ── keyboard grid navigation ──────────────────────────────────────────────

  useEffect(() => {
    if (browse.view !== 'grid') return;
    const onKey = (e: KeyboardEvent) => {
      if (isEditableTarget(e.target)) return; // arrows still move the caret
      const total = gridItems.length;
      if (total === 0) return;
      let next: number | null = null;
      if (e.key === 'ArrowRight') next = Math.min(total - 1, selectedIndex + 1);
      else if (e.key === 'ArrowLeft') next = Math.max(0, selectedIndex - 1);
      else if (e.key === 'ArrowDown') next = Math.min(total - 1, Math.max(0, selectedIndex) + columns);
      else if (e.key === 'ArrowUp') next = Math.max(0, Math.max(0, selectedIndex) - columns);
      else if (e.key === 'Enter' && selectedIndex >= 0) {
        dispatch({ type: 'open-detail', key: gridItems[selectedIndex].key });
        return;
      }
      if (next == null) return;
      e.preventDefault();
      setSelectedIndex(next);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [browse.view, gridItems, selectedIndex, columns]);

  // ── bodies ────────────────────────────────────────────────────────────────

  const cardProps = {
    accent, accent2, spectrumRef, appVersion: data.appVersion, glyphOf,
  };

  const noMatches = browse.query.trim() !== '' && gridItems.length === 0;
  const hasFacets = Object.keys(EMPTY_FACETS).length >= 0 && (
    browse.facets.kind != null || browse.facets.category != null || browse.facets.tags.length > 0
    || browse.facets.installed === true || browse.facets.updates === true
    || browse.facets.needsSetup === true || browse.facets.hasPreview === true
    || browse.facets.noPermissions === true || browse.facets.removed === true
    || browse.facets.incompatible === true
  );

  const gridBody = (
    <>
      <div style={{ padding: '14px 18px 0' }}>
        <FilterChips
          accent={accent}
          facets={browse.facets}
          onRemove={(patch) => dispatch({ type: 'set-facets', facets: { ...browse.facets, ...patch } })}
          onClear={() => dispatch({ type: 'set-facets', facets: EMPTY_FACETS })}
        />
      </div>
      {noMatches ? (
        <div style={{ padding: '28px 18px', display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'flex-start' }}>
          <div style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.5)' }}>
            No matches for "{browse.query.trim()}"{hasFacets ? ' in the current filters' : ''}.
          </div>
          {hasFacets && (
            <button
              onClick={() => dispatch({ type: 'set-facets', facets: EMPTY_FACETS })}
              style={{
                padding: '4px 12px', fontSize: 11, fontWeight: 600, borderRadius: 6,
                background: `${accent}22`, color: accent, border: `1px solid ${accent}44`,
                cursor: 'pointer',
              }}
            >Search all content</button>
          )}
        </div>
      ) : (
        <MarketGrid
          items={gridItems}
          cardMin={layout.cardMin}
          selectedIndex={selectedIndex}
          onColumns={setColumns}
          onOpen={(item) => dispatch({ type: 'open-detail', key: item.key })}
          {...cardProps}
        />
      )}
    </>
  );

  const discoverBody = (
    <div style={{ flex: 1, overflowY: 'auto', padding: '16px 18px 18px' }}>
      {shelves.length === 0 ? (
        <div style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.45)', padding: '28px 0' }}>
          Nothing to show yet — the marketplace has no approved bundles this app can see.
        </div>
      ) : shelves.map((s) => (
        <MarketShelf
          key={s.id}
          shelf={s}
          cardMin={layout.cardMin}
          onSeeAll={() => {
            // A collection shelf opens its curated PAGE, not a facet grid —
            // its membership is a hand-picked list, which no facet can
            // express. Every other shelf declares facets that can.
            if (s.id.startsWith('collection:')) {
              dispatch({ type: 'open-collection', slug: s.id.slice('collection:'.length) });
            } else {
              dispatch({ type: 'open-shelf', facets: s.facets, sort: s.sort });
            }
          }}
          onOpen={(item) => dispatch({ type: 'open-detail', key: item.key })}
          {...cardProps}
        />
      ))}
    </div>
  );

  const detailBody = selected ? (
    <MarketDetail
      item={selected}
      history={data.history.get(selected.key)}
      accent={accent}
      accent2={accent2}
      spectrumRef={spectrumRef}
      appVersion={data.appVersion}
      glyph={glyphOf(selected)}
      busy={busyKey === selected.key}
      disabled={busyKey != null}
      signedIn={data.signedIn}
      ratingBusy={ratingBusy === selected.id}
      onRate={(stars) => void handleRate(selected, stars)}
      onInstall={() => handleInstall(selected)}
      onOpenLibrary={onOpenLibrary}
      onTag={(tag) => dispatch({ type: 'toggle-tag', tag })}
      onAuthor={(author) => dispatch({ type: 'open-author', author })}
      onReviewError={flash}
    />
  ) : (
    <div style={{ padding: 18, fontSize: 11.5, color: 'rgba(255,255,255,0.45)' }}>
      That item is no longer in the catalog.
    </div>
  );

  // In `wide`, detail is a pane beside the grid and pushes it; everywhere
  // else it takes the whole body, reached and left with Back.
  const body = browse.view === 'detail'
    ? (layout.detailAsPane
      ? (
        <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
          <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>{gridBody}</div>
          <div style={{
            width: layout.detailWidth, flexShrink: 0, display: 'flex', flexDirection: 'column',
            borderLeft: '1px solid rgba(255,255,255,0.06)', minHeight: 0,
          }}>{detailBody}</div>
        </div>
      )
      : <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>{detailBody}</div>)
    : browse.view === 'discover'
      ? discoverBody
      : browse.view === 'collection'
        ? (
          <CollectionDetail
            collection={collection}
            items={collectionItems}
            cardMin={layout.cardMin}
            onInstallAll={() => setMultiPlan(planMultiInstall(collectionItems, data.appVersion))}
            onOpen={(item) => dispatch({ type: 'open-detail', key: item.key })}
            {...cardProps}
          />
        )
        : browse.view === 'author'
          ? (
            // A handle means a real, server-backed creator page. Falling
            // back to AuthorPage keeps every bundle published before 0.9.0
            // (and any author who has not claimed a handle) reachable
            // instead of dead-ending on a 404.
            browse.author?.startsWith('@') ? (
              <CreatorProfile
                handle={browse.author.slice(1)}
                items={data.items}
                cardMin={layout.cardMin}
                onOpen={(item) => dispatch({ type: 'open-detail', key: item.key })}
                {...cardProps}
              />
            ) : (
              <AuthorPage
                summary={browse.author ? authorIndex.get(browse.author) : undefined}
                cardMin={layout.cardMin}
                onOpen={(item) => dispatch({ type: 'open-detail', key: item.key })}
                {...cardProps}
              />
            )
          )
          : <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>{gridBody}</div>;

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 60,
      display: 'flex', flexDirection: 'column',
      background: 'rgba(9,10,13,0.97)',
      backdropFilter: 'blur(18px)',
    }}>
      <MarketHeader
        ref={searchRef}
        accent={accent}
        browse={browse}
        canGoBack={browse.stack.length > 0}
        totalCount={browse.view === 'discover' ? data.items.length : gridItems.length}
        onBack={() => {
          const next = browseReducer(browse, { type: 'back' });
          if (next === browse) onClose(); else dispatch({ type: 'back' });
        }}
        onClose={onClose}
        onQuery={(q) => dispatch({ type: 'set-query', query: q })}
        onSort={(s: SortMode) => dispatch({ type: 'set-sort', sort: s })}
        onProfile={onOpenProfile}
      />

      {(data.indexUnreachable || data.usingCache) && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '8px 18px', flexShrink: 0,
          background: 'rgba(255,255,255,0.035)', borderBottom: '1px solid rgba(255,255,255,0.06)',
        }}>
          <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.6)', flex: 1 }}>
            {data.indexUnreachable
              ? 'marketplace unreachable — showing local content'
              : 'showing cached catalog — marketplace unreachable'}
          </span>
          <button
            onClick={() => void data.retryIndex()}
            disabled={data.retrying}
            style={{
              padding: '3px 10px', fontSize: 10.5, fontWeight: 600, borderRadius: 5,
              background: 'transparent', color: 'rgba(255,255,255,0.7)',
              border: '1px solid rgba(255,255,255,0.15)',
              cursor: data.retrying ? 'not-allowed' : 'pointer',
              opacity: data.retrying ? 0.55 : 1,
            }}
          >{data.retrying ? 'Retrying…' : 'Retry'}</button>
        </div>
      )}

      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        {layout.showSidebar && (
          <MarketSidebar
            accent={accent}
            rows={rail}
            activeFacets={browse.facets}
            width={layout.sidebarWidth}
            onPick={(f) => dispatch({ type: 'set-facets', facets: f })}
          />
        )}
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0, minHeight: 0 }}>
          {!layout.showSidebar && (
            <MarketKindStrip
              accent={accent}
              rows={rail}
              activeFacets={browse.facets}
              onPick={(f) => dispatch({ type: 'set-facets', facets: f })}
            />
          )}
          {body}
        </div>
      </div>

      {notice && (
        <div style={{
          position: 'absolute', bottom: 18, left: '50%', transform: 'translateX(-50%)',
          padding: '7px 14px', borderRadius: 8, fontSize: 11.5,
          background: 'rgba(20,22,28,0.96)', color: 'rgba(255,255,255,0.85)',
          border: '1px solid rgba(255,255,255,0.12)',
        }}>{notice}</div>
      )}

      {multiPlan && (
        <MultiInstallDialog
          plan={multiPlan}
          accent={accent}
          busy={multiBusy}
          progress={multiProgress}
          onCancel={() => setMultiPlan(null)}
          onConfirm={() => void runMultiInstall(multiPlan)}
        />
      )}

      {/* Install confirm — lifted from ContentLibrary with its gating rule
          unchanged: zero declared permissions installs directly, any
          permission prompts. */}
      {confirming && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 70,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'rgba(0,0,0,0.55)',
        }}>
          <div style={{
            width: 380, padding: 18, borderRadius: 12,
            background: 'rgba(18,20,26,0.98)', border: '1px solid rgba(255,255,255,0.1)',
          }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'rgba(255,255,255,0.92)' }}>
              Install {confirming.item.name}?
            </div>
            {confirming.item.summary && (
              <div style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.6)', marginTop: 6 }}>
                {confirming.item.summary}
              </div>
            )}
            <div style={{
              fontSize: 9, fontFamily: MONO, fontWeight: 700, letterSpacing: '0.12em',
              color: 'rgba(255,255,255,0.28)', textTransform: 'uppercase', margin: '14px 0 7px',
            }}>It will be able to</div>
            <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 5 }}>
              {confirming.bundle.permissions.map((p) => (
                <li key={p} style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.7)' }}>
                  · {describePermission(p)}
                </li>
              ))}
            </ul>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 18 }}>
              <button
                onClick={() => setConfirming(null)}
                style={{
                  padding: '5px 12px', fontSize: 11, fontWeight: 600, borderRadius: 6,
                  background: 'transparent', color: 'rgba(255,255,255,0.65)',
                  border: '1px solid rgba(255,255,255,0.12)', cursor: 'pointer',
                }}
              >Cancel</button>
              <button
                onClick={() => void runInstall(confirming.item, confirming.bundle)}
                style={{
                  padding: '5px 12px', fontSize: 11, fontWeight: 600, borderRadius: 6,
                  background: `${accent}22`, color: accent,
                  border: `1px solid ${accent}44`, cursor: 'pointer',
                }}
              >Install</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

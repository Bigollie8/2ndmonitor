// ─────────────────────────────────────────────────────────────────────────────
// Where the user is in the store, as one reducer.
//
// Pure module — no React, no Tauri — so every navigation rule is node-
// testable without mounting anything.
//
// Replaces `ContentLibrary`'s scattered `useState` (activeId, query) plus the
// `initialRail` prop. The stack is why shelf → grid → detail → back does not
// lose your filters, which is most of what made the old catalog feel one-way.
// ─────────────────────────────────────────────────────────────────────────────
import { EMPTY_FACETS, type Facets } from './catalogFilter';
import type { SortMode } from './catalogSort';

export type BrowseView = 'discover' | 'grid' | 'detail' | 'collection' | 'author';

export interface BrowseState {
  view: BrowseView;
  facets: Facets;
  sort: SortMode;
  query: string;
  selectedKey: string | null;
  collectionSlug: string | null;
  author: string | null;
  /** Previous states, for `back`. Bounded — see MAX_STACK. */
  stack: BrowseState[];
}

/** A deep history is not a feature anyone asked for, and an unbounded one is
 *  a slow leak in a long-lived modal. Sixteen is far past any real path. */
const MAX_STACK = 16;

export const INITIAL_BROWSE: BrowseState = {
  view: 'discover',
  facets: EMPTY_FACETS,
  sort: 'relevance',
  query: '',
  selectedKey: null,
  collectionSlug: null,
  author: null,
  stack: [],
};

export type BrowseAction =
  | { type: 'open-shelf'; facets: Facets; sort: SortMode }
  | { type: 'open-detail'; key: string }
  | { type: 'open-collection'; slug: string }
  | { type: 'open-author'; author: string }
  | { type: 'set-query'; query: string }
  | { type: 'set-sort'; sort: SortMode }
  | { type: 'set-facets'; facets: Facets }
  | { type: 'toggle-tag'; tag: string }
  | { type: 'back' }
  | { type: 'reset' };

/** Snapshot without its own stack, so pushing does not nest histories. */
const frame = (s: BrowseState): BrowseState => ({ ...s, stack: [] });

const push = (s: BrowseState, next: Partial<BrowseState>): BrowseState => ({
  ...s,
  ...next,
  stack: [...s.stack, frame(s)].slice(-MAX_STACK),
});

const hasFacets = (f: Facets): boolean =>
  f.kind != null || f.category != null || f.tags.length > 0 ||
  f.installed === true || f.updates === true || f.needsSetup === true ||
  f.hasPreview === true || f.noPermissions === true || f.removed === true ||
  f.incompatible === true;

export function browseReducer(state: BrowseState, action: BrowseAction): BrowseState {
  switch (action.type) {
    case 'open-shelf':
      return push(state, { view: 'grid', facets: action.facets, sort: action.sort });

    case 'open-detail':
      return push(state, { view: 'detail', selectedKey: action.key });

    case 'open-collection':
      return push(state, { view: 'collection', collectionSlug: action.slug });

    case 'open-author':
      return push(state, { view: 'author', author: action.author });

    case 'set-query': {
      const query = action.query;
      if (query.trim() === '') {
        // Clearing a search returns to Discover only when there is nothing
        // else selected — otherwise the user still has a filtered grid open
        // and yanking them to the home screen would discard it.
        const view: BrowseView = hasFacets(state.facets) ? 'grid' : 'discover';
        return { ...state, query, view };
      }
      // Searching from Discover needs somewhere to show results; Discover is
      // shelves, not a result list.
      return { ...state, query, view: 'grid', sort: 'relevance' };
    }

    case 'set-sort':
      return { ...state, sort: action.sort };

    case 'set-facets':
      return { ...state, facets: action.facets, view: 'grid' };

    case 'toggle-tag': {
      const has = state.facets.tags.includes(action.tag);
      const tags = has
        ? state.facets.tags.filter((t) => t !== action.tag)
        : [...state.facets.tags, action.tag];
      return { ...state, facets: { ...state.facets, tags }, view: 'grid' };
    }

    case 'back': {
      // Returning the SAME REFERENCE is the caller's signal that there is
      // nothing left to pop and Esc should close the store instead.
      if (state.stack.length === 0) return state;
      const prev = state.stack[state.stack.length - 1];
      return { ...prev, stack: state.stack.slice(0, -1) };
    }

    case 'reset':
      return INITIAL_BROWSE;

    default:
      return state;
  }
}

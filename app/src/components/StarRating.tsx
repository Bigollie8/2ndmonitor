import type { RatingAgg } from '../state/catalog';

const MONO = '"JetBrains Mono", ui-monospace, monospace';
const FILLED = '#fbbf24';
const EMPTY = 'rgba(255,255,255,0.22)';

export interface RatingViewModel {
  /** 0-5 — how many stars render filled. `Math.round(avg)`, or 0 when there
   *  is nothing to round (no rating yet). */
  filledStars: number;
  /** What the count badge next to the stars should read — empty string when
   *  there's nothing to show, never "(0)" (the server never reports a
   *  zero-count bundle at all; see RatingAgg's doc comment). */
  countLabel: string;
  /** Whether a star click should be wired up at all. `false` whenever
   *  `signedIn` is `false` OR `ratable` is `false`, independent of whether a
   *  rating exists yet. */
  interactive: boolean;
  /** The whole widget's title/tooltip. Distinct, explicit copy for each
   *  reason it might be inert — "you can't do this right now, here's why" —
   *  rather than just omitting the click handler and leaving the reason
   *  unstated. */
  tooltip: string;
}

/** The display rule for a catalog card's rating widget: what to show for a
 *  `null` rating (nobody has voted, or the ratings fetch failed — the two
 *  are indistinguishable here by design, see catalog.ts's `MergeCatalogArgs.
 *  ratings` doc comment), a present rating with a real count, the signed-out
 *  state, and a non-`ratable` item. Pure — no React, no Tauri — so every one
 *  of those combinations is node-testable without mounting `StarRating`, the
 *  same pattern `previewSourceFor`/`catalogCardTags` already use for this
 *  card.
 *
 *  `ratable` is the caller's business-rule input, not derived here: pass
 *  `item.source !== 'first-party'` (CatalogCard.tsx). D3 review (2026-07-31)
 *  caught this being missing entirely — `StarRating` rendered fully
 *  interactive stars for core built-ins like Mixer, which the server always
 *  400s (they aren't marketplace bundles), so a signed-in user saw a
 *  flickering fake optimistic rating followed by an error flash on every
 *  click. `ratable` outranks `signedIn` in the tooltip: a first-party item
 *  is inert for a DIFFERENT reason than being signed out, and the message
 *  says which. */
export function ratingDisplay(rating: RatingAgg | null, signedIn: boolean, ratable: boolean): RatingViewModel {
  const hasVotes = rating != null && rating.count > 0;
  const filledStars = hasVotes ? Math.round(rating.avg) : 0;
  const countLabel = hasVotes ? `(${rating.count})` : '';
  const interactive = signedIn && ratable;
  const summary = hasVotes ? `${rating.avg.toFixed(1)} average from ${rating.count} rating${rating.count === 1 ? '' : 's'}` : 'No ratings yet';
  const tooltip = !ratable
    ? 'Built-in features aren’t rated'
    : signedIn
      ? `${summary} — click a star to rate`
      : 'Sign in (Settings → Marketplace) to rate';
  return { filledStars, countLabel, interactive, tooltip };
}

/** A catalog card's star rating: the aggregate average/count from `GET
 *  /ratings`, and — only when signed in AND `ratable` — a click-to-rate
 *  affordance that posts through `marketplace_rate`. Signed out, or for a
 *  non-ratable (first-party) item, the same five stars render but neither
 *  respond to clicks nor change cursor; `ratingDisplay`'s `tooltip` is the
 *  only signal telling the user why, exactly like a disabled action button
 *  elsewhere in this card. The optimistic update itself (recomputing
 *  `rating` before the POST resolves) is the caller's job — see
 *  `applyOptimisticVote` in state/catalog.ts and ContentLibrary.tsx's
 *  `handleRate` — this component only renders whatever `rating` it's
 *  handed. */
export function StarRating({
  rating, signedIn, ratable, busy, onRate,
}: {
  rating: RatingAgg | null;
  signedIn: boolean;
  /** Whether this item can be rated at all — `false` for a first-party
   *  built-in (see `ratingDisplay`'s doc comment). Passed in, computed by
   *  the caller from `item.source !== 'first-party'` — kept out of this
   *  component so the business rule lives in one place (CatalogCard.tsx). */
  ratable: boolean;
  /** This bundle's own rate request is in flight — locks the stars so a
   *  second click can't race the first's optimistic update. */
  busy: boolean;
  onRate: (stars: number) => void;
}) {
  const view = ratingDisplay(rating, signedIn, ratable);
  const clickable = view.interactive && !busy;
  return (
    <div
      title={view.tooltip}
      style={{ display: 'flex', alignItems: 'center', gap: 3 }}
    >
      {[1, 2, 3, 4, 5].map((n) => (
        <span
          key={n}
          onClick={clickable ? () => onRate(n) : undefined}
          role={clickable ? 'button' : undefined}
          aria-label={clickable ? `Rate ${n} star${n === 1 ? '' : 's'}` : undefined}
          style={{
            fontSize: 11, lineHeight: 1,
            color: n <= view.filledStars ? FILLED : EMPTY,
            cursor: clickable ? 'pointer' : 'default',
            opacity: busy ? 0.5 : 1,
          }}
        >★</span>
      ))}
      {view.countLabel && (
        <span style={{ fontSize: 9, fontFamily: MONO, color: 'rgba(255,255,255,0.4)' }}>
          {view.countLabel}
        </span>
      )}
    </div>
  );
}

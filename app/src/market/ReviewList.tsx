import { useEffect, useState } from 'react';
import { cfgUrl } from '../state/marketplaceConfig';

const MONO = '"JetBrains Mono", ui-monospace, monospace';

export interface Review {
  author: string;
  body: string;
  createdAt: number;
  stars: number | null;
}

/** Written reviews for one bundle.
 *
 *  Lazy — fetched when the detail view opens, not with the index: reviews are
 *  per-bundle prose nobody reads until they have chosen a bundle to look at,
 *  and putting them in the signed index would bloat every catalog load.
 *
 *  Same silent-failure contract as ratings: a failed fetch leaves the section
 *  empty rather than surfacing an error. */
export function ReviewList({ bundleId, accent, reloadKey }: {
  bundleId: string;
  accent: string;
  /** Bumped by the form after a successful post, so the list re-reads. */
  reloadKey: number;
}) {
  const [reviews, setReviews] = useState<Review[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    setReviews(null);
    void (async () => {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        const res = await invoke<{ reviews: Review[] }>('marketplace_fetch_reviews', {
          url: cfgUrl(), id: bundleId,
        });
        if (!cancelled) setReviews(res.reviews ?? []);
      } catch {
        // Silent, exactly like a missing preview image.
        if (!cancelled) setReviews([]);
      }
    })();
    return () => { cancelled = true; };
  }, [bundleId, reloadKey]);

  if (reviews == null) {
    return <div style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.35)' }}>Loading reviews…</div>;
  }

  if (reviews.length === 0) {
    // With a small user base most bundles will have no reviews for a long
    // time. "No reviews yet" plus an invitation reads better than an empty
    // section that looks broken — and much better than hiding the section,
    // which would make the feature undiscoverable.
    return (
      <div style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.45)' }}>
        No reviews yet — if you use this, yours would be the first.
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {reviews.map((r) => (
        <div key={`${r.author}:${r.createdAt}`}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <span style={{ fontSize: 11, fontFamily: MONO, color: accent }}>{r.author}</span>
            {r.stars != null && (
              <span style={{ fontSize: 10, fontFamily: MONO, color: 'rgba(255,255,255,0.5)' }}>
                {'★'.repeat(r.stars)}{'☆'.repeat(5 - r.stars)}
              </span>
            )}
            <span style={{ fontSize: 10, fontFamily: MONO, color: 'rgba(255,255,255,0.28)' }}>
              {new Date(r.createdAt * 1000).toLocaleDateString()}
            </span>
          </div>
          <div style={{
            fontSize: 11.5, color: 'rgba(255,255,255,0.7)', lineHeight: 1.45,
            marginTop: 3, whiteSpace: 'pre-wrap',
          }}>{r.body}</div>
        </div>
      ))}
    </div>
  );
}

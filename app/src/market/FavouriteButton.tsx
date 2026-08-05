import { useEffect, useState } from 'react';
import { fetchFavourites, setFavourite } from '../state/social';

const MONO = '"JetBrains Mono", ui-monospace, monospace';

/** The ★ on a bundle: public count, private membership.
 *
 *  Whether it is YOUR favourite is private to you; the number is everyone's.
 *  That split is the server's design (see server/src/social.rs) — this
 *  component just renders both halves of one response. */
export function FavouriteButton({ bundleId, accent, signedIn }: {
  bundleId: string;
  accent: string;
  signedIn: boolean;
}) {
  const [count, setCount] = useState<number | null>(null);
  const [mine, setMine] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setCount(null);
    setMine(false);
    void fetchFavourites()
      .then((f) => {
        if (cancelled) return;
        setCount(f.counts[bundleId] ?? 0);
        setMine(f.mine.includes(bundleId));
      })
      .catch(() => {
        // Read path: silent, like a missing rating.
      });
    return () => { cancelled = true; };
  }, [bundleId]);

  const toggle = async () => {
    if (!signedIn || busy) return;
    const next = !mine;
    setBusy(true);
    setError('');
    setMine(next);
    setCount((n) => (n == null ? n : Math.max(0, n + (next ? 1 : -1))));
    try {
      await setFavourite(bundleId, next);
    } catch (e) {
      setMine(!next);
      setCount((n) => (n == null ? n : Math.max(0, n + (next ? -1 : 1))));
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
      <button
        onClick={() => void toggle()}
        disabled={!signedIn || busy}
        aria-label={mine ? 'Remove from favourites' : 'Add to favourites'}
        title={signedIn ? (mine ? 'Remove from favourites' : 'Add to favourites') : 'Sign in to favourite'}
        style={{
          background: 'transparent', border: 'none', padding: 0,
          cursor: signedIn && !busy ? 'pointer' : 'not-allowed',
          fontSize: 15, lineHeight: 1,
          color: mine ? accent : 'rgba(255,255,255,0.35)',
          opacity: signedIn ? 1 : 0.55,
        }}
      >{mine ? '★' : '☆'}</button>
      {count != null && (
        <span style={{ fontSize: 10, fontFamily: MONO, color: 'rgba(255,255,255,0.4)' }}>{count}</span>
      )}
      {error && <span style={{ fontSize: 10, color: '#fb7185' }}>{error}</span>}
    </div>
  );
}

import { useEffect, useState } from 'react';
import { fetchFollowStatus, setFollow } from '../state/social';

const MONO = '"JetBrains Mono", ui-monospace, monospace';

/** Follow / Following, with the public count.
 *
 *  The count renders signed out (it is public); the toggle needs a session.
 *  Toggling is optimistic and rolls back on failure with the server's own
 *  words — a follow is a user action, so its failure is never silent. */
export function FollowButton({ handle, accent, signedIn }: {
  handle: string;
  accent: string;
  signedIn: boolean;
}) {
  const [followers, setFollowers] = useState<number | null>(null);
  const [following, setFollowing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setFollowers(null);
    setFollowing(false);
    void fetchFollowStatus(handle)
      .then((s) => {
        if (cancelled) return;
        setFollowers(s.followers);
        setFollowing(s.following);
      })
      .catch(() => {
        // Read path: silent. A blank count never blocks browsing.
      });
    return () => { cancelled = true; };
  }, [handle]);

  const toggle = async () => {
    if (!signedIn || busy) return;
    const next = !following;
    setBusy(true);
    setError('');
    // Optimistic, like the star rating: the number moves the instant you act.
    setFollowing(next);
    setFollowers((n) => (n == null ? n : n + (next ? 1 : -1)));
    try {
      await setFollow(handle, next);
    } catch (e) {
      setFollowing(!next);
      setFollowers((n) => (n == null ? n : n + (next ? -1 : 1)));
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <button
        onClick={() => void toggle()}
        disabled={!signedIn || busy}
        title={signedIn ? undefined : 'Sign in to follow creators'}
        style={{
          padding: '4px 12px', fontSize: 11, fontWeight: 600, borderRadius: 999,
          background: following ? 'rgba(255,255,255,0.05)' : `${accent}22`,
          color: following ? 'rgba(255,255,255,0.65)' : accent,
          border: following ? '1px solid rgba(255,255,255,0.14)' : `1px solid ${accent}44`,
          cursor: signedIn && !busy ? 'pointer' : 'not-allowed',
          opacity: signedIn ? 1 : 0.55,
        }}
      >{following ? 'Following' : 'Follow'}</button>
      {followers != null && (
        <span style={{ fontSize: 10.5, fontFamily: MONO, color: 'rgba(255,255,255,0.4)' }}>
          {followers} follower{followers === 1 ? '' : 's'}
        </span>
      )}
      {error && <span style={{ fontSize: 10.5, color: '#fb7185' }}>{error}</span>}
    </div>
  );
}

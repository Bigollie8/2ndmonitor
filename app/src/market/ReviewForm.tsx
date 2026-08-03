import { useState } from 'react';
import { cfgUrl } from '../state/marketplaceConfig';

const MONO = '"JetBrains Mono", ui-monospace, monospace';
const MAX_BODY = 1000; // mirrors server/src/reviews.rs

/** Post or replace a written review.
 *
 *  Signed-in only, gated on the same status `StarRating`'s click-to-rate
 *  uses; signed out shows the same kind of pointer at Settings → Marketplace
 *  rather than a disabled box with no explanation.
 *
 *  NOT gated on having installed this bundle. There is no per-user install
 *  record anywhere — downloads is a bare counter — so such a gate is not
 *  implementable, and a client-side one would be both bypassable and a
 *  misrepresentation of what the server enforces. */
export function ReviewForm({ bundleId, accent, signedIn, onPosted, onError }: {
  bundleId: string;
  accent: string;
  signedIn: boolean;
  onPosted: () => void;
  onError: (message: string) => void;
}) {
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);

  if (!signedIn) {
    return (
      <div style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.45)' }}>
        Sign in under Settings → Marketplace to leave a review.
      </div>
    );
  }

  const over = body.length > MAX_BODY;
  const canPost = body.trim().length > 0 && !over && !busy;

  const submit = async () => {
    setBusy(true);
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('marketplace_post_review', { url: cfgUrl(), id: bundleId, body });
      setBody('');
      onPosted();
    } catch (e) {
      // Deliberately NOT silent, unlike the fetch: the user typed something
      // and deserves to know it did not land.
      onError(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="What is it like to actually use this?"
        rows={3}
        style={{
          resize: 'vertical', padding: '7px 9px', fontSize: 11.5, borderRadius: 7,
          background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.9)',
          border: '1px solid rgba(255,255,255,0.1)', outline: 'none',
          fontFamily: 'inherit',
        }}
      />
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{
          fontSize: 10, fontFamily: MONO,
          color: over ? '#ff9b9b' : 'rgba(255,255,255,0.3)',
        }}>{body.length}/{MAX_BODY}</span>
        <div style={{ flex: 1 }} />
        {/* Posting REPLACES any earlier review by the same account -- the
            server's (bundle_id, user_id) key makes that the only outcome, so
            the label says so rather than implying a second one stacks. */}
        <button
          onClick={() => void submit()}
          disabled={!canPost}
          style={{
            padding: '4px 12px', fontSize: 11, fontWeight: 600, borderRadius: 6,
            background: `${accent}22`, color: accent, border: `1px solid ${accent}44`,
            cursor: canPost ? 'pointer' : 'not-allowed', opacity: canPost ? 1 : 0.5,
          }}
        >{busy ? 'Posting…' : 'Post or replace review'}</button>
      </div>
    </div>
  );
}

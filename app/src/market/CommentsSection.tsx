import { useEffect, useState } from 'react';
import {
  fetchComments, postComment, setBlock, report, deleteOwnComment, type CommentEntry,
} from '../state/social';

const MONO = '"JetBrains Mono", ui-monospace, monospace';
const MAX_BODY = 1000; // mirrors server/src/comments.rs

/** Flat, plain-text comments on one bundle.
 *
 *  The body renders as TEXT — React never interprets it — which together
 *  with the server storing it verbatim is the entire XSS story. No markdown,
 *  no links, on purpose: one decision instead of three defences.
 *
 *  Per-comment actions are the user's half of moderation: report (goes to
 *  the admin queue) and block (their comments stop appearing for you,
 *  enforced server-side so a modified client cannot undo it). */
export function CommentsSection({ bundleId, accent, signedIn, myHandle }: {
  bundleId: string;
  accent: string;
  signedIn: boolean;
  /** Your own handle, so your comments offer delete instead of report. */
  myHandle?: string | null;
}) {
  const [comments, setComments] = useState<CommentEntry[] | null>(null);
  const [reload, setReload] = useState(0);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');

  useEffect(() => {
    let cancelled = false;
    setComments(null);
    void fetchComments(bundleId)
      .then((c) => { if (!cancelled) setComments(c); })
      .catch(() => { if (!cancelled) setComments([]); });
    return () => { cancelled = true; };
  }, [bundleId, reload]);

  const submit = async () => {
    if (!draft.trim() || busy) return;
    setBusy(true);
    setError('');
    try {
      await postComment(bundleId, draft);
      setDraft('');
      setReload((n) => n + 1);
    } catch (e) {
      // A write the user typed — its failure is theirs to see.
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const doDelete = async (c: CommentEntry) => {
    try {
      await deleteOwnComment(c.id);
      setReload((n) => n + 1);
    } catch (e) {
      setError(String(e));
    }
  };

  const doReport = async (c: CommentEntry) => {
    try {
      await report('comment', String(c.id), 'reported from the app');
      setNote(`Reported ${c.handle ? `@${c.handle}` : 'comment'} — a moderator will look at it.`);
    } catch (e) {
      setError(String(e));
    }
  };

  const doBlock = async (c: CommentEntry) => {
    if (!c.handle) return;
    try {
      await setBlock(c.handle, true);
      setNote(`Blocked @${c.handle}. Their comments will no longer appear for you.`);
      setReload((n) => n + 1);
    } catch (e) {
      setError(String(e));
    }
  };

  const over = draft.length > MAX_BODY;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {signedIn ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Say something about this — plain text only"
            rows={2}
            style={{
              resize: 'vertical', padding: '7px 9px', fontSize: 11.5, borderRadius: 7,
              background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.9)',
              border: '1px solid rgba(255,255,255,0.1)', outline: 'none', fontFamily: 'inherit',
            }}
          />
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{
              fontSize: 10, fontFamily: MONO,
              color: over ? '#ff9b9b' : 'rgba(255,255,255,0.3)',
            }}>{draft.length}/{MAX_BODY}</span>
            <div style={{ flex: 1 }} />
            <button
              onClick={() => void submit()}
              disabled={busy || !draft.trim() || over}
              style={{
                padding: '4px 12px', fontSize: 11, fontWeight: 600, borderRadius: 6,
                background: `${accent}22`, color: accent, border: `1px solid ${accent}44`,
                cursor: busy || !draft.trim() || over ? 'not-allowed' : 'pointer',
                opacity: busy || !draft.trim() || over ? 0.5 : 1,
              }}
            >{busy ? 'Posting…' : 'Comment'}</button>
          </div>
        </div>
      ) : (
        <div style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.45)' }}>
          Sign in to join the conversation.
        </div>
      )}

      {error && <div style={{ fontSize: 11, color: '#fb7185' }}>{error}</div>}
      {note && <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.55)' }}>{note}</div>}

      {comments == null ? (
        <div style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.35)' }}>Loading comments…</div>
      ) : comments.length === 0 ? (
        <div style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.45)' }}>
          No comments yet.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {comments.map((c) => (
            <div key={c.id}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                <span style={{ fontSize: 11, fontFamily: MONO, color: accent }}>
                  {c.handle ? `@${c.handle}` : c.displayName ?? 'someone'}
                </span>
                <span style={{ fontSize: 10, fontFamily: MONO, color: 'rgba(255,255,255,0.28)' }}>
                  {new Date(c.createdAt * 1000).toLocaleDateString()}
                </span>
                <div style={{ flex: 1 }} />
                {signedIn && myHandle && c.handle === myHandle ? (
                  // Your own words are yours to retract. Nobody should have
                  // to ask a moderator to remove their own typo — or their
                  // own email address.
                  <button
                    onClick={() => void doDelete(c)}
                    style={{
                      background: 'transparent', border: 'none', padding: 0, cursor: 'pointer',
                      fontSize: 9.5, fontFamily: MONO, color: 'rgba(255,255,255,0.3)',
                    }}
                  >delete</button>
                ) : signedIn && (
                  <>
                    <button
                      onClick={() => void doReport(c)}
                      style={{
                        background: 'transparent', border: 'none', padding: 0, cursor: 'pointer',
                        fontSize: 9.5, fontFamily: MONO, color: 'rgba(255,255,255,0.3)',
                      }}
                    >report</button>
                    {c.handle && (
                      <button
                        onClick={() => void doBlock(c)}
                        style={{
                          background: 'transparent', border: 'none', padding: 0, cursor: 'pointer',
                          fontSize: 9.5, fontFamily: MONO, color: 'rgba(255,255,255,0.3)',
                        }}
                      >block</button>
                    )}
                  </>
                )}
              </div>
              {/* Rendered as TEXT. Never dangerouslySetInnerHTML, never a
                  markdown pass — that is the whole XSS defence. */}
              <div style={{
                fontSize: 11.5, color: 'rgba(255,255,255,0.7)', lineHeight: 1.45,
                marginTop: 3, whiteSpace: 'pre-wrap',
              }}>{c.body}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

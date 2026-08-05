import { useEffect, useState } from 'react';
import {
  fetchTopics, createTopic, fetchReplies, createReply,
  type Topic, type Reply,
} from '../state/community';
import { avatarSrc } from '../state/avatarUrl';
import { report, setBlock } from '../state/social';

const MONO = '"JetBrains Mono", ui-monospace, monospace';

const when = (sec: number) => new Date(sec * 1000).toLocaleDateString();

function Author({ handle, displayName, avatarSeed, accent, hasAvatar, fallbackAccent }: {
  handle: string | null;
  displayName: string | null;
  avatarSeed: string | null;
  accent: string | null;
  hasAvatar?: boolean;
  fallbackAccent: string;
}) {
  const tint = accent ?? fallbackAccent;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <img
        src={avatarSrc({ handle, hasAvatar, seed: avatarSeed, size: 20 })}
        alt="" width={20} height={20}
        style={{ borderRadius: 5, objectFit: 'cover', border: `1px solid ${tint}44` }}
      />
      <span style={{ fontSize: 10.5, fontFamily: MONO, color: tint }}>
        {handle ? `@${handle}` : displayName ?? 'someone'}
      </span>
    </span>
  );
}

/** Topics and flat replies.
 *
 *  Plain text throughout, rendered as TEXT — never markdown, never
 *  dangerouslySetInnerHTML. That one decision is the whole XSS story, and it
 *  is the same one comments and the shoutbox make.
 *
 *  `bundleId` scopes the board to one bundle's discussion; omitted, it is the
 *  general board. That is the only structure there is. */
export function ForumView({ accent, signedIn, bundleId }: {
  accent: string;
  signedIn: boolean;
  bundleId?: string | null;
}) {
  const [topics, setTopics] = useState<Topic[] | null>(null);
  const [open, setOpen] = useState<Topic | null>(null);
  const [replies, setReplies] = useState<Reply[] | null>(null);
  const [composing, setComposing] = useState(false);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [replyDraft, setReplyDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [reload, setReload] = useState(0);
  const [search, setSearch] = useState('');

  useEffect(() => {
    let cancelled = false;
    // Debounced, and searched on the SERVER: filtering a truncated first page
    // in the client would quietly hide topics.
    const timer = setTimeout(() => {
      void fetchTopics(bundleId, search)
        .then((t) => { if (!cancelled) setTopics(t); })
        .catch(() => { if (!cancelled) setTopics([]); });
    }, search ? 220 : 0);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [bundleId, reload, search]);

  useEffect(() => {
    if (!open) { setReplies(null); return; }
    let cancelled = false;
    setReplies(null);
    void fetchReplies(open.id)
      .then((r) => { if (!cancelled) setReplies(r); })
      .catch(() => { if (!cancelled) setReplies([]); });
    return () => { cancelled = true; };
  }, [open, reload]);

  const submitTopic = async () => {
    if (busy || !title.trim() || !body.trim()) return;
    setBusy(true); setError('');
    try {
      await createTopic(title, body, bundleId);
      setTitle(''); setBody(''); setComposing(false);
      setReload((n) => n + 1);
    } catch (e) {
      setError(String(e));
    } finally { setBusy(false); }
  };

  const submitReply = async () => {
    if (busy || !open || !replyDraft.trim()) return;
    setBusy(true); setError('');
    try {
      await createReply(open.id, replyDraft);
      setReplyDraft('');
      setReload((n) => n + 1);
    } catch (e) {
      setError(String(e));
    } finally { setBusy(false); }
  };

  const doReport = async (kind: 'topic' | 'reply', id: number, who: string | null) => {
    try {
      await report(kind, String(id), 'reported from the forum');
      setNote(`Reported ${who ? `@${who}` : 'post'} — a moderator will look at it.`);
    } catch (e) { setError(String(e)); }
  };

  const doBlock = async (who: string | null) => {
    if (!who) return;
    try {
      await setBlock(who, true);
      setNote(`Blocked @${who}.`);
      setReload((n) => n + 1);
    } catch (e) { setError(String(e)); }
  };

  const fieldStyle: React.CSSProperties = {
    width: '100%', padding: '7px 9px', fontSize: 11.5, borderRadius: 7,
    background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.9)',
    border: '1px solid rgba(255,255,255,0.1)', outline: 'none',
    fontFamily: 'inherit', boxSizing: 'border-box',
  };

  // ── one topic, opened ────────────────────────────────────────────────────
  if (open) {
    return (
      <div style={{ flex: 1, overflowY: 'auto', padding: 18 }}>
        <button
          onClick={() => setOpen(null)}
          style={{
            background: 'transparent', border: 'none', padding: 0, cursor: 'pointer',
            fontSize: 11, fontFamily: MONO, color: accent, marginBottom: 12,
          }}
        >‹ all topics</button>

        <div style={{ fontSize: 16, fontWeight: 700, color: 'rgba(255,255,255,0.95)' }}>
          {open.title}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
          <Author {...open} fallbackAccent={accent} />
          <span style={{ fontSize: 9.5, fontFamily: MONO, color: 'rgba(255,255,255,0.28)' }}>
            {when(open.createdAt)}
          </span>
        </div>
        <div style={{
          fontSize: 12, color: 'rgba(255,255,255,0.72)', lineHeight: 1.5,
          marginTop: 10, whiteSpace: 'pre-wrap',
        }}>{open.body}</div>

        <div style={{ height: 1, background: 'rgba(255,255,255,0.06)', margin: '16px 0' }} />

        {error && <div style={{ fontSize: 11, color: '#fb7185', marginBottom: 8 }}>{error}</div>}
        {note && <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.55)', marginBottom: 8 }}>{note}</div>}

        {replies == null ? (
          <div style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.35)' }}>Loading replies…</div>
        ) : replies.length === 0 ? (
          <div style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.45)' }}>No replies yet.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {replies.map((r) => (
              <div key={r.id}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Author {...r} fallbackAccent={accent} />
                  <span style={{ fontSize: 9.5, fontFamily: MONO, color: 'rgba(255,255,255,0.28)' }}>
                    {when(r.createdAt)}
                  </span>
                  <div style={{ flex: 1 }} />
                  {signedIn && (
                    <>
                      <button onClick={() => void doReport('reply', r.id, r.handle)} style={linkBtn}>report</button>
                      {r.handle && <button onClick={() => void doBlock(r.handle)} style={linkBtn}>block</button>}
                    </>
                  )}
                </div>
                <div style={{
                  fontSize: 11.5, color: 'rgba(255,255,255,0.7)', lineHeight: 1.45,
                  marginTop: 3, whiteSpace: 'pre-wrap',
                }}>{r.body}</div>
              </div>
            ))}
          </div>
        )}

        {signedIn ? (
          <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <textarea
              value={replyDraft}
              onChange={(e) => setReplyDraft(e.target.value)}
              placeholder="Reply — plain text only"
              rows={3}
              style={{ ...fieldStyle, resize: 'vertical' }}
            />
            <div>
              <button
                onClick={() => void submitReply()}
                disabled={busy || !replyDraft.trim()}
                style={primaryBtn(accent, busy || !replyDraft.trim())}
              >{busy ? 'Posting…' : 'Reply'}</button>
            </div>
          </div>
        ) : (
          <div style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.45)', marginTop: 16 }}>
            Sign in to reply.
          </div>
        )}
      </div>
    );
  }

  // ── the topic list ───────────────────────────────────────────────────────
  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: 18 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,0.9)' }}>
          {bundleId ? 'Discussion' : 'Forum'}
        </div>
        <div style={{ flex: 1 }} />
        {signedIn && (
          <button onClick={() => setComposing((c) => !c)} style={primaryBtn(accent, false)}>
            {composing ? 'Cancel' : 'New topic'}
          </button>
        )}
      </div>

      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search topics…"
        spellCheck={false}
        style={{
          width: '100%', maxWidth: 320, marginTop: 10, padding: '6px 9px', fontSize: 11.5,
          background: 'rgba(255,255,255,0.05)', color: '#fff', outline: 'none',
          border: '1px solid rgba(255,255,255,0.1)', borderRadius: 7, boxSizing: 'border-box',
        }}
      />

      {error && <div style={{ fontSize: 11, color: '#fb7185', marginTop: 10 }}>{error}</div>}
      {note && <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.55)', marginTop: 10 }}>{note}</div>}

      {composing && signedIn && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7, marginTop: 12 }}>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Title"
            maxLength={120}
            style={fieldStyle}
          />
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Say what you want to say — plain text only"
            rows={4}
            style={{ ...fieldStyle, resize: 'vertical' }}
          />
          <div>
            <button
              onClick={() => void submitTopic()}
              disabled={busy || !title.trim() || !body.trim()}
              style={primaryBtn(accent, busy || !title.trim() || !body.trim())}
            >{busy ? 'Posting…' : 'Post topic'}</button>
          </div>
        </div>
      )}

      {topics == null ? (
        <div style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.35)', marginTop: 16 }}>Loading…</div>
      ) : topics.length === 0 ? (
        <div style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.45)', marginTop: 16 }}>
          {search
            ? `No topics match “${search}”.`
            : signedIn ? 'Nothing here yet — start the first topic.' : 'Nothing here yet.'}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 16 }}>
          {topics.map((t) => (
            <button
              key={t.id}
              onClick={() => setOpen(t)}
              style={{
                textAlign: 'left', padding: '10px 12px', borderRadius: 9, cursor: 'pointer',
                background: 'rgba(255,255,255,0.025)',
                border: '1px solid rgba(255,255,255,0.07)',
              }}
            >
              <div style={{ fontSize: 12.5, fontWeight: 600, color: 'rgba(255,255,255,0.9)' }}>
                {t.title}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 5 }}>
                <Author {...t} fallbackAccent={accent} />
                <span style={{ fontSize: 9.5, fontFamily: MONO, color: 'rgba(255,255,255,0.3)' }}>
                  {t.replyCount} {t.replyCount === 1 ? 'reply' : 'replies'} · {when(t.lastAt)}
                </span>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const linkBtn: React.CSSProperties = {
  background: 'transparent', border: 'none', padding: 0, cursor: 'pointer',
  fontSize: 9.5, fontFamily: MONO, color: 'rgba(255,255,255,0.3)',
};

const primaryBtn = (accent: string, disabled: boolean): React.CSSProperties => ({
  padding: '4px 12px', fontSize: 11, fontWeight: 600, borderRadius: 6,
  background: `${accent}22`, color: accent, border: `1px solid ${accent}44`,
  cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.5 : 1,
});

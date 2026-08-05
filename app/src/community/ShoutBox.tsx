import { useEffect, useRef, useState } from 'react';
import { fetchShouts, postShout, type Shout } from '../state/community';
import { identiconDataUri } from '../state/identicon';
import { report, setBlock } from '../state/social';

const MONO = '"JetBrains Mono", ui-monospace, monospace';
const MAX = 240;
/** Poll interval. Slow on purpose — this is a side panel, not a chat client,
 *  and every mounted copy is load on a self-hosted box. */
const POLL_MS = 15_000;

/** A small rolling window of short public messages.
 *
 *  Polled rather than pushed: no websocket to keep alive, and a missed poll
 *  costs nothing because the server holds the window. Polling STOPS when the
 *  panel is closed (the component unmounts) and while the document is
 *  hidden, so a backgrounded app is not quietly hammering the box.
 *
 *  Plain text, like everywhere else. The cooldown is enforced server-side;
 *  the disabled button here is courtesy, not the rule. */
export function ShoutBox({ accent, signedIn }: { accent: string; signedIn: boolean }) {
  const [shouts, setShouts] = useState<Shout[] | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [cooldownLeft, setCooldownLeft] = useState(0);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const load = async () => {
    try {
      const { shouts: list } = await fetchShouts();
      setShouts(list);
    } catch {
      // A dead fetch leaves the last window on screen rather than blanking it.
      setShouts((prev) => prev ?? []);
    }
  };

  useEffect(() => {
    let cancelled = false;
    const tick = () => {
      if (cancelled || document.hidden) return;
      void load();
    };
    tick();
    const timer = setInterval(tick, POLL_MS);
    return () => { cancelled = true; clearInterval(timer); };
  }, []);

  // Newest at the bottom, so follow it — but only when new content arrives,
  // never on every render.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [shouts?.length]);

  useEffect(() => {
    if (cooldownLeft <= 0) return;
    const t = setTimeout(() => setCooldownLeft((n) => n - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldownLeft]);

  const send = async () => {
    if (busy || !draft.trim() || cooldownLeft > 0) return;
    setBusy(true); setError('');
    try {
      await postShout(draft);
      setDraft('');
      await load();
      setCooldownLeft(10);
    } catch (e) {
      // Includes the server's "wait N more seconds" — its words, not a
      // generic failure.
      setError(String(e));
    } finally { setBusy(false); }
  };

  const doReport = async (s: Shout) => {
    try {
      await report('comment', String(s.id), 'reported from the shoutbox');
      setNote('Reported — a moderator will look at it.');
    } catch (e) { setError(String(e)); }
  };

  const doBlock = async (s: Shout) => {
    if (!s.handle) return;
    try {
      await setBlock(s.handle, true);
      setNote(`Blocked @${s.handle}.`);
      await load();
    } catch (e) { setError(String(e)); }
  };

  const over = draft.length > MAX;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <div style={{
        padding: '10px 14px', borderBottom: '1px solid rgba(255,255,255,0.06)',
        fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase',
        fontFamily: MONO, color: 'rgba(255,255,255,0.4)',
      }}>Shoutbox</div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '10px 14px', minHeight: 0 }}>
        {shouts == null ? (
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)' }}>Loading…</div>
        ) : shouts.length === 0 ? (
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)' }}>
            Nothing shouted yet.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
            {shouts.map((s) => {
              const tint = s.accent ?? accent;
              return (
                <div key={s.id} style={{ display: 'flex', gap: 7, alignItems: 'flex-start' }}>
                  <img
                    src={identiconDataUri(s.avatarSeed || s.handle || '?', 18)}
                    alt="" width={18} height={18}
                    style={{ borderRadius: 4, marginTop: 1, flexShrink: 0, border: `1px solid ${tint}44` }}
                  />
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                      <span style={{ fontSize: 10, fontFamily: MONO, color: tint }}>
                        {s.handle ? `@${s.handle}` : s.displayName ?? 'someone'}
                      </span>
                      <div style={{ flex: 1 }} />
                      {signedIn && (
                        <>
                          <button onClick={() => void doReport(s)} style={linkBtn}>report</button>
                          {s.handle && <button onClick={() => void doBlock(s)} style={linkBtn}>block</button>}
                        </>
                      )}
                    </div>
                    {/* Text. Never interpreted. */}
                    <div style={{
                      fontSize: 11, color: 'rgba(255,255,255,0.72)', lineHeight: 1.4,
                      whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                    }}>{s.body}</div>
                  </div>
                </div>
              );
            })}
            <div ref={bottomRef} />
          </div>
        )}
      </div>

      {error && <div style={{ fontSize: 10.5, color: '#fb7185', padding: '0 14px 6px' }}>{error}</div>}
      {note && <div style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.5)', padding: '0 14px 6px' }}>{note}</div>}

      <div style={{ padding: '10px 14px', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
        {signedIn ? (
          <div style={{ display: 'flex', gap: 7, alignItems: 'center' }}>
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void send(); }}
              placeholder={cooldownLeft > 0 ? `Wait ${cooldownLeft}s…` : 'Say something short'}
              maxLength={MAX + 40}
              style={{
                flex: 1, minWidth: 0, padding: '6px 9px', fontSize: 11, borderRadius: 6,
                background: 'rgba(255,255,255,0.05)', color: '#fff', outline: 'none',
                border: `1px solid ${over ? '#fb718544' : 'rgba(255,255,255,0.1)'}`,
              }}
            />
            <button
              onClick={() => void send()}
              disabled={busy || !draft.trim() || over || cooldownLeft > 0}
              style={{
                padding: '5px 11px', fontSize: 10.5, fontWeight: 700, borderRadius: 6,
                background: `${accent}22`, color: accent, border: `1px solid ${accent}44`,
                cursor: busy || !draft.trim() || over || cooldownLeft > 0 ? 'not-allowed' : 'pointer',
                opacity: busy || !draft.trim() || over || cooldownLeft > 0 ? 0.5 : 1,
                whiteSpace: 'nowrap',
              }}
            >Shout</button>
          </div>
        ) : (
          <div style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.4)' }}>
            Sign in to shout.
          </div>
        )}
      </div>
    </div>
  );
}

const linkBtn: React.CSSProperties = {
  background: 'transparent', border: 'none', padding: 0, cursor: 'pointer',
  fontSize: 9, fontFamily: MONO, color: 'rgba(255,255,255,0.28)',
};

import { useEffect, useState } from 'react';
import { fetchNotifications, markRead, type Notification } from '../state/social';
import { avatarSrc } from '../state/avatarUrl';

const MONO = '"JetBrains Mono", ui-monospace, monospace';

/** How each kind reads. Written as sentences rather than assembled from
 *  fragments, because "reply on topic" is not English and the inbox is the
 *  one surface where a stranger meets the app's voice. */
function describe(n: Notification): string {
  const who = n.actor ? `@${n.actor}` : 'Someone';
  switch (n.kind) {
    case 'follow': return `${who} followed you`;
    case 'comment': return `${who} commented on your work`;
    case 'reply': return `${who} replied to your topic`;
    case 'mention': return `${who} mentioned you`;
    case 'moderation': return 'A moderator acted on your account';
    default: return `${who} did something`;
  }
}

const GLYPHS: Record<string, string> = {
  follow: '✦', comment: '❝', reply: '↩', mention: '@', moderation: '⚑',
};

/** Your inbox.
 *
 *  Opening it does NOT mark everything read — that would erase the thing you
 *  came to look at before you had a chance to read it. Each entry clears when
 *  you click it, and there is an explicit "mark all read" for the rest. */
export function NotificationsPanel({ accent, onClose, onOpenCreator }: {
  accent: string;
  onClose: () => void;
  onOpenCreator: (handle: string) => void;
}) {
  const [items, setItems] = useState<Notification[] | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try {
      const { notifications } = await fetchNotifications();
      setItems(notifications);
    } catch {
      setItems([]);
    }
  };

  useEffect(() => { void load(); }, []);

  const openOne = async (n: Notification) => {
    if (!n.readAt) {
      // Optimistic: the row un-highlights immediately, and a failed write
      // just means it is still unread next time — harmless either way.
      setItems((list) => (list ?? []).map((x) => (x.id === n.id ? { ...x, readAt: Date.now() / 1000 } : x)));
      void markRead(n.id).catch(() => {});
    }
    if (n.actor) onOpenCreator(n.actor);
  };

  const clearAll = async () => {
    setBusy(true);
    try {
      await markRead();
      await load();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 64,
        display: 'flex', alignItems: 'flex-start', justifyContent: 'flex-end',
        background: 'rgba(0,0,0,0.35)', paddingTop: 46, paddingRight: 14,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(380px, 92vw)', maxHeight: '76vh',
          display: 'flex', flexDirection: 'column', borderRadius: 12,
          background: 'rgba(16,17,22,0.98)', border: '1px solid rgba(255,255,255,0.1)',
          backdropFilter: 'blur(18px)', overflow: 'hidden',
        }}
      >
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '10px 14px', borderBottom: '1px solid rgba(255,255,255,0.06)',
        }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: '#fff' }}>Notifications</span>
          <div style={{ flex: 1 }} />
          {items && items.some((n) => !n.readAt) && (
            <button
              onClick={() => void clearAll()}
              disabled={busy}
              style={{
                background: 'transparent', border: 'none', padding: 0, cursor: 'pointer',
                fontSize: 10, fontFamily: MONO, color: 'rgba(255,255,255,0.45)',
              }}
            >mark all read</button>
          )}
          <button
            onClick={onClose}
            aria-label="Close notifications"
            style={{
              background: 'transparent', border: 'none', cursor: 'pointer',
              color: 'rgba(255,255,255,0.5)', fontSize: 16, lineHeight: 1, padding: '0 2px',
            }}
          >×</button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
          {items == null ? (
            <div style={{ padding: 14, fontSize: 11, color: 'rgba(255,255,255,0.35)' }}>Loading…</div>
          ) : items.length === 0 ? (
            <div style={{ padding: 14, fontSize: 11.5, color: 'rgba(255,255,255,0.45)', lineHeight: 1.5 }}>
              Nothing yet. You will hear when somebody follows you, replies to
              you, or comments on your work.
            </div>
          ) : (
            items.map((n) => (
              <button
                key={n.id}
                onClick={() => void openOne(n)}
                style={{
                  display: 'flex', gap: 9, alignItems: 'flex-start', width: '100%',
                  textAlign: 'left', padding: '9px 13px', cursor: 'pointer',
                  background: n.readAt ? 'transparent' : `${accent}0e`,
                  border: 'none', borderBottom: '1px solid rgba(255,255,255,0.04)',
                }}
              >
                {n.actor ? (
                  <img
                    src={avatarSrc({ handle: n.actor, size: 24 })}
                    alt="" width={24} height={24}
                    style={{ borderRadius: 6, objectFit: 'cover', flexShrink: 0, marginTop: 1 }}
                  />
                ) : (
                  <span style={{ width: 24, textAlign: 'center', fontSize: 13, color: accent }}>
                    {GLYPHS[n.kind] ?? '•'}
                  </span>
                )}
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.85)' }}>
                    {describe(n)}
                  </div>
                  {n.body && (
                    // The excerpt is plain text, like everything else people
                    // write here.
                    <div style={{
                      fontSize: 10.5, color: 'rgba(255,255,255,0.5)', marginTop: 2,
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>{n.body}</div>
                  )}
                  <div style={{ fontSize: 9, fontFamily: MONO, color: 'rgba(255,255,255,0.28)', marginTop: 3 }}>
                    {new Date(n.createdAt * 1000).toLocaleString()}
                  </div>
                </div>
                {!n.readAt && (
                  <span style={{
                    width: 6, height: 6, borderRadius: 999, background: accent,
                    flexShrink: 0, marginTop: 6,
                  }} />
                )}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

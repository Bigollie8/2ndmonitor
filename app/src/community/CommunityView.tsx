import { useState } from 'react';
import { useMarketplaceAuth } from '../state/marketplaceAuth';
import { CreatorsDirectory } from './CreatorsDirectory';
import { ForumView } from './ForumView';
import { ShoutBox } from './ShoutBox';

type Tab = 'creators' | 'forum';

/** The community home: people and conversation, side by side.
 *
 *  The shoutbox is a permanent right-hand rail rather than a tab, because it
 *  is ambient — you glance at it while doing something else. It only polls
 *  while this view is mounted, so closing the window ends the traffic. */
export function CommunityView({ accent, onClose, onOpenCreator }: {
  accent: string;
  onClose: () => void;
  /** Opens the Market on that creator's page (App closes this first). */
  onOpenCreator: (handle: string) => void;
}) {
  const [tab, setTab] = useState<Tab>('creators');
  // An independent mount, the established pattern: the hook holds no shared
  // state to desync and each mount re-asks marketplace_session_status.
  const { state } = useMarketplaceAuth();
  const signedIn = state.status === 'signed-in';

  const tabButton = (t: Tab, label: string) => (
    <button
      key={t}
      onClick={() => setTab(t)}
      style={{
        padding: '4px 11px', borderRadius: 999, fontSize: 11, fontWeight: 600,
        background: tab === t ? `${accent}1f` : 'rgba(255,255,255,0.04)',
        color: tab === t ? accent : 'rgba(255,255,255,0.6)',
        border: tab === t ? `1px solid ${accent}44` : '1px solid rgba(255,255,255,0.08)',
        cursor: 'pointer',
      }}
    >{label}</button>
  );

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 58,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(0,0,0,0.5)',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(1040px, 94vw)', height: 'min(700px, 88vh)',
          display: 'flex', flexDirection: 'column', borderRadius: 14,
          background: 'rgba(16,17,22,0.97)', border: '1px solid rgba(255,255,255,0.1)',
          backdropFilter: 'blur(18px)', overflow: 'hidden',
        }}
      >
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '12px 18px', borderBottom: '1px solid rgba(255,255,255,0.06)',
        }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: '#fff' }}>Community</span>
          <div style={{ width: 8 }} />
          {tabButton('creators', 'Creators')}
          {tabButton('forum', 'Forum')}
          <div style={{ flex: 1 }} />
          <button
            onClick={onClose}
            aria-label="Close community"
            style={{
              background: 'transparent', border: 'none', cursor: 'pointer',
              color: 'rgba(255,255,255,0.5)', fontSize: 18, lineHeight: 1, padding: '0 4px',
            }}
          >×</button>
        </div>

        <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
            {tab === 'creators'
              ? <CreatorsDirectory accent={accent} onOpenCreator={onOpenCreator} />
              : <ForumView accent={accent} signedIn={signedIn} />}
          </div>

          <div style={{
            width: 268, flexShrink: 0, minHeight: 0,
            borderLeft: '1px solid rgba(255,255,255,0.06)',
          }}>
            <ShoutBox accent={accent} signedIn={signedIn} />
          </div>
        </div>
      </div>
    </div>
  );
}

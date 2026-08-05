import { useMarketplaceAuth } from '../state/marketplaceAuth';
import { AccountSignIn } from './AccountSignIn';
import { AccountPanel } from './AccountPanel';

const MONO = '"JetBrains Mono", ui-monospace, monospace';

/** The profile popout: who you are on the marketplace, in one place.
 *
 *  This system — sign in, create an account, claim a handle, edit your
 *  creator profile — was built inside Settings, which made becoming a
 *  creator feel like configuring a preference. It is its own surface now;
 *  Settings keeps only the server/signing-key plumbing and a pointer here.
 *
 *  Same modal shell as LibraryView: centered card, backdrop click to close,
 *  Esc handled by App's cascade (no capture handler of its own, so it cannot
 *  fight the Market's). */
export function ProfileView({ accent, onClose }: {
  accent: string;
  onClose: () => void;
}) {
  // An independent mount, the established pattern: the hook holds no shared
  // state to desync, each mount re-asks marketplace_session_status itself.
  const { state } = useMarketplaceAuth();
  const signedIn = state.status === 'signed-in';

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 60,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(0,0,0,0.5)',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(520px, 92vw)', maxHeight: '86vh',
          display: 'flex', flexDirection: 'column', borderRadius: 14,
          background: 'rgba(16,17,22,0.97)', border: '1px solid rgba(255,255,255,0.1)',
          backdropFilter: 'blur(18px)', overflow: 'hidden',
        }}
      >
        <div style={{
          display: 'flex', alignItems: 'center', gap: 12,
          padding: '12px 18px', borderBottom: '1px solid rgba(255,255,255,0.06)',
        }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: '#fff' }}>Profile</span>
          <div style={{ flex: 1 }} />
          <button
            onClick={onClose}
            aria-label="Close profile"
            style={{
              background: 'transparent', border: 'none', cursor: 'pointer',
              color: 'rgba(255,255,255,0.5)', fontSize: 18, lineHeight: 1, padding: '0 4px',
            }}
          >×</button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: 18, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <AccountSignIn accent={accent} />

          {signedIn && (
            <>
              <div style={{ height: 1, background: 'rgba(255,255,255,0.06)' }} />
              <AccountPanel accent={accent} signedIn={signedIn} />
              {/* Said here because "upload a picture" is the thing everyone
                  reaches for: the avatar is GENERATED from the handle, on
                  purpose. Every creator gets a distinct mark with zero image
                  moderation, and it can never be a slur, a logo, or a
                  photograph of someone. */}
              <div style={{ fontSize: 10, fontFamily: MONO, color: 'rgba(255,255,255,0.35)', lineHeight: 1.5 }}>
                Your avatar is generated from your handle — there is nothing to upload.
                It is the same everywhere your handle appears.
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

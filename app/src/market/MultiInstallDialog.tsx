import type { InstallPlan } from '../state/installPlan';

const MONO = '"JetBrains Mono", ui-monospace, monospace';

const Head = ({ children }: { children: React.ReactNode }) => (
  <div style={{
    fontSize: 9, fontFamily: MONO, fontWeight: 700, letterSpacing: '0.12em',
    color: 'rgba(255,255,255,0.28)', textTransform: 'uppercase', margin: '14px 0 6px',
  }}>{children}</div>
);

/** Consent for installing a whole collection at once.
 *
 *  Renders `planMultiInstall`'s result in full — what will install, what is
 *  skipped and why, and every capability with the bundles that want it. The
 *  per-bundle dialog already establishes that you see capabilities before
 *  granting them; a bulk button that hid them would quietly discard that. */
export function MultiInstallDialog({ plan, accent, busy, progress, onCancel, onConfirm }: {
  plan: InstallPlan;
  accent: string;
  busy: boolean;
  /** `"3 of 5"` while running, empty otherwise. */
  progress: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 70,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'rgba(0,0,0,0.55)',
    }}>
      <div style={{
        width: 'min(460px, 92vw)', maxHeight: '82vh', overflowY: 'auto', padding: 18,
        borderRadius: 12, background: 'rgba(18,20,26,0.98)',
        border: '1px solid rgba(255,255,255,0.1)',
      }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: 'rgba(255,255,255,0.92)' }}>
          Install {plan.toInstall.length} item{plan.toInstall.length === 1 ? '' : 's'}?
        </div>

        {plan.toInstall.length > 0 && (
          <>
            <Head>Will be installed</Head>
            <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
              {plan.toInstall.map((e) => (
                <li key={e.item.key} style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.75)' }}>
                  · {e.item.name}
                </li>
              ))}
            </ul>
          </>
        )}

        {plan.grants.length > 0 && (
          <>
            <Head>It will be able to</Head>
            <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 5 }}>
              {plan.grants.map((g) => (
                <li key={g.permission} style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.75)' }}>
                  · {g.description}
                  <span style={{ color: 'rgba(255,255,255,0.4)', fontFamily: MONO, fontSize: 10 }}>
                    {' '}— for {g.wantedBy.join(', ')}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}

        {/* Stated, not hidden: a count that does not add up reads as a bug. */}
        {plan.alreadyInstalled.length > 0 && (
          <>
            <Head>Already installed, skipped</Head>
            <div style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.5)' }}>
              {plan.alreadyInstalled.map((i) => i.name).join(', ')}
            </div>
          </>
        )}

        {plan.blocked.length > 0 && (
          <>
            <Head>Cannot be installed</Head>
            <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 4 }}>
              {plan.blocked.map((b) => (
                <li key={b.item.key} style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.5)' }}>
                  · {b.item.name} — {b.reason}
                </li>
              ))}
            </ul>
          </>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 18 }}>
          {busy && progress && (
            <span style={{ fontSize: 10.5, fontFamily: MONO, color: 'rgba(255,255,255,0.5)' }}>
              {progress}
            </span>
          )}
          <div style={{ flex: 1 }} />
          <button
            onClick={onCancel}
            disabled={busy}
            style={{
              padding: '5px 12px', fontSize: 11, fontWeight: 600, borderRadius: 6,
              background: 'transparent', color: 'rgba(255,255,255,0.65)',
              border: '1px solid rgba(255,255,255,0.12)',
              cursor: busy ? 'not-allowed' : 'pointer', opacity: busy ? 0.5 : 1,
            }}
          >Cancel</button>
          <button
            onClick={onConfirm}
            disabled={busy || plan.toInstall.length === 0}
            style={{
              padding: '5px 12px', fontSize: 11, fontWeight: 600, borderRadius: 6,
              background: `${accent}22`, color: accent, border: `1px solid ${accent}44`,
              cursor: busy || plan.toInstall.length === 0 ? 'not-allowed' : 'pointer',
              opacity: busy || plan.toInstall.length === 0 ? 0.5 : 1,
            }}
          >{busy ? 'Installing…' : `Install ${plan.toInstall.length}`}</button>
        </div>
      </div>
    </div>
  );
}

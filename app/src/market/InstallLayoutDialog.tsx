import type { CatalogItem } from '../state/catalog';
import type { PublishedLayout } from '../state/layoutPublish';
import type { LayoutResolution } from '../state/layoutInstall';
import { planMultiInstall } from '../state/installPlan';
import { wireframeDataUri } from '../state/layoutWireframe';

const MONO = '"JetBrains Mono", ui-monospace, monospace';

const Head = ({ children }: { children: React.ReactNode }) => (
  <div style={{
    fontSize: 9, fontFamily: MONO, fontWeight: 700, letterSpacing: '0.12em',
    color: 'rgba(255,255,255,0.28)', textTransform: 'uppercase', margin: '14px 0 6px',
  }}>{children}</div>
);

/** Consent for installing a layout and whatever tiles it needs.
 *
 *  The capability list comes from `planMultiInstall` — the same function the
 *  collection "Install all" uses — so a layout cannot become a way to acquire
 *  permissions with less scrutiny than installing the same bundles directly.
 *
 *  It says plainly that a new layout is added rather than an existing one
 *  replaced, because "Install" on something called a layout is exactly where
 *  a person would fear losing their dashboard. */
export function InstallLayoutDialog({
  layoutName, layout, resolution, appVersion, accent, busy, progress, existingNames, onCancel, onConfirm,
}: {
  layoutName: string;
  layout: PublishedLayout;
  resolution: LayoutResolution;
  appVersion: string;
  accent: string;
  busy: boolean;
  progress: string;
  /** Only used to show what the new layout will be called. */
  existingNames: string[];
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const plan = planMultiInstall(resolution.installable as CatalogItem[], appVersion);
  const tileCount = layout.landscape.length + layout.portrait.length;

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 70,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'rgba(0,0,0,0.55)',
    }}>
      <div style={{
        width: 'min(500px, 94vw)', maxHeight: '84vh', overflowY: 'auto', padding: 18,
        borderRadius: 12, background: 'rgba(18,20,26,0.98)',
        border: '1px solid rgba(255,255,255,0.1)',
      }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: 'rgba(255,255,255,0.92)' }}>
          Install “{layoutName}”?
        </div>

        <img
          src={wireframeDataUri(layout)}
          alt=""
          style={{ width: '100%', marginTop: 12, borderRadius: 8, border: '1px solid rgba(255,255,255,0.09)' }}
        />

        {/* The single most reassuring sentence in the dialog. */}
        <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.6)', marginTop: 10, lineHeight: 1.5 }}>
          This adds a <strong>new layout</strong> with {tileCount} tile{tileCount === 1 ? '' : 's'}.
          Your existing layouts are not touched. Tiles arrive unconfigured — you set your own
          location, accounts and preferences.
        </div>

        {plan.toInstall.length > 0 && (
          <>
            <Head>Also installs</Head>
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
            <Head>Those will be able to</Head>
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

        {resolution.alreadyInstalled.length > 0 && (
          <>
            <Head>Already installed</Head>
            <div style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.5)' }}>
              {resolution.alreadyInstalled.map((i) => i.name).join(', ')}
            </div>
          </>
        )}

        {/* Said before the button, not discovered after: these tiles land as
            placeholders so the arrangement survives, and the user can see
            exactly which ones. */}
        {resolution.unavailable.length > 0 && (
          <>
            <Head>Not in the marketplace</Head>
            <div style={{ fontSize: 11.5, color: '#fbbf24' }}>
              {resolution.unavailable.join(', ')}
            </div>
            <div style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.4)', marginTop: 3 }}>
              These keep their place in the layout and show as missing, so the arrangement stays
              intact and you can fill the gaps later.
            </div>
          </>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 18 }}>
          {busy && progress && (
            <span style={{ fontSize: 10.5, fontFamily: MONO, color: 'rgba(255,255,255,0.5)' }}>{progress}</span>
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
            disabled={busy}
            style={{
              padding: '5px 12px', fontSize: 11, fontWeight: 600, borderRadius: 6,
              background: `${accent}22`, color: accent, border: `1px solid ${accent}44`,
              cursor: busy ? 'not-allowed' : 'pointer', opacity: busy ? 0.5 : 1,
            }}
          >{busy ? 'Installing…' : `Add layout${plan.toInstall.length ? ` + ${plan.toInstall.length}` : ''}`}</button>
        </div>

        <div style={{ fontSize: 10, fontFamily: MONO, color: 'rgba(255,255,255,0.3)', marginTop: 8 }}>
          saves as “{existingNames.includes(layoutName) ? `${layoutName} 2` : layoutName}”
        </div>
      </div>
    </div>
  );
}

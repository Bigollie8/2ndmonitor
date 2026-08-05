import { useMemo, useState } from 'react';
import type { TileInstance } from '../state/layout';
import { toPublishedLayout, layoutDependencies, type PublishSource } from '../state/layoutPublish';
import { wireframePngBase64 } from '../state/layoutPreviewPng';
import { wireframeDataUri } from '../state/layoutWireframe';
import { cfgUrl } from '../state/marketplaceConfig';

const MONO = '"JetBrains Mono", ui-monospace, monospace';

const CATEGORIES = ['work', 'home', 'media', 'monitoring', 'ambient', 'minimal'] as const;

/** Publish one of your layouts to the marketplace.
 *
 *  The preview shown here is the exact wireframe that gets published, and the
 *  dependency list is the exact set of bundles an installer will be asked to
 *  install. Both are computed from the same pure functions the publish call
 *  uses, so what you see is what ships. */
export function PublishLayout({
  accent, signedIn, layoutName, source, onClose, onPublished,
}: {
  accent: string;
  signedIn: boolean;
  /** The layout's local name, used as the default title. */
  layoutName: string;
  source: PublishSource;
  onClose: () => void;
  onPublished: (id: string) => void;
}) {
  const published = useMemo(() => toPublishedLayout(source), [source]);
  const deps = useMemo(() => layoutDependencies(published), [published]);

  const [id, setId] = useState(
    layoutName.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48)
      || 'my-layout',
  );
  const [name, setName] = useState(layoutName || 'My layout');
  const [summary, setSummary] = useState('');
  const [category, setCategory] = useState<string>('work');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const tileCount = published.landscape.length + published.portrait.length;

  const publish = async () => {
    setBusy(true);
    setError('');
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      // A generated wireframe, rasterised to PNG because the catalog sniffs
      // preview bytes and refuses SVG. Null publishes fine -- the layout just
      // renders with the same letter-block fallback every other previewless
      // bundle uses, which beats failing a publish over a thumbnail.
      const preview = await wireframePngBase64(published);
      await invoke('marketplace_publish_layout', {
        url: cfgUrl(),
        manifest: JSON.stringify({
          id, name, version: '1.0.0', api: 1, permissions: [],
          category, ...(summary.trim() ? { summary: summary.trim() } : {}),
        }),
        layout: JSON.stringify(published),
        preview,
      });
      onPublished(id);
    } catch (e) {
      // A publish failure must be visible: the user filled in a form and
      // pressed a button, unlike the read paths that fail silently.
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const field = {
    padding: '5px 9px', fontSize: 11.5, borderRadius: 6, width: '100%',
    background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.9)',
    border: '1px solid rgba(255,255,255,0.1)', outline: 'none', fontFamily: 'inherit',
  } as const;

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 70,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'rgba(0,0,0,0.55)',
    }}>
      <div style={{
        width: 'min(520px, 94vw)', maxHeight: '86vh', overflowY: 'auto', padding: 18,
        borderRadius: 12, background: 'rgba(18,20,26,0.98)',
        border: '1px solid rgba(255,255,255,0.1)',
      }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: 'rgba(255,255,255,0.92)' }}>
          Publish “{layoutName}”
        </div>

        {/* The preview IS the published artefact -- a wireframe drawn from
            the layout's own rects. Nothing is screenshotted, because a
            screenshot of your dashboard would show everything the config
            stripping just removed. */}
        <img
          src={wireframeDataUri(published)}
          alt=""
          style={{
            width: '100%', marginTop: 12, borderRadius: 8,
            border: '1px solid rgba(255,255,255,0.09)',
          }}
        />

        <div style={{
          fontSize: 10.5, color: 'rgba(255,255,255,0.5)', marginTop: 10, lineHeight: 1.5,
        }}>
          This publishes the <strong>arrangement only</strong> — {tileCount} tile
          {tileCount === 1 ? '' : 's'} and your theme. Tile settings are never
          included, so your location, usernames and any other configuration stay
          on this machine. Whoever installs it fills in their own.
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 14 }}>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Title" style={field} />
          <input
            value={id}
            onChange={(e) => setId(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
            placeholder="unique-id"
            style={{ ...field, fontFamily: MONO, fontSize: 11 }}
          />
          <input
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            placeholder="One line about what it is for"
            maxLength={100}
            style={field}
          />
          <select value={category} onChange={(e) => setCategory(e.target.value)} style={{ ...field, cursor: 'pointer' }}>
            {CATEGORIES.map((c) => (
              <option key={c} value={c} style={{ background: '#15161a' }}>{c}</option>
            ))}
          </select>
        </div>

        {deps.length > 0 && (
          <div style={{ marginTop: 12 }}>
            <div style={{
              fontSize: 9, fontFamily: MONO, fontWeight: 700, letterSpacing: '0.12em',
              color: 'rgba(255,255,255,0.28)', textTransform: 'uppercase', marginBottom: 5,
            }}>Needs these bundles</div>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.6)' }}>
              {deps.join(', ')}
            </div>
            <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)', marginTop: 3 }}>
              Anyone installing this layout is asked to install these too, and told what each one can do.
            </div>
          </div>
        )}

        {!signedIn && (
          <div style={{ fontSize: 11, color: '#fbbf24', marginTop: 12 }}>
            Sign in and claim a handle under Settings → Marketplace before publishing.
          </div>
        )}
        {error && (
          <div style={{ fontSize: 11, color: '#ff9b9b', marginTop: 12 }}>{error}</div>
        )}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 18 }}>
          <button
            onClick={onClose}
            style={{
              padding: '5px 12px', fontSize: 11, fontWeight: 600, borderRadius: 6,
              background: 'transparent', color: 'rgba(255,255,255,0.65)',
              border: '1px solid rgba(255,255,255,0.12)', cursor: 'pointer',
            }}
          >Cancel</button>
          <button
            onClick={() => void publish()}
            disabled={busy || !signedIn || !id || !name.trim()}
            style={{
              padding: '5px 12px', fontSize: 11, fontWeight: 600, borderRadius: 6,
              background: `${accent}22`, color: accent, border: `1px solid ${accent}44`,
              cursor: busy || !signedIn ? 'not-allowed' : 'pointer',
              opacity: busy || !signedIn || !id || !name.trim() ? 0.5 : 1,
            }}
          >{busy ? 'Publishing…' : 'Publish'}</button>
        </div>
      </div>
    </div>
  );
}

import { useCallback, useEffect, useState } from 'react';
import { validateManifest, parsePermission } from '../sandbox/manifest';

const MONO = '"JetBrains Mono", ui-monospace, monospace';
const LS_URL = 'marketplace.url';
const LS_PUBKEY = 'marketplace.pubkey';

// Official hub marketplace, pre-configured so the tab works with no setup.
// The pinned key is the server's ed25519 index-signing public key; if it ever
// rotates, bundles fail signature verification until this (or the user's
// override in localStorage) is updated.
const DEFAULT_URL = 'https://market.basedsecurity.net';
const DEFAULT_PUBKEY = '35a3b117c5e6ed793b5b78640db3075c48feb0d943541d86f3b462c9bed8d816';

/** Effective server config: user override if they pointed at their own server,
 *  otherwise the built-in default. */
const cfgUrl = () => localStorage.getItem(LS_URL) || DEFAULT_URL;
const cfgPubkey = () => localStorage.getItem(LS_PUBKEY) || DEFAULT_PUBKEY;
const isDefaultServer = () => cfgUrl() === DEFAULT_URL && cfgPubkey() === DEFAULT_PUBKEY;

interface IndexBundle {
  id: string;
  version: string;
  kind: 'preset' | 'visualizer' | 'tile';
  name: string;
  author: string;
  permissions: string[];
  sha256: string;
  size: number;
  downloads: number;
}

/** Human phrasing for a permission string, shown in the install dialog. */
function describePermission(p: string): string {
  const parsed = parsePermission(p);
  if (!parsed.ok) return p;
  if (parsed.perm.kind === 'net') return `Access the internet at ${parsed.perm.host}`;
  return `Run the app command "${parsed.perm.command}"`;
}

/** Marketplace browser. Points at the official server by default; a user
 *  override (own server URL + pinned pubkey) lives in localStorage. All traffic
 *  goes through the Rust client (signature + hash verified there). Installed
 *  visualizers/tiles land in the same folder the Scripted style reads, so the
 *  fs-watcher hot-reloads them. */
export function MarketplaceTab({ accent, onClose }: { accent: string; onClose: () => void }) {
  const [url, setUrl] = useState(cfgUrl);
  const [pubkey, setPubkey] = useState(cfgPubkey);
  const [editing, setEditing] = useState(false);

  const [bundles, setBundles] = useState<IndexBundle[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [installed, setInstalled] = useState<Set<string>>(new Set());
  const [confirming, setConfirming] = useState<IndexBundle | null>(null);
  const [toast, setToast] = useState('');

  const refreshInstalled = useCallback(async () => {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const list = await invoke<{ id: string }[]>('visualizers_list');
      setInstalled(new Set(list.map((f) => f.id)));
    } catch { /* leave as-is */ }
  }, []);

  const loadIndex = useCallback(async () => {
    setError(''); setBusy(true); setBundles(null);
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const idx = await invoke<{ bundles: IndexBundle[] }>('marketplace_fetch_index', {
        url: cfgUrl(),
        pubkey: cfgPubkey(),
      });
      setBundles(idx.bundles ?? []);
      await refreshInstalled();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }, [refreshInstalled]);

  useEffect(() => {
    void loadIndex();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const saveConfig = () => {
    // The Rust client refuses anything but https, so reject it here too.
    if (!url.trim().startsWith('https://')) {
      setError('Server URL must start with https://');
      return;
    }
    if (!/^[0-9a-f]{64}$/i.test(pubkey.trim())) {
      setError('Signing public key must be 64 hex characters');
      return;
    }
    localStorage.setItem(LS_URL, url.trim());
    localStorage.setItem(LS_PUBKEY, pubkey.trim());
    setEditing(false);
    void loadIndex();
  };

  const resetConfig = () => {
    localStorage.removeItem(LS_URL);
    localStorage.removeItem(LS_PUBKEY);
    setUrl(DEFAULT_URL);
    setPubkey(DEFAULT_PUBKEY);
    setError('');
    setEditing(false);
    void loadIndex();
  };

  const doInstall = useCallback(async (b: IndexBundle) => {
    setConfirming(null); setBusy(true);
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('marketplace_install', {
        url: cfgUrl(),
        id: b.id, version: b.version, sha256: b.sha256, kind: b.kind,
      });
      setToast(`Installed ${b.name}`);
      await refreshInstalled();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
      setTimeout(() => setToast(''), 3000);
    }
  }, [refreshInstalled]);

  const startInstall = (b: IndexBundle) => {
    // Presets are pure data — no permissions to confirm. Code bundles with
    // permissions get the confirm dialog; validate the manifest's permission
    // grammar defensively even though the server already did.
    if (b.kind !== 'preset' && b.permissions.length > 0) {
      setConfirming(b);
    } else {
      void doInstall(b);
    }
  };

  const doUninstall = useCallback(async (b: IndexBundle) => {
    setBusy(true);
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('marketplace_uninstall', { id: b.id, kind: b.kind });
      setToast(`Removed ${b.name}`);
      await refreshInstalled();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
      setTimeout(() => setToast(''), 3000);
    }
  }, [refreshInstalled]);

  const chip = (text: string) => (
    <span key={text} style={{
      fontSize: 9.5, fontFamily: MONO, padding: '1px 6px', borderRadius: 4,
      background: 'rgba(124,140,220,0.12)', border: '1px solid rgba(124,140,220,0.3)',
      color: 'rgba(200,210,255,0.9)',
    }}>{text}</span>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      {editing ? (
        <div style={{ padding: 24, maxWidth: 520, margin: '0 auto' }}>
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>Marketplace server</div>
          <div style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.55)', lineHeight: 1.6, marginBottom: 14 }}>
            The app ships pointed at the official marketplace. To use your own server, enter its URL
            and the signing public key it prints on startup. The app verifies the index signature and
            every bundle's checksum before installing.
          </div>
          <label style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.45)' }}>Server URL</label>
          <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://market.example.com"
            style={inputStyle} spellCheck={false} />
          <label style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.45)', marginTop: 10, display: 'block' }}>Signing public key (hex)</label>
          <input value={pubkey} onChange={(e) => setPubkey(e.target.value)} placeholder="64 hex chars"
            style={{ ...inputStyle, fontFamily: MONO }} spellCheck={false} />
          {error && <div style={{ color: '#ff9b9b', fontSize: 11, marginTop: 8 }}>{error}</div>}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 14 }}>
            <button onClick={saveConfig} style={btnStyle(accent)}>Connect</button>
            <button onClick={() => { setUrl(cfgUrl()); setPubkey(cfgPubkey()); setError(''); setEditing(false); }} style={miniBtn}>Cancel</button>
            <div style={{ flex: 1 }} />
            {!isDefaultServer() && <button onClick={resetConfig} style={miniBtn}>Use official server</button>}
          </div>
        </div>
      ) : (
        <>
          <div style={{
            padding: '8px 18px', display: 'flex', alignItems: 'center', gap: 10,
            borderBottom: '1px solid rgba(255,255,255,0.05)',
          }}>
            <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', fontFamily: MONO }}>
              {cfgUrl()}
            </span>
            <button onClick={loadIndex} disabled={busy} style={miniBtn}>↻ Refresh</button>
            <button onClick={() => { setUrl(cfgUrl()); setPubkey(cfgPubkey()); setError(''); setEditing(true); }} style={miniBtn}>Change server</button>
            <div style={{ flex: 1 }} />
            {toast && <span style={{ fontSize: 11, color: accent }}>{toast}</span>}
          </div>

          {error && <div style={{ padding: '10px 18px', color: '#ff9b9b', fontSize: 11.5 }}>{error}</div>}
          {busy && !bundles && <div style={{ padding: 24, textAlign: 'center', color: 'rgba(255,255,255,0.4)', fontSize: 12 }}>Loading…</div>}

          <div style={{ padding: '12px 18px', overflow: 'auto', display: 'grid', gap: 10, gridTemplateColumns: 'repeat(2, 1fr)', alignContent: 'start' }}>
            {bundles?.length === 0 && (
              <div style={{ gridColumn: '1 / -1', textAlign: 'center', color: 'rgba(255,255,255,0.4)', fontSize: 12, padding: 20 }}>
                Nothing published yet.
              </div>
            )}
            {bundles?.map((b) => {
              const isInstalled = b.kind !== 'preset' && installed.has(b.id);
              return (
                <div key={`${b.id}@${b.version}`} style={{
                  padding: 12, borderRadius: 10, background: 'rgba(255,255,255,0.03)',
                  border: '1px solid rgba(255,255,255,0.07)', display: 'flex', flexDirection: 'column', gap: 8,
                }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                    <span style={{ fontSize: 13, fontWeight: 600 }}>{b.name}</span>
                    <span style={{ fontSize: 9.5, fontFamily: MONO, color: 'rgba(255,255,255,0.4)' }}>
                      {b.kind} · v{b.version} · {b.author}
                    </span>
                    <div style={{ flex: 1 }} />
                    <span style={{ fontSize: 9.5, fontFamily: MONO, color: 'rgba(255,255,255,0.35)' }}>↓{b.downloads}</span>
                  </div>
                  {b.permissions.length > 0 && (
                    <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>{b.permissions.map(chip)}</div>
                  )}
                  <div style={{ display: 'flex', gap: 6 }}>
                    {isInstalled ? (
                      <button onClick={() => doUninstall(b)} disabled={busy} style={miniBtn}>Remove</button>
                    ) : (
                      <button onClick={() => startInstall(b)} disabled={busy} style={{ ...btnStyle(accent), padding: '5px 12px', fontSize: 11.5 }}>Install</button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {confirming && (
        <div onClick={() => setConfirming(null)} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'grid', placeItems: 'center', zIndex: 20 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: 420, background: 'rgba(14,16,22,0.98)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 12, padding: 20 }}>
            <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>Install "{confirming.name}"?</div>
            <div style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.55)', marginBottom: 12 }}>
              This {confirming.kind} requests the following capabilities:
            </div>
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, lineHeight: 1.7 }}>
              {confirming.permissions.map((p) => <li key={p}>{describePermission(p)}</li>)}
            </ul>
            <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'flex-end' }}>
              <button onClick={() => setConfirming(null)} style={miniBtn}>Cancel</button>
              <button onClick={() => doInstall(confirming)} style={btnStyle(accent)}>Install &amp; grant</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%', fontSize: 12, padding: '7px 10px', marginTop: 4,
  background: 'rgba(0,0,0,0.35)', border: '1px solid rgba(255,255,255,0.1)',
  borderRadius: 6, color: '#fff', outline: 'none', boxSizing: 'border-box',
};
const miniBtn: React.CSSProperties = {
  padding: '4px 10px', fontSize: 11, cursor: 'pointer', borderRadius: 5,
  background: 'transparent', color: 'rgba(255,255,255,0.6)', border: '1px solid rgba(255,255,255,0.12)',
};
function btnStyle(accent: string): React.CSSProperties {
  return {
    padding: '7px 16px', fontSize: 12, fontWeight: 600, cursor: 'pointer', borderRadius: 6,
    background: accent, color: '#000', border: 'none',
  };
}

// Re-exported so viz-scripted can validate installed manifests with permissions.
export { validateManifest };

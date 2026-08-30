// ─────────────────────────────────────────────────────────────────────────────
// Cloud backup controls for the user preset store (0.9.15) — rendered in both
// specced entry points: the MilkDrop preset picker and Settings → Visualizer.
// See docs/CLOUD_PRESETS.md for the model: manual push/pull, local wins on
// conflict, so both buttons are always safe to click.
//
// No tokens here: the commands resolve the marketplace session Rust-side
// (marketplace.rs's secret store); this component only learns signed-in-or-not
// through useMarketplaceAuth, same as every other marketplace surface.
// ─────────────────────────────────────────────────────────────────────────────
import { useState } from 'react';
import { isTauri } from '../state/tauri';
import { cfgUrl } from '../state/marketplaceConfig';
import { useMarketplaceAuth } from '../state/marketplaceAuth';

interface PushResult { uploaded: number; skipped: number }
interface PullResult { downloaded: number; conflicts: number }

/** One line, honest about both directions — the conflict count is the whole
 *  reason a user can trust Restore. */
export function pushMessage(r: PushResult): string {
  if (r.uploaded === 0 && r.skipped === 0) return 'No presets to back up yet';
  if (r.uploaded === 0) return `All ${r.skipped} presets already backed up`;
  return r.skipped > 0
    ? `Backed up ${r.uploaded} (${r.skipped} already up to date)`
    : `Backed up ${r.uploaded}`;
}

export function pullMessage(r: PullResult): string {
  const kept = r.conflicts > 0
    ? ` · kept ${r.conflicts} local ${r.conflicts === 1 ? 'file' : 'files'} that differ from the cloud copy`
    : '';
  if (r.downloaded === 0) return r.conflicts > 0 ? `Nothing new to restore${kept}` : 'Cloud backup matches this device';
  return `Restored ${r.downloaded}${kept}`;
}

export function PresetCloudSync({ accent }: { accent: string }) {
  const { state: auth } = useMarketplaceAuth();
  const [busy, setBusy] = useState<null | 'push' | 'pull'>(null);
  const [status, setStatus] = useState<{ text: string; error: boolean } | null>(null);

  if (!isTauri) {
    return <Hint text="Cloud backup requires the desktop app." />;
  }
  if (auth.status === 'checking') return null;
  if (auth.status !== 'signed-in') {
    return <Hint text="Sign in to the marketplace (Community tab) to back up your presets." />;
  }

  const run = async (which: 'push' | 'pull') => {
    setBusy(which);
    setStatus(null);
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      if (which === 'push') {
        const r = await invoke<PushResult>('presets_cloud_push', { url: cfgUrl() });
        setStatus({ text: pushMessage(r), error: false });
      } else {
        const r = await invoke<PullResult>('presets_cloud_pull', { url: cfgUrl() });
        setStatus({ text: pullMessage(r), error: false });
        // Same event the marketplace install path fires — the MilkDrop
        // library clears its promise caches and rebuilds, so restored
        // presets appear without reopening the picker.
        if (r.downloaded > 0) window.dispatchEvent(new Event('market-presets:changed'));
      }
    } catch (e) {
      setStatus({ text: String(e), error: true });
    } finally {
      setBusy(null);
    }
  };

  const btn = (label: string, which: 'push' | 'pull', title: string) => (
    <button
      onClick={() => void run(which)}
      disabled={busy !== null}
      title={title}
      style={{
        padding: '4px 10px', fontSize: 10.5, fontWeight: 600,
        borderRadius: 'var(--control-radius, 5px)',
        background: 'var(--control-bg, rgba(255,255,255,0.06))',
        color: busy === which ? accent : 'rgba(255,255,255,0.85)',
        border: '1px solid var(--control-border, rgba(255,255,255,0.15))',
        cursor: busy ? 'default' : 'pointer', opacity: busy && busy !== which ? 0.5 : 1,
      }}
    >{busy === which ? '…' : label}</button>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, minWidth: 0 }}>
      <div style={{ display: 'flex', gap: 6 }}>
        {btn('Back up', 'push', 'Upload new and changed presets from this device to your account')}
        {btn('Restore', 'pull', 'Download presets missing on this device — never overwrites a local file')}
      </div>
      {status && (
        <div style={{
          fontSize: 10, textAlign: 'right', maxWidth: 260,
          color: status.error ? '#fca5a5' : 'rgba(255,255,255,0.55)',
        }}>{status.text}</div>
      )}
    </div>
  );
}

function Hint({ text }: { text: string }) {
  return (
    <div style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.4)', textAlign: 'right', maxWidth: 240 }}>
      {text}
    </div>
  );
}

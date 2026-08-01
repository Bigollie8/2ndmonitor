import { useCallback, useEffect, useRef, useState } from 'react';
import { shouldPrompt, SNOOZE_MS } from '../state/updater';

// ─────────────────────────────────────────────────────────────────────────────
// Auto-update toast: checks the release endpoint on mount and every 6h, and
// offers a one-click update+restart. The prompt DECISION lives in
// state/updater.ts (pure, tested); this component owns the effects.
//
// Snooze is deliberately localStorage, not the tweaks store: it is per-device
// UI throttling, not a user setting — it must not ride along in settings
// export/import, and it should survive without a store hydration cycle.
//
// The plugin modules are imported dynamically inside the effect (same pattern
// as every other tauri import in this codebase) so the component renders
// harmlessly in a plain browser during development.
// ─────────────────────────────────────────────────────────────────────────────

const SNOOZE_KEY = 'hub:updater:snooze:v1';
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;
const MONO = '"JetBrains Mono", ui-monospace, monospace';

function readSnooze(): { version: string; until: number } | null {
  try {
    const raw = localStorage.getItem(SNOOZE_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw);
    if (typeof p?.version === 'string' && typeof p?.until === 'number') return p;
  } catch { /* corrupt entry — treat as absent */ }
  return null;
}

export function UpdateToast({ accent }: { accent: string }) {
  const [offered, setOffered] = useState<{ version: string; notes: string | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Once per version per session — a ref, not state: it must survive re-renders
  // without triggering them, and reset only on a fresh app session.
  const promptedRef = useRef<string | null>(null);
  const updateRef = useRef<{ downloadAndInstall: () => Promise<void> } | null>(null);

  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      try {
        const [{ check }, { getVersion }] = await Promise.all([
          import('@tauri-apps/plugin-updater'),
          import('@tauri-apps/api/app'),
        ]);
        const [update, currentVersion] = await Promise.all([check(), getVersion()]);
        if (cancelled || !update) return;
        const snooze = readSnooze();
        const ok = shouldPrompt({
          currentVersion,
          offeredVersion: update.version,
          promptedThisSession: promptedRef.current,
          snoozedVersion: snooze?.version ?? null,
          snoozedUntil: snooze?.until ?? null,
        }, Date.now());
        if (!ok) return;
        promptedRef.current = update.version;
        updateRef.current = update;
        setOffered({ version: update.version, notes: update.body ?? null });
      } catch {
        // Endpoint unreachable / no releases yet / dev without tauri — all
        // silently fine; the next interval tick tries again.
      }
    };
    void check();
    const id = setInterval(() => { void check(); }, CHECK_EVERY_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  const install = useCallback(async () => {
    if (!updateRef.current) return;
    setBusy(true);
    setError(null);
    try {
      await updateRef.current.downloadAndInstall();
      const { relaunch } = await import('@tauri-apps/plugin-process');
      await relaunch();
    } catch (e) {
      setBusy(false);
      setError(String(e instanceof Error ? e.message : e));
    }
  }, []);

  const later = useCallback(() => {
    if (offered) {
      try {
        localStorage.setItem(SNOOZE_KEY, JSON.stringify({ version: offered.version, until: Date.now() + SNOOZE_MS }));
      } catch { /* storage full/blocked — session throttle still applies */ }
    }
    setOffered(null);
  }, [offered]);

  if (!offered) return null;
  return (
    <div style={{
      position: 'fixed', right: 16, bottom: 44, zIndex: 60, width: 280,
      background: 'rgba(10,11,15,0.92)', backdropFilter: 'blur(12px)',
      border: '1px solid rgba(255,255,255,0.09)', borderRadius: 10,
      padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 8,
    }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: 'rgba(255,255,255,0.9)' }}>
        Update available
      </div>
      <div style={{ fontSize: 10.5, fontFamily: MONO, color: 'rgba(255,255,255,0.5)' }}>
        v{offered.version} is ready to install.
      </div>
      {error && (
        <div style={{ fontSize: 10, color: '#fb7185' }}>
          Update failed: {error}
        </div>
      )}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button
          onClick={later}
          disabled={busy}
          style={{
            padding: '4px 10px', fontSize: 10.5, fontWeight: 600, borderRadius: 6,
            background: 'transparent', color: 'rgba(255,255,255,0.55)',
            border: '1px solid rgba(255,255,255,0.14)', cursor: busy ? 'not-allowed' : 'pointer',
          }}
        >Later</button>
        <button
          onClick={() => { void install(); }}
          disabled={busy}
          style={{
            padding: '4px 10px', fontSize: 10.5, fontWeight: 600, borderRadius: 6,
            background: `${accent}22`, color: accent,
            border: `1px solid ${accent}55`, cursor: busy ? 'not-allowed' : 'pointer',
          }}
        >{busy ? 'Installing…' : 'Update & restart'}</button>
      </div>
    </div>
  );
}

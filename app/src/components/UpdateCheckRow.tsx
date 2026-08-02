import { useCallback, useRef, useState } from 'react';
import { checkForUpdate, type UpdateCheckResult } from '../state/updaterClient';

// ─────────────────────────────────────────────────────────────────────────────
// The Settings → System "Check for updates" control: a user-initiated check
// with its result shown inline. Deliberately independent of UpdateToast's
// snooze/session gating — a user who PRESSES the button wants the answer,
// including one they snoozed an hour ago. Nothing downloads or installs
// unless they then click "Update & restart".
// ─────────────────────────────────────────────────────────────────────────────

const MONO = '"JetBrains Mono", ui-monospace, monospace';

type Phase =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'installing' }
  | UpdateCheckResult;

export function UpdateCheckRow({ accent }: { accent: string }) {
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const installRef = useRef<(() => Promise<void>) | null>(null);

  const runCheck = useCallback(async () => {
    setPhase({ kind: 'checking' });
    const result = await checkForUpdate();
    if (result.kind === 'update') installRef.current = result.install;
    setPhase(result);
  }, []);

  const install = useCallback(async () => {
    if (!installRef.current) return;
    setPhase({ kind: 'installing' });
    try {
      await installRef.current();
    } catch (e) {
      setPhase({ kind: 'error', message: String(e instanceof Error ? e.message : e) });
    }
  }, []);

  const button = (label: string, onClick: () => void, disabled = false) => (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: '5px 14px', fontSize: 11.5, fontWeight: 600,
        borderRadius: 6, cursor: disabled ? 'not-allowed' : 'pointer',
        background: `${accent}22`, border: `1px solid ${accent}44`,
        color: accent, opacity: disabled ? 0.55 : 1,
        flexShrink: 0,
      }}
    >{label}</button>
  );

  const status = (text: string, color = 'rgba(255,255,255,0.45)') => (
    <span style={{ fontSize: 10.5, fontFamily: MONO, color, textAlign: 'right' }}>{text}</span>
  );

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, justifyContent: 'flex-end' }}>
      {phase.kind === 'current' && status(`Up to date — v${phase.version}`)}
      {phase.kind === 'error' && status('Couldn’t reach the update server', '#fb7185')}
      {phase.kind === 'update' && status(`v${phase.version} available`, accent)}
      {phase.kind === 'installing' && status('Downloading… the app restarts when done')}

      {phase.kind === 'update'
        ? button('Update & restart', () => { void install(); })
        : button(
          phase.kind === 'checking' ? 'Checking…' : 'Check for updates',
          () => { void runCheck(); },
          phase.kind === 'checking' || phase.kind === 'installing',
        )}
    </div>
  );
}

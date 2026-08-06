/** Shown ONLY when the F11 converge loop gave up — the window refused the
 *  monitor rect after five passes. Exists because two releases of console
 *  warns produced zero tester reports with the numbers in them; the numbers
 *  now walk up to the tester with a Copy button. No debug flag: appearing on
 *  failure is its own gate. */
import { useState } from 'react';

export function F11DiagnosticCard({ report, onDismiss }: { report: string; onDismiss: () => void }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    void navigator.clipboard?.writeText(`F11 diagnostic\n${report}`).then(
      () => setCopied(true),
      () => { /* clipboard unavailable — the numbers stay visible to photograph */ },
    );
  };
  return (
    <div
      style={{
        position: 'fixed',
        bottom: 16,
        right: 16,
        zIndex: 9999,
        maxWidth: 440,
        padding: 12,
        background: 'var(--surface-chrome, rgba(8,9,12,0.94))',
        backdropFilter: 'blur(8px)',
        border: '1px solid rgba(250,204,21,0.35)',
        borderRadius: 8,
        color: 'rgba(255,255,255,0.85)',
        fontSize: 12,
        lineHeight: 1.5,
      }}
    >
      <div style={{ fontWeight: 700, color: '#facc15', marginBottom: 6 }}>
        Fullscreen couldn't cover the monitor exactly
      </div>
      <div style={{ color: 'rgba(255,255,255,0.65)', marginBottom: 8 }}>
        Please tap Copy and paste this into the Discord bug thread — it pinpoints the cause on your setup.
      </div>
      <pre
        style={{
          margin: '0 0 10px',
          padding: 8,
          background: 'rgba(255,255,255,0.04)',
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: 4,
          fontFamily: '"JetBrains Mono", ui-monospace, monospace',
          fontSize: 10.5,
          whiteSpace: 'pre-wrap',
          overflowX: 'auto',
        }}
      >{report}</pre>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button onClick={copy} style={btn}>{copied ? 'Copied ✓' : 'Copy'}</button>
        <button onClick={onDismiss} style={btn}>Dismiss</button>
      </div>
    </div>
  );
}

const btn: React.CSSProperties = {
  background: 'rgba(255,255,255,0.08)',
  border: '1px solid rgba(255,255,255,0.14)',
  color: 'rgba(255,255,255,0.85)',
  fontSize: 12,
  padding: '4px 12px',
  borderRadius: 4,
  cursor: 'pointer',
};

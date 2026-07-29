import React from 'react';

/** Standard tile-state primitives — one visual language for loading, empty,
 *  needs-setup, and error across every tile. All four fill their parent
 *  (tiles lay content in a `position:absolute; inset:0` wrapper) and are
 *  pointer-transparent except for their buttons, so edit-mode drag/resize
 *  keeps working underneath. Never spinners — skeletons pulse. */

const fill: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 10,
  padding: 14,
  textAlign: 'center',
  pointerEvents: 'none',
};

/** Cycle of bar widths so skeleton rows read as "content-shaped", not stripes. */
const SKELETON_WIDTHS = ['72%', '48%', '85%', '60%', '38%', '78%'];

export function TileSkeleton({ rows = 3 }: { rows?: number; accent?: string }) {
  return (
    <div style={{
      ...fill,
      alignItems: 'stretch',
      justifyContent: 'center',
      gap: 10,
      padding: '14px 16px',
    }} aria-hidden>
      <style>{`@keyframes tile-skel-pulse { 0%, 100% { opacity: 1 } 50% { opacity: 0.45 } }`}</style>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} style={{
          height: 10,
          borderRadius: 5,
          width: SKELETON_WIDTHS[i % SKELETON_WIDTHS.length],
          background: i % 2 === 0 ? 'rgba(255,255,255,0.07)' : 'rgba(255,255,255,0.05)',
          animation: 'tile-skel-pulse 1.6s ease-in-out infinite',
          animationDelay: `${i * 0.15}s`,
        }} />
      ))}
    </div>
  );
}

export function TileEmpty({ icon, line }: { icon: React.ReactNode; line: React.ReactNode; accent?: string }) {
  return (
    <div style={{ ...fill, gap: 8 }}>
      <span aria-hidden style={{ fontSize: 18, lineHeight: 1, color: 'rgba(255,255,255,0.25)' }}>{icon}</span>
      <div style={{ fontSize: 11, lineHeight: 1.5, color: 'rgba(255,255,255,0.45)', maxWidth: 260 }}>{line}</div>
    </div>
  );
}

export function TileNeedsSetup({ line, buttonLabel = 'Set up →', onSetup, accent }: {
  line: React.ReactNode;
  buttonLabel?: string;
  onSetup?: () => void;
  accent?: string;
}) {
  const bg = accent ?? '#fff';
  return (
    <div style={fill}>
      <div style={{ fontSize: 11, lineHeight: 1.5, color: 'rgba(255,255,255,0.6)', maxWidth: 280 }}>{line}</div>
      {onSetup && (
        <button
          onClick={onSetup}
          style={{
            pointerEvents: 'auto',
            padding: '7px 14px', fontSize: 11, fontWeight: 700,
            background: bg, color: '#000',
            border: 'none', borderRadius: 5, cursor: 'pointer',
          }}
        >{buttonLabel}</button>
      )}
    </div>
  );
}

export function TileError({ line, onRetry }: { line: React.ReactNode; onRetry?: () => void; accent?: string }) {
  return (
    <div style={fill}>
      <div style={{ fontSize: 11, lineHeight: 1.5, color: '#fca5a5', maxWidth: 280 }}>{line}</div>
      {onRetry && (
        <button
          onClick={onRetry}
          style={{
            pointerEvents: 'auto',
            padding: '5px 12px', fontSize: 10, fontWeight: 600,
            background: 'transparent', color: '#fca5a5',
            border: '1px solid rgba(252,165,165,0.4)', borderRadius: 5,
            cursor: 'pointer',
            fontFamily: '"JetBrains Mono", ui-monospace, monospace',
          }}
        >Retry</button>
      )}
    </div>
  );
}

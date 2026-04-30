import { HFTile } from './tiles';
import type { Density } from '../types';
import { type ClaudeSession, type ClaudeStatus, useClaudeSessions } from '../state/tauri';

export function ClaudeCodeTile({ density, accent }: { density: Density; accent: string }) {
  const sessions = useClaudeSessions();
  const activeCount = sessions.filter((s) => s.status !== 'idle').length;
  const needsAttention = sessions.filter((s) => s.status === 'awaiting_user' || s.status === 'permission').length;

  return (
    <HFTile
      title="Claude Code"
      density={density}
      badge={
        needsAttention > 0 ? (
          <span style={{
            fontSize: 9, color: '#fb7185', padding: '2px 6px', borderRadius: 4,
            background: 'rgba(251,113,133,0.15)', border: '1px solid rgba(251,113,133,0.4)',
            letterSpacing: '.05em', fontWeight: 700,
          }}>
            ● {needsAttention} NEED YOU
          </span>
        ) : (
          <span style={{
            fontSize: 9, color: 'rgba(255,255,255,0.5)', padding: '2px 6px', borderRadius: 4,
            background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
            letterSpacing: '.05em',
          }}>
            {activeCount} active
          </span>
        )
      }
      headRight={<span style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', fontFamily: '"JetBrains Mono", ui-monospace, monospace' }}>~/.claude</span>}
      style={{ height: '100%' }}
    >
      <div style={{ position: 'absolute', inset: 0, padding: 8, display: 'flex', flexDirection: 'column', gap: 4, overflow: 'hidden' }}>
        {sessions.length === 0 ? (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'rgba(255,255,255,0.4)', fontSize: 11, textAlign: 'center', padding: 16 }}>
            No active Claude Code sessions in the last 24 h.
          </div>
        ) : (
          sessions.slice(0, 6).map((s) => (
            <SessionRow key={`${s.project_path}/${s.session_id}`} session={s} accent={accent} />
          ))
        )}
      </div>
    </HFTile>
  );
}

function SessionRow({ session, accent }: { session: ClaudeSession; accent: string }) {
  const sty = statusStyle(session.status, accent);
  return (
    <div style={{
      display: 'flex', gap: 10, alignItems: 'center',
      padding: '6px 8px', borderRadius: 6,
      background: sty.bg,
      border: `1px solid ${sty.border}`,
      minHeight: 38,
    }}>
      <span style={{
        width: 8, height: 8, borderRadius: 999,
        background: sty.dot,
        boxShadow: sty.glow ? `0 0 8px ${sty.dot}` : 'none',
        flexShrink: 0,
        animation: sty.pulse ? 'cc-pulse 1.4s ease-in-out infinite' : undefined,
      }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', gap: 6, alignItems: 'baseline' }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{session.project}</span>
          <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', fontFamily: '"JetBrains Mono", ui-monospace, monospace' }}>{fmtAge(session.last_activity_secs)}</span>
        </div>
        <div style={{ fontSize: 10.5, color: sty.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {session.status_detail}
        </div>
        {session.last_user_msg && (
          <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', fontStyle: 'italic', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            "{session.last_user_msg}"
          </div>
        )}
      </div>
      <style>{`@keyframes cc-pulse { 0%,100% { opacity: 1 } 50% { opacity: 0.35 } }`}</style>
    </div>
  );
}

function statusStyle(status: ClaudeStatus, accent: string): {
  dot: string; bg: string; border: string; text: string; glow: boolean; pulse: boolean;
} {
  switch (status) {
    case 'awaiting_user':
      return {
        dot: '#fb7185',
        bg: 'rgba(251,113,133,0.08)',
        border: 'rgba(251,113,133,0.35)',
        text: '#fda4af',
        glow: true,
        pulse: true,
      };
    case 'permission':
      return {
        dot: '#facc15',
        bg: 'rgba(250,204,21,0.08)',
        border: 'rgba(250,204,21,0.35)',
        text: '#fde68a',
        glow: true,
        pulse: true,
      };
    case 'running_tool':
      return {
        dot: '#22c55e',
        bg: 'rgba(34,197,94,0.06)',
        border: 'rgba(34,197,94,0.25)',
        text: '#86efac',
        glow: true,
        pulse: false,
      };
    case 'working':
      return {
        dot: accent,
        bg: 'rgba(255,255,255,0.03)',
        border: 'rgba(255,255,255,0.08)',
        text: 'rgba(255,255,255,0.7)',
        glow: false,
        pulse: false,
      };
    case 'idle':
    default:
      return {
        dot: 'rgba(255,255,255,0.25)',
        bg: 'rgba(255,255,255,0.02)',
        border: 'rgba(255,255,255,0.05)',
        text: 'rgba(255,255,255,0.4)',
        glow: false,
        pulse: false,
      };
  }
}

function fmtAge(secs: number): string {
  if (secs < 60) return `${secs}s ago`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  return `${Math.floor(secs / 3600)}h ago`;
}

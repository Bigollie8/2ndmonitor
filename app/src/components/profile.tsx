import React from 'react';
import type { Profile } from '../types';

interface ProfileSpec {
  id: Profile;
  name: string;
  subtitle: string;
  layout: 'work' | 'gaming' | 'chill';
  tileCount: number;
}

const PROFILES: ProfileSpec[] = [
  { id: 'work',   name: 'Work',   subtitle: 'Focus · sysmon · calendar',     layout: 'work',   tileCount: 8 },
  { id: 'gaming', name: 'Gaming', subtitle: 'Viz hero · sysmon · discord',   layout: 'gaming', tileCount: 6 },
  { id: 'chill',  name: 'Chill',  subtitle: 'Ambient · spotify · clock',     layout: 'chill',  tileCount: 5 },
];

export function ProfileSwitcher({ accent, currentProfile, setProfile, onClose, onCreate }: {
  accent: string;
  currentProfile: Profile;
  setProfile: (p: Profile) => void;
  onClose: () => void;
  onCreate: () => void;
}) {
  return (
    <div onClick={onClose} style={{
      position: 'absolute', inset: 0, zIndex: 80,
      background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(12px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        width: 1600, padding: 48, borderRadius: 18,
        background: 'rgba(15,17,22,0.95)',
        border: '1px solid rgba(255,255,255,0.08)',
        boxShadow: '0 40px 100px rgba(0,0,0,0.6)',
      }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 16, marginBottom: 8 }}>
          <h2 style={{ fontSize: 28, margin: 0, fontWeight: 700, letterSpacing: '-0.02em' }}>Switch profile</h2>
          <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', fontFamily: '"JetBrains Mono", ui-monospace, monospace' }}>⌘ + 1 / 2 / 3</span>
        </div>
        <p style={{ fontSize: 14, color: 'rgba(255,255,255,0.55)', margin: '0 0 32px 0' }}>
          Each profile is a layout of tiles tuned for a context. Hub crossfades between them with shared-element transitions.
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 20 }}>
          {PROFILES.map((p) => (
            <ProfileCard key={p.id} profile={p} accent={accent} active={p.id === currentProfile} onClick={() => { setProfile(p.id); onClose(); }} />
          ))}
        </div>
        <div style={{ marginTop: 24, display: 'flex', gap: 12, alignItems: 'center' }}>
          <button onClick={onCreate} style={{
            padding: '12px 18px', fontSize: 13, fontWeight: 600,
            background: 'transparent', color: 'rgba(255,255,255,0.7)',
            border: '1px dashed rgba(255,255,255,0.15)', borderRadius: 8,
            cursor: 'pointer',
          }}>+ New profile from current</button>
          <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', flex: 1 }}>
            Profiles auto-switch on app focus rules — e.g. Gaming when fullscreen game launches.
          </span>
          <button onClick={onClose} style={{
            padding: '10px 16px', fontSize: 12, color: 'rgba(255,255,255,0.5)',
            background: 'transparent', border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: 6, cursor: 'pointer',
          }}>Esc</button>
        </div>
      </div>
    </div>
  );
}

function ProfileCard({ profile, accent, active, onClick }: { profile: ProfileSpec; accent: string; active: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} style={{
      padding: 0, borderRadius: 12, overflow: 'hidden',
      background: active ? `${accent}10` : 'rgba(255,255,255,0.02)',
      border: active ? `2px solid ${accent}` : '2px solid rgba(255,255,255,0.06)',
      cursor: 'pointer', textAlign: 'left', color: '#fff',
      transition: 'transform .15s, border-color .15s',
      transform: active ? 'translateY(-2px)' : 'none',
      boxShadow: active ? `0 12px 40px -8px ${accent}66` : 'none',
    }}>
      <ProfilePreview layout={profile.layout} accent={accent} />
      <div style={{ padding: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <span style={{ fontSize: 16, fontWeight: 700 }}>{profile.name}</span>
          {active && <span style={{ fontSize: 9, color: accent, padding: '2px 8px', background: `${accent}20`, borderRadius: 3, fontFamily: '"JetBrains Mono", ui-monospace, monospace', letterSpacing: '.05em' }}>● ACTIVE</span>}
        </div>
        <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.55)', marginBottom: 8 }}>{profile.subtitle}</div>
        <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)', fontFamily: '"JetBrains Mono", ui-monospace, monospace' }}>{profile.tileCount} tiles</div>
      </div>
    </button>
  );
}

export function ProfilePreview({ layout, accent }: { layout: 'work' | 'gaming' | 'chill'; accent: string }) {
  const w = 480, h = 270;
  const stroke = 'rgba(255,255,255,0.06)';
  const fill = 'rgba(255,255,255,0.03)';
  const vizFill = `${accent}40`;
  const vizStroke = `${accent}88`;

  if (layout === 'work') {
    return (
      <svg viewBox={`0 0 ${w} ${h}`} style={{ width: '100%', display: 'block', background: '#06070a' }}>
        <rect x="0" y="0" width={w} height="14" fill="rgba(255,255,255,0.04)" />
        <rect x="8" y="20" width="100" height="50" fill={fill} stroke={stroke} rx="3" />
        <rect x="8" y="74" width="100" height="40" fill={fill} stroke={stroke} rx="3" />
        <rect x="8" y="118" width="100" height="30" fill={fill} stroke={stroke} rx="3" />
        <rect x="8" y="152" width="100" height="30" fill={fill} stroke={stroke} rx="3" />
        <rect x="8" y="186" width="100" height="30" fill={fill} stroke={stroke} rx="3" />
        <rect x="112" y="20" width={w - 120} height="160" fill={vizFill} stroke={vizStroke} rx="3" />
        <rect x="112" y="184" width="180" height="36" fill={fill} stroke={stroke} rx="3" />
        <rect x="296" y="184" width="80" height="36" fill={fill} stroke={stroke} rx="3" />
        <rect x="380" y="184" width={w - 388} height="36" fill={fill} stroke={stroke} rx="3" />
        <rect x="0" y={h - 8} width={w} height="8" fill="rgba(255,255,255,0.04)" />
      </svg>
    );
  }
  if (layout === 'gaming') {
    return (
      <svg viewBox={`0 0 ${w} ${h}`} style={{ width: '100%', display: 'block', background: '#06070a' }}>
        <rect x="0" y="0" width={w} height="14" fill="rgba(255,255,255,0.04)" />
        <rect x="8" y="20" width={w - 16} height="160" fill={vizFill} stroke={vizStroke} rx="3" />
        <rect x="8" y="184" width={w - 16} height="36" fill={fill} stroke={stroke} rx="3" />
        <line x1={(w / 3)} y1="190" x2={(w / 3)} y2="214" stroke={stroke} />
        <line x1={(2 * w / 3)} y1="190" x2={(2 * w / 3)} y2="214" stroke={stroke} />
        <rect x="0" y={h - 8} width={w} height="8" fill="rgba(255,255,255,0.04)" />
      </svg>
    );
  }
  return (
    <svg viewBox={`0 0 ${w} ${h}`} style={{ width: '100%', display: 'block', background: '#06070a' }}>
      <rect x="0" y="0" width={w} height="14" fill="rgba(255,255,255,0.04)" />
      <rect x="0" y="14" width={w} height={h - 22} fill={vizFill} stroke="none" />
      <rect x="20" y="40" width="180" height="80" fill="rgba(8,9,12,0.6)" stroke={vizStroke} rx="6" />
      <rect x="20" y={h - 100} width="180" height="60" fill="rgba(8,9,12,0.6)" stroke={vizStroke} rx="6" />
      <rect x={w - 200} y="40" width="180" height="60" fill="rgba(8,9,12,0.6)" stroke={vizStroke} rx="6" />
      <rect x="0" y={h - 8} width={w} height="8" fill="rgba(255,255,255,0.04)" />
    </svg>
  );
}

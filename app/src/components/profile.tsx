import type { Profile } from '../types';

export function ProfileSwitcher({ accent, profiles, activeProfileId, setActiveProfileId, setProfiles, onClose }: {
  accent: string;
  profiles: Profile[];
  activeProfileId: string;
  setActiveProfileId: (id: string) => void;
  setProfiles: (next: Profile[]) => void;
  onClose: () => void;
}) {
  // Minimal stub to keep the build green between phases B-3 and B-4.
  // Phase B-4 replaces this with real CRUD UI.
  return (
    <div onClick={onClose} style={{ position: 'absolute', inset: 0, zIndex: 80, background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(12px)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ padding: 32, background: '#0f1116', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 12, color: '#fff' }}>
        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>Profiles ({profiles.length})</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {profiles.map((p) => (
            <button key={p.id} onClick={() => { setActiveProfileId(p.id); onClose(); }} style={{ padding: '6px 12px', textAlign: 'left', background: p.id === activeProfileId ? `${p.color}22` : 'transparent', border: `1px solid ${p.id === activeProfileId ? p.color : 'rgba(255,255,255,0.1)'}`, color: '#fff', borderRadius: 6, cursor: 'pointer' }}>
              {p.name}
            </button>
          ))}
        </div>
        <div style={{ marginTop: 12, fontSize: 10, color: 'rgba(255,255,255,0.4)' }}>Stub UI — full switcher in B-4. accent: {accent}. setProfiles fn ready.</div>
      </div>
    </div>
  );
}

// Backwards-compatible export — onboarding.tsx uses this with hardcoded layout strings.
// Identical to the original implementation; kept intact so onboarding keeps rendering.
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

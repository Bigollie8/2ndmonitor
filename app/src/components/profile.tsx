import { useState } from 'react';
import type { Profile } from '../types';
import type { TileId, Rect } from './../state/layout';
import { DEFAULT_LAYOUT, DEFAULT_LANDSCAPE_LAYOUT, CANVAS, migrateLegacyProfileToOrientations } from './../state/layout';

const CARD_PALETTE = [
  '#a78bfa', '#f59e0b', '#22d3ee', '#22c55e',
  '#f472b6', '#60a5fa', '#facc15', '#f97316',
];

function newId(): string {
  return (typeof crypto !== 'undefined' && crypto.randomUUID)
    ? crypto.randomUUID()
    : `p_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

export function ProfileSwitcher({
  accent, profiles, activeProfileId, setActiveProfileId, setProfiles, onClose,
}: {
  accent: string;
  profiles: Profile[];
  activeProfileId: string;
  setActiveProfileId: (id: string) => void;
  setProfiles: (next: Profile[]) => void;
  onClose: () => void;
}) {
  const activeProfile = profiles.find((p) => p.id === activeProfileId) ?? profiles[0];

  const updateProfile = (id: string, patch: Partial<Profile>) => {
    setProfiles(profiles.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  };

  const deleteProfile = (id: string) => {
    if (profiles.length <= 1) return;
    if (!window.confirm('Delete this profile? Its layout will be lost.')) return;
    const next = profiles.filter((p) => p.id !== id);
    setProfiles(next);
    if (id === activeProfileId) {
      setActiveProfileId(next[0]!.id);
    }
  };

  const createProfile = () => {
    const source = activeProfile ?? profiles[0];
    const usedColors = new Set(profiles.map((p) => p.color));
    const color = CARD_PALETTE.find((c) => !usedColors.has(c)) ?? CARD_PALETTE[profiles.length % CARD_PALETTE.length]!;
    const baseName = `Profile ${profiles.length + 1}`;
    const created: Profile = migrateLegacyProfileToOrientations({
      id: newId(),
      name: baseName,
      color,
      layout: source ? { ...source.landscape.layout } : {},
      hidden: source ? { ...source.landscape.hidden } : {},
    });
    setProfiles([...profiles, created]);
    setActiveProfileId(created.id);
  };

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
        maxHeight: 'calc(100vh - 120px)', overflow: 'auto',
      }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 16, marginBottom: 8 }}>
          <h2 style={{ fontSize: 28, margin: 0, fontWeight: 700, letterSpacing: '-0.02em' }}>Switch profile</h2>
          <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', fontFamily: '"JetBrains Mono", ui-monospace, monospace' }}>⌘ + 1 / 2 / 3</span>
        </div>
        <p style={{ fontSize: 14, color: 'rgba(255,255,255,0.55)', margin: '0 0 32px 0' }}>
          Each profile owns its own tile layout and visibility. Other settings (todos, weather, viz) stay shared across profiles.
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 20 }}>
          {profiles.map((p) => (
            <ProfileCard
              key={p.id}
              profile={p}
              accent={accent}
              active={p.id === activeProfileId}
              canDelete={profiles.length > 1}
              onSelect={() => { setActiveProfileId(p.id); onClose(); }}
              onRename={(name) => updateProfile(p.id, { name })}
              onRecolor={(color) => updateProfile(p.id, { color })}
              onDelete={() => deleteProfile(p.id)}
            />
          ))}
          <button onClick={createProfile} style={{
            padding: 0, borderRadius: 12, overflow: 'hidden',
            background: 'transparent',
            border: '2px dashed rgba(255,255,255,0.15)',
            cursor: 'pointer', color: 'rgba(255,255,255,0.55)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            minHeight: 270, fontSize: 14,
          }}>
            + New profile from current
          </button>
        </div>
        <div style={{ marginTop: 24, display: 'flex', gap: 12, alignItems: 'center' }}>
          <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', flex: 1 }}>
            Click a card name to rename. Click the swatch to recolor.
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

function ProfileCard({
  profile, accent, active, canDelete, onSelect, onRename, onRecolor, onDelete,
}: {
  profile: Profile;
  accent: string;
  active: boolean;
  canDelete: boolean;
  onSelect: () => void;
  onRename: (name: string) => void;
  onRecolor: (color: string) => void;
  onDelete: () => void;
}) {
  const [editingName, setEditingName] = useState(false);
  const [draftName, setDraftName] = useState(profile.name);

  const commitName = () => {
    const next = draftName.trim();
    if (next && next !== profile.name) onRename(next);
    else setDraftName(profile.name);
    setEditingName(false);
  };

  // Match the preview: count visible tiles (i.e. not hidden), regardless of
  // whether their rect is custom or falls back to DEFAULT_LAYOUT.
  const ALL_TILES: TileId[] = ['discord', 'spotify', 'claude', 'notes', 'sysmon', 'clock', 'viz'];
  const tileCount = ALL_TILES.filter((id) => !profile.landscape.hidden[id]).length;

  return (
    <div style={{
      borderRadius: 12, overflow: 'hidden',
      background: active ? `${profile.color}10` : 'rgba(255,255,255,0.02)',
      border: active ? `2px solid ${profile.color}` : '2px solid rgba(255,255,255,0.06)',
      transition: 'transform .15s, border-color .15s',
      transform: active ? 'translateY(-2px)' : 'none',
      boxShadow: active ? `0 12px 40px -8px ${profile.color}66` : 'none',
      display: 'flex', flexDirection: 'column',
    }}>
      <button onClick={onSelect} style={{ all: 'unset', cursor: 'pointer', display: 'block' }}>
        <LayoutPreview profile={profile} />
      </button>
      <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <label title="Profile color" style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', cursor: 'pointer' }}>
            <span style={{
              width: 14, height: 14, borderRadius: 3, background: profile.color,
              border: '1px solid rgba(255,255,255,0.18)',
            }} />
            <input
              type="color"
              value={profile.color}
              onChange={(e) => onRecolor(e.target.value)}
              style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer' }}
            />
          </label>
          {editingName ? (
            <input
              autoFocus
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
              onBlur={commitName}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); commitName(); }
                else if (e.key === 'Escape') { e.preventDefault(); setDraftName(profile.name); setEditingName(false); }
              }}
              style={{
                flex: 1, fontSize: 16, fontWeight: 700,
                background: 'rgba(255,255,255,0.06)',
                border: '1px solid rgba(255,255,255,0.12)',
                color: '#fff', padding: '3px 6px', borderRadius: 4,
                outline: 'none',
              }}
            />
          ) : (
            <button
              onClick={() => { setDraftName(profile.name); setEditingName(true); }}
              style={{
                flex: 1, textAlign: 'left',
                fontSize: 16, fontWeight: 700, color: '#fff',
                background: 'transparent', border: 'none', cursor: 'pointer',
                padding: 0,
              }}
            >
              {profile.name}
            </button>
          )}
          {active && (
            <span style={{
              fontSize: 9, color: profile.color, padding: '2px 8px',
              background: `${profile.color}20`, borderRadius: 3,
              fontFamily: '"JetBrains Mono", ui-monospace, monospace', letterSpacing: '.05em',
            }}>● ACTIVE</span>
          )}
          <button
            onClick={onDelete}
            disabled={!canDelete}
            title={canDelete ? 'Delete profile' : 'Cannot delete the only profile'}
            style={{
              fontSize: 14, padding: '0 4px', lineHeight: 1,
              background: 'transparent', border: 'none',
              color: canDelete ? 'rgba(255,255,255,0.45)' : 'rgba(255,255,255,0.15)',
              cursor: canDelete ? 'pointer' : 'not-allowed',
            }}
          >🗑</button>
        </div>
        <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)', fontFamily: '"JetBrains Mono", ui-monospace, monospace' }}>
          {tileCount} tile{tileCount === 1 ? '' : 's'} · {Object.keys(profile.landscape.hidden).filter((k) => profile.landscape.hidden[k as TileId]).length} hidden
        </div>
      </div>
    </div>
  );
}

/** New: render the profile's actual layout as a small SVG. Used by the switcher. */
function LayoutPreview({ profile }: { profile: Profile }) {
  const W = 480, H = 270;
  const sx = W / CANVAS.w;
  const sy = H / CANVAS.h;

  const tileIds: TileId[] = ['discord', 'spotify', 'claude', 'notes', 'sysmon', 'clock', 'viz'];
  const visible = tileIds.filter((id) => !profile.landscape.hidden[id]);

  const rectFor = (id: TileId): Rect => {
    const r = profile.landscape.layout[id] ?? DEFAULT_LANDSCAPE_LAYOUT[id];
    // Fractional coords — scale to SVG canvas pixels
    return { x: r.x * CANVAS.w, y: r.y * CANVAS.h, w: r.w * CANVAS.w, h: r.h * CANVAS.h };
  };

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', display: 'block', background: '#06070a' }}>
      <rect x="0" y="0" width={W} height={56 * sy} fill="rgba(255,255,255,0.04)" />
      {visible.map((id) => {
        const r = rectFor(id);
        const isViz = id === 'viz';
        return (
          <rect
            key={id}
            x={r.x * sx} y={r.y * sy}
            width={r.w * sx} height={r.h * sy}
            fill={isViz ? `${profile.color}40` : 'rgba(255,255,255,0.03)'}
            stroke={isViz ? `${profile.color}88` : 'rgba(255,255,255,0.06)'}
            rx={3}
          />
        );
      })}
      <rect x="0" y={H - 32 * sy} width={W} height={32 * sy} fill="rgba(255,255,255,0.04)" />
    </svg>
  );
}

/** Backwards-compat: hardcoded SVG preview for onboarding's static template
 *  cards. Same signature and bodies as the original profile.tsx export. */
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

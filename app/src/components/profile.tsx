import React, { useState } from 'react';
import type { Profile } from '../types';
import type { TileInstance } from './../state/layout';
import { newId } from './../state/layout';
import {
  buildProfileExport, exportFileName, parseProfileExport, type ParsedProfile,
  buildSetupExport, parseSetupExport, mergeSetupTiles, setupExportFileName,
} from '../state/profileIO';
import { TILE_META } from '../state/tileMeta';
import type { BuiltinTileType } from '../state/layout';

const CARD_PALETTE = [
  '#a78bfa', '#f59e0b', '#22d3ee', '#22c55e',
  '#f472b6', '#60a5fa', '#facc15', '#f97316',
];

export function ProfileSwitcher({
  accent, profiles, activeProfileId, setActiveProfileId, setProfiles, orientation, onClose,
}: {
  accent: string;
  profiles: Profile[];
  activeProfileId: string;
  setActiveProfileId: (id: string) => void;
  setProfiles: (next: Profile[]) => void;
  /** Which orientation setup export/import targets (0.9.8) — the one the
   *  user is looking at. */
  orientation: 'landscape' | 'portrait';
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
    // Clone source tiles with fresh instanceIds so the new profile is independent.
    const cloneTiles = (ts: TileInstance[]): TileInstance[] =>
      ts.map((t) => ({ ...t, instanceId: newId() }));
    const created: Profile = {
      id: newId(),
      name: baseName,
      color,
      landscape: { tiles: source ? cloneTiles(source.landscape.tiles) : [] },
      portrait:  { tiles: source ? cloneTiles(source.portrait.tiles)  : [] },
    };
    setProfiles([...profiles, created]);
    setActiveProfileId(created.id);
  };

  const [importPending, setImportPending] = useState<ParsedProfile | null>(null);
  const [importError, setImportError] = useState<string | null>(null);

  // Same native save-dialog pathway as Settings → Export (App.tsx
  // onExportSettings): the Rust `tweaks_export` command. Browser dev has no
  // Tauri — the invoke rejects and we just log, matching that call site.
  const exportProfile = async (p: Profile) => {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('tweaks_export', {
        json: JSON.stringify(buildProfileExport(p)),
        fileName: exportFileName(p.name),
      });
    } catch (err) {
      console.warn('profile export failed:', err);
    }
  };

  // Same native open-dialog pathway as Settings → Import: `tweaks_import`
  // picks a .json, guarantees it parses to a JSON object (native error
  // dialog otherwise), and returns the text. Profile-shape validation is
  // parseProfileExport (state/profileIO.ts). Invalid → inline error only,
  // nothing changes.
  const importProfile = async () => {
    setImportError(null);
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const text = await invoke<string | null>('tweaks_import');
      if (!text) return; // picker cancelled, or Rust already showed its error dialog
      const result = parseProfileExport(JSON.parse(text));
      if (!result.ok) { setImportError(result.error); return; }
      setImportPending(result.profile);
    } catch (err) {
      console.warn('profile import failed:', err);
      setImportError('Import needs the desktop app.');
    }
  };

  // ── Partial setups (0.9.8): share an arrangement without a whole profile ──
  /** Open state of the export-setup tile picker; holds the selected ids. */
  const [setupPicker, setSetupPicker] = useState<Set<string> | null>(null);
  const [setupNote, setSetupNote] = useState<string | null>(null);

  const activeTiles = activeProfile?.[orientation].tiles ?? [];

  const tileLabel = (t: TileInstance): string =>
    t.name ?? TILE_META[t.type as BuiltinTileType]?.label ?? t.type;

  const exportSetup = async (tiles: TileInstance[]) => {
    if (!activeProfile || tiles.length === 0) return;
    const name = `${activeProfile.name} setup`;
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('tweaks_export', {
        json: JSON.stringify(buildSetupExport(name, orientation, tiles)),
        fileName: setupExportFileName(name),
      });
      setSetupPicker(null);
    } catch (err) {
      console.warn('setup export failed:', err);
    }
  };

  const importSetup = async () => {
    setImportError(null);
    setSetupNote(null);
    if (!activeProfile) return;
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const text = await invoke<string | null>('tweaks_import');
      if (!text) return;
      const result = parseSetupExport(JSON.parse(text));
      if (!result.ok) { setImportError(result.error); return; }
      // Additive merge into the CURRENT orientation of the active profile —
      // nothing existing moves or disappears, so no confirmation dialog.
      const { tiles, dropped } = mergeSetupTiles(activeTiles, result.setup.tiles);
      setProfiles(profiles.map((p) => (p.id === activeProfile.id
        ? { ...p, [orientation]: { tiles } }
        : p)));
      const added = result.setup.tiles.length - dropped;
      setSetupNote(
        `Added ${added} tile${added === 1 ? '' : 's'} from “${result.setup.name}”` +
        (result.setup.orientation !== orientation ? ` (designed for ${result.setup.orientation})` : '') +
        (dropped > 0 ? ` — ${dropped} dropped at the tile cap` : ''),
      );
    } catch (err) {
      console.warn('setup import failed:', err);
      setImportError('Import needs the desktop app.');
    }
  };

  const applyImport = (choice: { mode: 'new' } | { mode: 'overwrite'; profileId: string }) => {
    if (!importPending) return;
    if (choice.mode === 'overwrite') {
      // Keep the id so activeProfileId (and ⌘1/2/3 order) stays valid.
      setProfiles(profiles.map((p) => (p.id === choice.profileId
        ? { ...p, name: importPending.name, color: importPending.color, landscape: importPending.landscape, portrait: importPending.portrait }
        : p)));
    } else {
      const created: Profile = { id: newId(), ...importPending };
      setProfiles([...profiles, created]);
      setActiveProfileId(created.id);
    }
    setImportPending(null);
  };

  return (
    <div onClick={onClose} style={{
      position: 'absolute', inset: 0, zIndex: 80,
      background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(12px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        width: 1600, padding: 48, borderRadius: 18,
        background: 'var(--surface-overlay, rgba(15,17,22,0.95))',
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
              onExport={() => { void exportProfile(p); }}
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
          {importError && (
            <span style={{ fontSize: 12, color: '#fb7185' }}>{importError}</span>
          )}
          {setupNote && (
            <span style={{ fontSize: 12, color: accent }}>{setupNote}</span>
          )}
          <button
            onClick={() => setSetupPicker(setupPicker ? null : new Set(activeTiles.map((t) => t.instanceId)))}
            title={`Share some or all of the ${orientation} arrangement as a setup file`}
            style={{
              padding: '10px 16px', fontSize: 12,
              color: setupPicker ? accent : 'rgba(255,255,255,0.7)',
              background: 'transparent',
              border: `1px solid ${setupPicker ? `${accent}66` : 'rgba(255,255,255,0.15)'}`,
              borderRadius: 'var(--control-radius, 6px)', cursor: 'pointer',
            }}
          >Export setup…</button>
          <button onClick={() => { void importSetup(); }} title="Merge a shared setup's tiles into this profile" style={{
            padding: '10px 16px', fontSize: 12, color: 'rgba(255,255,255,0.7)',
            background: 'transparent', border: '1px solid var(--control-border, rgba(255,255,255,0.15))',
            borderRadius: 'var(--control-radius, 6px)', cursor: 'pointer',
          }}>Import setup…</button>
          <button onClick={() => { void importProfile(); }} style={{
            padding: '10px 16px', fontSize: 12, color: 'rgba(255,255,255,0.7)',
            background: 'transparent', border: '1px solid var(--control-border, rgba(255,255,255,0.15))',
            borderRadius: 'var(--control-radius, 6px)', cursor: 'pointer',
          }}>Import profile…</button>
          <button onClick={onClose} style={{
            padding: '10px 16px', fontSize: 12, color: 'rgba(255,255,255,0.5)',
            background: 'transparent', border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: 'var(--control-radius, 6px)', cursor: 'pointer',
          }}>Esc</button>
        </div>
        {setupPicker && (
          <div style={{
            marginTop: 16, padding: 16, borderRadius: 10,
            background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.1)',
          }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 10 }}>
              <span style={{ fontSize: 13, fontWeight: 600 }}>Export setup — {orientation}</span>
              <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)' }}>
                All tiles selected = the whole arrangement. Untick to share just a subset.
              </span>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
              {activeTiles.map((tile) => {
                const on = setupPicker.has(tile.instanceId);
                return (
                  <button
                    key={tile.instanceId}
                    onClick={() => {
                      const next = new Set(setupPicker);
                      if (on) next.delete(tile.instanceId); else next.add(tile.instanceId);
                      setSetupPicker(next);
                    }}
                    style={{
                      padding: '5px 10px', fontSize: 11, borderRadius: 'var(--control-radius, 6px)', cursor: 'pointer',
                      background: on ? `${accent}22` : 'rgba(255,255,255,0.04)',
                      color: on ? accent : 'rgba(255,255,255,0.55)',
                      border: `1px solid ${on ? `${accent}66` : 'rgba(255,255,255,0.1)'}`,
                    }}
                  >{on ? '✓ ' : ''}{tileLabel(tile)}</button>
                );
              })}
              {activeTiles.length === 0 && (
                <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)' }}>This orientation has no tiles.</span>
              )}
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button
                disabled={setupPicker.size === 0}
                onClick={() => { void exportSetup(activeTiles.filter((tile) => setupPicker.has(tile.instanceId))); }}
                style={{
                  padding: '8px 14px', fontSize: 12, fontWeight: 600, borderRadius: 6,
                  background: setupPicker.size > 0 ? accent : 'rgba(255,255,255,0.06)',
                  color: setupPicker.size > 0 ? '#000' : 'rgba(255,255,255,0.4)',
                  border: 'none', cursor: setupPicker.size > 0 ? 'pointer' : 'not-allowed',
                }}
              >Export {setupPicker.size} tile{setupPicker.size === 1 ? '' : 's'}</button>
              <button onClick={() => setSetupPicker(null)} style={{
                padding: '8px 14px', fontSize: 12, color: 'rgba(255,255,255,0.6)',
                background: 'transparent', border: '1px solid rgba(255,255,255,0.12)',
                borderRadius: 'var(--control-radius, 6px)', cursor: 'pointer',
              }}>Cancel</button>
            </div>
          </div>
        )}
        {importPending && (
          <ImportProfileDialog
            accent={accent}
            parsed={importPending}
            profiles={profiles}
            onApply={applyImport}
            onCancel={() => setImportPending(null)}
          />
        )}
      </div>
    </div>
  );
}

function ProfileCard({
  profile, accent, active, canDelete, onSelect, onRename, onRecolor, onDelete, onExport,
}: {
  profile: Profile;
  accent: string;
  active: boolean;
  canDelete: boolean;
  onSelect: () => void;
  onRename: (name: string) => void;
  onRecolor: (color: string) => void;
  onDelete: () => void;
  onExport: () => void;
}) {
  const [editingName, setEditingName] = useState(false);
  const [draftName, setDraftName] = useState(profile.name);

  const commitName = () => {
    const next = draftName.trim();
    if (next && next !== profile.name) onRename(next);
    else setDraftName(profile.name);
    setEditingName(false);
  };

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
            onClick={onExport}
            title="Export profile to a JSON file (map positions are stripped)"
            style={{
              fontSize: 13, padding: '0 4px', lineHeight: 1,
              background: 'transparent', border: 'none',
              color: 'rgba(255,255,255,0.45)', cursor: 'pointer',
            }}
          >⇩</button>
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
          {profile.landscape.tiles.length} tile{profile.landscape.tiles.length === 1 ? '' : 's'}
        </div>
      </div>
    </div>
  );
}

/** Small modal offered after a VALID profile file is picked (0.7.1 §3):
 *  overwrite one existing profile (radio list by name — keeps that profile's
 *  id) or add as a new profile (fresh id, becomes active). */
function ImportProfileDialog({ accent, parsed, profiles, onApply, onCancel }: {
  accent: string;
  parsed: ParsedProfile;
  profiles: Profile[];
  onApply: (choice: { mode: 'new' } | { mode: 'overwrite'; profileId: string }) => void;
  onCancel: () => void;
}) {
  // 'new' or a profile id.
  const [choice, setChoice] = useState<string>('new');
  const radioRow: React.CSSProperties = {
    display: 'flex', gap: 8, alignItems: 'center',
    fontSize: 12, color: 'rgba(255,255,255,0.8)', cursor: 'pointer',
  };
  return (
    <div onClick={onCancel} style={{
      position: 'fixed', inset: 0, zIndex: 90,
      background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(6px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        width: 380, maxWidth: 'calc(100vw - 48px)', padding: 20, borderRadius: 12,
        background: 'var(--surface-overlay, rgba(20,22,28,0.96))',
        border: '1px solid rgba(255,255,255,0.08)',
        boxShadow: '0 24px 80px rgba(0,0,0,0.6)',
        display: 'flex', flexDirection: 'column', gap: 10,
      }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: '#fff' }}>
          Import “{parsed.name}”
        </div>
        <label style={radioRow}>
          <input type="radio" name="import-target" checked={choice === 'new'} onChange={() => setChoice('new')} />
          Add as new profile
        </label>
        {profiles.map((p) => (
          <label key={p.id} style={radioRow}>
            <input type="radio" name="import-target" checked={choice === p.id} onChange={() => setChoice(p.id)} />
            Overwrite “{p.name}”
          </label>
        ))}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 6 }}>
          <button onClick={onCancel} style={{
            padding: '8px 14px', fontSize: 12, color: 'rgba(255,255,255,0.5)',
            background: 'transparent', border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: 'var(--control-radius, 6px)', cursor: 'pointer',
          }}>Cancel</button>
          <button
            onClick={() => onApply(choice === 'new' ? { mode: 'new' } : { mode: 'overwrite', profileId: choice })}
            style={{
              padding: '8px 14px', fontSize: 12, fontWeight: 600, borderRadius: 6,
              background: accent, color: '#000', border: 'none', cursor: 'pointer',
            }}
          >Import</button>
        </div>
      </div>
    </div>
  );
}

/** New: render the profile's actual layout as a small SVG. Used by the switcher. */
function LayoutPreview({ profile }: { profile: Profile }) {
  const W = 480, H = 270;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', display: 'block', background: '#06070a' }}>
      <rect x="0" y="0" width={W} height={56 / 1440 * H} fill="rgba(255,255,255,0.04)" />
      {profile.landscape.tiles.map((inst) => {
        const r = inst.rect;
        const isViz = inst.type === 'viz';
        return (
          <rect
            key={inst.instanceId}
            x={r.x * W} y={r.y * H}
            width={r.w * W} height={r.h * H}
            fill={isViz ? `${profile.color}40` : 'rgba(255,255,255,0.03)'}
            stroke={isViz ? `${profile.color}88` : 'rgba(255,255,255,0.06)'}
            rx={3}
          />
        );
      })}
      <rect x="0" y={H - 32 / 1440 * H} width={W} height={32 / 1440 * H} fill="rgba(255,255,255,0.04)" />
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

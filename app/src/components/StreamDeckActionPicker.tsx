import React, { useEffect, useState } from 'react';
import { newId } from '../state/layout';
import {
  type ActionConfig,
  type StreamDeckButton,
  DEFAULT_ICONS,
} from '../state/actions';
import type { Profile } from '../types';

const KIND_LABELS: Record<ActionConfig['kind'], string> = {
  spotifyPlayPause: '🎵 Spotify play/pause',
  spotifyNext: '⏭ Spotify next',
  spotifyPrev: '⏮ Spotify previous',
  discordMute: '🎤 Discord mute (sets mute on)',
  discordDeafen: '🔇 Discord deafen (sets deaf on)',
  cycleViz: '◢ Cycle visualizer',
  switchProfile: '▦ Switch profile',
};

const KIND_ORDER: ActionConfig['kind'][] = [
  'spotifyPlayPause', 'spotifyNext', 'spotifyPrev',
  'discordMute', 'discordDeafen',
  'cycleViz', 'switchProfile',
];

const HEX_RE = /^#[0-9a-fA-F]{6}$/;
const ICON_MAX = 4;
const LABEL_MAX = 24;

export interface StreamDeckActionPickerProps {
  initial?: StreamDeckButton;       // undefined = creating new; defined = editing
  profiles: Profile[];
  accent: string;
  onSave: (button: StreamDeckButton) => void;
  onDelete?: () => void;            // present only when editing
  onClose: () => void;
}

export function StreamDeckActionPicker({
  initial, profiles, accent, onSave, onDelete, onClose,
}: StreamDeckActionPickerProps) {
  // Form state
  const initialKind: ActionConfig['kind'] = initial?.action.kind ?? 'spotifyPlayPause';
  const [kind, setKind] = useState<ActionConfig['kind']>(initialKind);
  const [profileId, setProfileId] = useState<string>(
    initial?.action.kind === 'switchProfile' ? initial.action.profileId : (profiles[0]?.id ?? ''),
  );
  const [icon, setIcon] = useState<string>(initial?.icon ?? DEFAULT_ICONS[initialKind]);
  const [label, setLabel] = useState<string>(initial?.label ?? '');
  const [color, setColor] = useState<string>(initial?.color ?? '');
  const [iconAutoFilled, setIconAutoFilled] = useState<boolean>(true);

  // Confirm-delete two-step state
  const [confirmDelete, setConfirmDelete] = useState<boolean>(false);
  useEffect(() => {
    if (!confirmDelete) return;
    const t = setTimeout(() => setConfirmDelete(false), 3000);
    return () => clearTimeout(t);
  }, [confirmDelete]);

  // Auto-fill icon on kind change (only if user hasn't manually edited the icon).
  useEffect(() => {
    if (iconAutoFilled) {
      setIcon(DEFAULT_ICONS[kind]);
    }
  }, [kind, iconAutoFilled]);

  // Esc closes
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  // Validate before allowing save
  const iconValid = icon.length >= 1 && icon.length <= ICON_MAX;
  const labelValid = label.length <= LABEL_MAX;
  const colorValid = !color || HEX_RE.test(color);
  const profileValid = kind !== 'switchProfile' || (profileId && profiles.some((p) => p.id === profileId));
  const canSave = iconValid && labelValid && colorValid && profileValid;

  const handleSave = () => {
    if (!canSave) return;
    let action: ActionConfig;
    if (kind === 'switchProfile') {
      action = { kind: 'switchProfile', profileId };
    } else {
      action = { kind } as ActionConfig;
    }
    const button: StreamDeckButton = {
      buttonId: initial?.buttonId ?? newId(),
      icon,
      action,
    };
    if (label) button.label = label;
    if (color) button.color = color;
    onSave(button);
    onClose();
  };

  const handleDelete = () => {
    if (!onDelete) return;
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    onDelete();
    onClose();
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: 'absolute', inset: 0, zIndex: 75,
        background: 'rgba(8,9,12,0.55)', backdropFilter: 'blur(2px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(440px, 90%)', maxHeight: '85%',
          background: 'rgba(20,22,28,0.98)', backdropFilter: 'blur(20px)',
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: 12, boxShadow: '0 24px 60px rgba(0,0,0,0.5)',
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div style={{
          padding: '14px 18px', borderBottom: '1px solid rgba(255,255,255,0.06)',
          display: 'flex', alignItems: 'center', gap: 10,
        }}>
          <div style={{ width: 8, height: 8, background: accent, borderRadius: 2 }} />
          <span style={{ fontSize: 13, fontWeight: 600, color: '#fff' }}>
            {initial ? 'Edit button' : 'Add button'}
          </span>
        </div>

        {/* Form */}
        <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12, overflow: 'auto' }}>
          {/* Action kind */}
          <Field label="Action">
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value as ActionConfig['kind'])}
              style={inputStyle}
            >
              {KIND_ORDER.map((k) => (
                <option key={k} value={k}>{KIND_LABELS[k]}</option>
              ))}
            </select>
          </Field>

          {/* Switch-profile picker */}
          {kind === 'switchProfile' && (
            <Field label="Profile">
              <select value={profileId} onChange={(e) => setProfileId(e.target.value)} style={inputStyle}>
                {profiles.map((p) => (
                  <option key={p.id} value={p.id}>● {p.name}</option>
                ))}
              </select>
            </Field>
          )}

          {/* Discord caveat */}
          {(kind === 'discordMute' || kind === 'discordDeafen') && (
            <div style={{
              fontSize: 11, color: 'rgba(255,255,255,0.55)',
              padding: '8px 10px', borderRadius: 5,
              background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)',
            }}>
              ℹ Sets the value to ON. Toggle (on/off) requires backend changes; coming in a future release.
            </div>
          )}

          {/* Icon */}
          <Field label="Icon">
            <input
              type="text"
              value={icon}
              maxLength={ICON_MAX}
              onChange={(e) => { setIcon(e.target.value); setIconAutoFilled(false); }}
              style={inputStyle}
            />
            {!iconValid && <FieldError>Icon must be 1–{ICON_MAX} characters.</FieldError>}
          </Field>

          {/* Label */}
          <Field label="Label">
            <input
              type="text"
              value={label}
              maxLength={LABEL_MAX}
              placeholder="(optional)"
              onChange={(e) => setLabel(e.target.value)}
              style={inputStyle}
            />
          </Field>

          {/* Color */}
          <Field label="Color">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input
                type="text"
                value={color}
                placeholder="#auto"
                onChange={(e) => setColor(e.target.value)}
                style={{ ...inputStyle, flex: 1 }}
              />
              <div style={{
                width: 24, height: 24, borderRadius: 4,
                background: color && HEX_RE.test(color) ? color : 'transparent',
                border: '1px solid rgba(255,255,255,0.12)',
              }} />
            </div>
            {!colorValid && <FieldError>Color must be #RRGGBB or empty.</FieldError>}
          </Field>
        </div>

        {/* Buttons */}
        <div style={{
          padding: 12, borderTop: '1px solid rgba(255,255,255,0.06)',
          display: 'flex', gap: 8, justifyContent: 'flex-end',
        }}>
          {onDelete && (
            <button
              onClick={handleDelete}
              style={{
                padding: '8px 14px', fontSize: 12, fontWeight: 600, borderRadius: 6,
                background: confirmDelete ? '#dc2626' : 'rgba(220,38,38,0.15)',
                color: confirmDelete ? '#fff' : '#fca5a5',
                border: confirmDelete ? '1px solid #b91c1c' : '1px solid rgba(220,38,38,0.3)',
                cursor: 'pointer', marginRight: 'auto',
              }}
            >
              {confirmDelete ? 'Confirm delete?' : 'Delete'}
            </button>
          )}
          <button onClick={onClose} style={{
            padding: '8px 14px', fontSize: 12, fontWeight: 500, borderRadius: 6,
            background: 'transparent', color: 'rgba(255,255,255,0.7)',
            border: '1px solid rgba(255,255,255,0.12)', cursor: 'pointer',
          }}>Cancel</button>
          <button
            onClick={handleSave}
            disabled={!canSave}
            style={{
              padding: '8px 14px', fontSize: 12, fontWeight: 600, borderRadius: 6,
              background: canSave ? accent : 'rgba(255,255,255,0.08)',
              color: canSave ? '#000' : 'rgba(255,255,255,0.4)',
              border: 'none', cursor: canSave ? 'pointer' : 'not-allowed',
            }}
          >Save</button>
        </div>
      </div>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%', fontSize: 12, padding: '8px 10px', borderRadius: 5,
  background: 'rgba(255,255,255,0.04)', color: '#fff',
  border: '1px solid rgba(255,255,255,0.1)',
  fontFamily: '"JetBrains Mono", ui-monospace, monospace',
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>{label}</span>
      {children}
    </label>
  );
}

function FieldError({ children }: { children: React.ReactNode }) {
  return (
    <span style={{ fontSize: 10, color: '#fca5a5', marginTop: 2 }}>{children}</span>
  );
}

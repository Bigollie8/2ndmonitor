// Dropdown-multiselect for the visualizer's audio source — the ONE control
// for it (Settings → Visualizer mounts it; the mixer-row headphone buttons
// drive the same state through the same toggleAppInSource). "All system
// audio" is the exclusive top option; below it, one checkbox row per running
// audio session, hard-capped at MAX_AUDIO_APPS concurrent apps because each
// checked app is a real WASAPI process-loopback capture client.
import { useEffect, useRef, useState } from 'react';
import type { AudioSource } from '../state/audioSource';
import { MAX_AUDIO_APPS, describeAudioSource, toggleAppInSource } from '../state/audioSource';
import type { SourceOption } from '../state/useAudioSource';

const MONO = '"JetBrains Mono", ui-monospace, monospace';

export function AudioSourcePicker({ value, options, onChange, accent }: {
  value: AudioSource;
  /** Apps currently holding an audio session (audio_sources_list). */
  options: SourceOption[];
  onChange: (s: AudioSource) => void;
  accent: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  // Close on any pointer-down outside the control (button + panel), or on Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const selected = value.mode === 'apps' ? value.exes : [];
  const liveExes = options.map((o) => o.exe);
  // A selected app that just quit is missing from `options` (the list only
  // holds live sessions) — union it in so its row still renders, checked,
  // and can be unchecked. Same trick the 0.6.4 <select> used.
  const rows: SourceOption[] = [...options];
  const quitApps = new Set<string>();
  for (const exe of selected) {
    if (!rows.some((o) => o.exe === exe)) {
      rows.push({ exe, name: exe, icon: null });
      quitApps.add(exe);
    }
  }
  const atCap = selected.length >= MAX_AUDIO_APPS;
  const nameOf = (exe: string) => rows.find((o) => o.exe === exe)?.name ?? exe;
  const label = describeAudioSource(value, nameOf, liveExes);

  return (
    <div ref={rootRef} style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="listbox"
        title="What the visualizer listens to"
        style={{
          appearance: 'none',
          fontSize: 11.5, padding: '5px 24px 5px 9px',
          background: 'rgba(0,0,0,0.3)',
          backgroundImage: 'url("data:image/svg+xml;utf8,<svg xmlns=\'http://www.w3.org/2000/svg\' width=\'10\' height=\'6\' viewBox=\'0 0 10 6\'><path fill=\'rgba(255,255,255,.5)\' d=\'M0 0h10L5 6z\'/></svg>")',
          backgroundRepeat: 'no-repeat', backgroundPosition: 'right 8px center',
          border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6,
          color: '#fff', outline: 'none', cursor: 'pointer',
          maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          textAlign: 'left',
        }}
      >
        {label}
      </button>
      {open && (
        <div style={{
          position: 'absolute', right: 0, top: 'calc(100% + 4px)', zIndex: 40,
          minWidth: 220, maxHeight: 260, overflowY: 'auto',
          background: 'var(--surface-overlay, #14161c)', border: '1px solid rgba(255,255,255,0.1)',
          borderRadius: 8, padding: 4, boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
        }}>
          <PickerRow
            checked={value.mode === 'mix'}
            disabled={false}
            accent={accent}
            label="All system audio"
            icon={null}
            exclusive
            onClick={() => { onChange({ mode: 'mix' }); setOpen(false); }}
          />
          <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', margin: '4px 2px' }} />
          {rows.length === 0 && (
            <div style={{ padding: '8px 10px', fontSize: 10.5, color: 'rgba(255,255,255,0.4)' }}>
              No apps are playing audio
            </div>
          )}
          {rows.map((o) => {
            const checked = selected.includes(o.exe);
            const isQuit = quitApps.has(o.exe);
            const displayLabel = isQuit ? `${o.name} (not running)` : o.name;
            return (
              <PickerRow
                key={o.exe}
                checked={checked}
                disabled={!checked && atCap}
                accent={accent}
                label={displayLabel}
                icon={o.icon}
                exclusive={false}
                onClick={() => onChange(toggleAppInSource(value, o.exe))}
              />
            );
          })}
          {atCap && (
            <div style={{ padding: '6px 10px 4px', fontSize: 10, color: 'rgba(255,255,255,0.4)', fontFamily: MONO }}>
              up to {MAX_AUDIO_APPS} apps
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function PickerRow({ checked, disabled, accent, label, icon, exclusive, onClick }: {
  checked: boolean;
  disabled: boolean;
  accent: string;
  label: string;
  icon: string | null;
  /** The "All system audio" row: radio-dot styling instead of a checkbox. */
  exclusive: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={checked}
      title={disabled ? `Up to ${MAX_AUDIO_APPS} apps — remove one first` : undefined}
      style={{
        display: 'flex', alignItems: 'center', gap: 8, width: '100%',
        padding: '6px 8px', borderRadius: 6, border: 'none',
        background: checked ? `${accent}18` : 'transparent',
        color: disabled ? 'rgba(255,255,255,0.35)' : 'rgba(255,255,255,0.9)',
        fontSize: 11.5, textAlign: 'left',
        cursor: disabled ? 'not-allowed' : 'pointer',
      }}
    >
      <span aria-hidden style={{
        width: 14, height: 14, flexShrink: 0,
        borderRadius: exclusive ? 7 : 3,
        border: `1px solid ${checked ? accent : 'rgba(255,255,255,0.25)'}`,
        background: checked ? accent : 'transparent',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 10, color: '#000', fontWeight: 700, lineHeight: 1,
      }}>
        {checked ? '✓' : ''}
      </span>
      {icon && (
        <img
          src={icon} alt="" width={16} height={16}
          style={{ width: 16, height: 16, flexShrink: 0, borderRadius: 3, objectFit: 'contain' }}
        />
      )}
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
    </button>
  );
}

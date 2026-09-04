import { createMeterGate } from '../state/meterPace';
import { isAppHidden } from '../state/framePace';
import { getVizMaxFps } from './viz';
import { useEffect, useRef, useState, type MutableRefObject } from 'react';
import { HFTile } from './tiles';
import type { Density } from '../types';
import {
  type MixerOutputDevice,
  type SpectrumState,
  appActions,
  isTauri,
  mixerControls,
  useMixerState,
} from '../state/tauri';
import type { AudioSource } from '../state/audioSource';
import { MAX_AUDIO_APPS, toggleAppInSource } from '../state/audioSource';
import { Slider } from './Slider';

export function AudioMixerTile({
  density, accent, accent2, spectrumRef, audioSource, onSetAudioSource,
  eqEnabled, eqBands, onSetEq,
}: {
  density: Density;
  accent: string;
  accent2: string;
  spectrumRef?: MutableRefObject<SpectrumState>;
  /** What the visualizer currently listens to — drives the per-row
   *  highlight so the shortcut button reflects reality, not just intent. */
  audioSource: AudioSource;
  onSetAudioSource: (source: AudioSource) => void;
  /** System-wide EQ (0.9.2, via Equalizer APO). Persisted in tweaks; App
   *  owns pushing changes to Rust so they apply live and on boot. */
  eqEnabled: boolean;
  eqBands: number[];
  onSetEq: (enabled: boolean, bands: number[]) => void;
}) {
  const state = useMixerState();
  const master = state?.master ?? null;
  const sessions = state?.sessions ?? [];
  const devices = state?.devices ?? [];

  // Tell the Rust worker someone is actually looking: the 1Hz COM
  // device/session enumeration only runs while a mixer tile is mounted.
  useEffect(() => {
    if (!isTauri) return;
    const setActive = (active: boolean) =>
      import('@tauri-apps/api/core')
        .then(({ invoke }) => invoke('set_mixer_active', { active }))
        .catch(() => {});
    void setActive(true);
    return () => { void setActive(false); };
  }, []);

  return (
    <HFTile
      title="Audio mixer"
      density={density}
      headRight={<DevicePicker devices={devices} accent={accent} />}
      style={{ height: '100%' }}
    >
      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <MasterRow master={master} accent={accent} accent2={accent2} spectrumRef={spectrumRef} />
        <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }} />
        <SessionList
          sessions={sessions}
          accent={accent}
          accent2={accent2}
          audioSource={audioSource}
          onSetAudioSource={onSetAudioSource}
        />
        <EqSection accent={accent} accent2={accent2} enabled={eqEnabled} bands={eqBands} onSet={onSetEq} />
      </div>
    </HFTile>
  );
}

// ── System-wide EQ (0.9.2) ───────────────────────────────────────────────────
// Drives Equalizer APO: Rust writes our band gains into its config chain and
// E-APO applies them to the actual output device within ~100ms. Windows-only;
// hidden when unsupported, explained when E-APO isn't installed.

const EQ_HZ_LABELS = ['31', '63', '125', '250', '500', '1k', '2k', '4k', '8k', '16k'];
const EQ_GAIN_RANGE = 12; // ±dB, mirrors Rust's clamp_gain

function EqSection({ accent, accent2, enabled, bands, onSet }: {
  accent: string;
  accent2: string;
  enabled: boolean;
  bands: number[];
  onSet: (enabled: boolean, bands: number[]) => void;
}) {
  const [status, setStatus] = useState<{ supported: boolean; installed: boolean } | null>(null);
  const [open, setOpen] = useState(enabled);
  useEffect(() => {
    if (!isTauri) { setStatus({ supported: true, installed: true }); return; } // browser dev: show the UI
    let cancelled = false;
    void import('@tauri-apps/api/core')
      .then(({ invoke }) => invoke<{ supported: boolean; installed: boolean }>('eq_status'))
      .then((s) => { if (!cancelled) setStatus(s); })
      .catch(() => { if (!cancelled) setStatus({ supported: false, installed: false }); });
    return () => { cancelled = true; };
  }, []);

  if (!status || !status.supported) return null; // macOS / unknown: no section

  const flat = bands.every((b) => b === 0);
  return (
    <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', flexShrink: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px' }}>
        <button
          onClick={() => setOpen((v) => !v)}
          style={{
            background: 'transparent', border: 'none', cursor: 'pointer', padding: 0,
            color: 'rgba(255,255,255,0.55)', fontSize: 10, fontWeight: 600,
            letterSpacing: '.08em', textTransform: 'uppercase',
            display: 'flex', alignItems: 'center', gap: 6,
          }}
        >
          <span style={{ fontSize: 9 }}>{open ? '▾' : '▸'}</span>
          Equalizer · system-wide
        </button>
        <div style={{ flex: 1 }} />
        {status.installed && open && !flat && (
          <button
            onClick={() => onSet(enabled, new Array(10).fill(0))}
            title="Reset all bands to 0 dB"
            style={{
              background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
              color: 'rgba(255,255,255,0.7)', fontSize: 10, padding: '2px 8px',
              borderRadius: 3, cursor: 'pointer',
            }}
          >Flat</button>
        )}
        {status.installed && (
          <button
            onClick={() => onSet(!enabled, bands)}
            title={enabled ? 'Bypass the EQ (keeps your bands)' : 'Enable the EQ'}
            style={{
              background: enabled ? accent : 'rgba(255,255,255,0.06)',
              border: '1px solid ' + (enabled ? accent : 'rgba(255,255,255,0.1)'),
              color: enabled ? '#000' : 'rgba(255,255,255,0.7)',
              fontSize: 10, fontWeight: 700, padding: '2px 10px',
              borderRadius: 3, cursor: 'pointer',
            }}
          >{enabled ? 'ON' : 'OFF'}</button>
        )}
      </div>
      {open && !status.installed && (
        <div style={{ padding: '2px 12px 10px', fontSize: 11, lineHeight: 1.5, color: 'rgba(255,255,255,0.55)' }}>
          Shapes what your speakers actually play — needs the free{' '}
          <button
            onClick={() => void appActions.openUrl('https://sourceforge.net/projects/equalizerapo/')}
            style={{ background: 'transparent', border: 'none', padding: 0, cursor: 'pointer', color: accent, fontSize: 11, textDecoration: 'underline' }}
          >Equalizer APO</button>
          {' '}installed (run its Configurator once for your output device, then restart this app).
        </div>
      )}
      {open && status.installed && (
        <div style={{ display: 'flex', gap: 4, padding: '2px 12px 8px', opacity: enabled ? 1 : 0.45 }}>
          {EQ_HZ_LABELS.map((label, i) => (
            <EqBandColumn
              key={label}
              label={label}
              value={bands[i] ?? 0}
              accent={accent}
              accent2={accent2}
              onChange={(g) => {
                const next = bands.slice(0, 10);
                while (next.length < 10) next.push(0);
                next[i] = g;
                onSet(enabled, next);
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/** One vertical band: drag up/down for ±12 dB, double-click to zero. Same
 *  pointer-capture pattern as Slider.tsx, turned 90°. */
function EqBandColumn({ label, value, accent, accent2, onChange }: {
  label: string;
  value: number;
  accent: string;
  accent2: string;
  onChange: (gainDb: number) => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const dragging = useRef(false);
  const sample = (clientY: number): number => {
    const el = ref.current;
    if (!el) return value;
    const rect = el.getBoundingClientRect();
    if (rect.height <= 0) return value;
    const frac = 1 - Math.max(0, Math.min(1, (clientY - rect.top) / rect.height));
    return Math.round((frac * 2 - 1) * EQ_GAIN_RANGE * 2) / 2; // 0.5 dB steps
  };
  const pctFromCenter = (value / EQ_GAIN_RANGE) * 50; // -50..50
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'stretch', gap: 2, minWidth: 0 }}>
      <div
        ref={ref}
        title={`${label} Hz · ${value > 0 ? '+' : ''}${value.toFixed(1)} dB`}
        onPointerDown={(e) => {
          e.preventDefault();
          e.currentTarget.setPointerCapture(e.pointerId);
          dragging.current = true;
          onChange(sample(e.clientY));
        }}
        onPointerMove={(e) => { if (dragging.current) onChange(sample(e.clientY)); }}
        onPointerUp={(e) => {
          if (!dragging.current) return;
          e.currentTarget.releasePointerCapture(e.pointerId);
          dragging.current = false;
        }}
        onDoubleClick={() => onChange(0)}
        style={{
          position: 'relative', height: 56, cursor: 'ns-resize',
          background: 'rgba(255,255,255,0.04)', borderRadius: 3,
          touchAction: 'none', overflow: 'hidden',
        }}
      >
        {/* 0 dB center line */}
        <div style={{ position: 'absolute', left: 0, right: 0, top: '50%', height: 1, background: 'rgba(255,255,255,0.15)' }} />
        {/* fill from center toward the gain */}
        <div style={{
          position: 'absolute', left: 2, right: 2,
          top: value >= 0 ? `${50 - pctFromCenter}%` : '50%',
          bottom: value >= 0 ? '50%' : `${50 + pctFromCenter}%`,
          background: `linear-gradient(180deg, ${accent}, ${accent2})`,
          borderRadius: 2, minHeight: value === 0 ? 0 : 2,
        }} />
      </div>
      <div style={{ fontSize: 8.5, textAlign: 'center', color: 'rgba(255,255,255,0.4)', fontFamily: '"JetBrains Mono", ui-monospace, monospace' }}>{label}</div>
    </div>
  );
}

function DevicePicker({ devices, accent }: { devices: MixerOutputDevice[]; accent: string }) {
  const current = devices.find((d) => d.is_default);
  if (devices.length === 0) {
    return <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)' }}>—</span>;
  }
  return (
    <select
      value={current?.id ?? ''}
      onChange={(e) => {
        const id = e.target.value;
        if (id && id !== current?.id) {
          mixerControls.setDefaultOutput(id);
        }
      }}
      title="Default output device"
      style={{
        background: 'rgba(0,0,0,0.3)',
        border: '1px solid rgba(255,255,255,0.08)',
        color: 'rgba(255,255,255,0.8)',
        fontSize: 10,
        fontFamily: '"JetBrains Mono", ui-monospace, monospace',
        borderRadius: 4,
        padding: '2px 6px',
        maxWidth: 180,
        outline: 'none',
        cursor: 'pointer',
        accentColor: accent,
      }}
    >
      {devices.map((d) => (
        <option key={d.id} value={d.id}>{d.name}</option>
      ))}
    </select>
  );
}

function MasterRow({
  master, accent, accent2, spectrumRef,
}: {
  master: { volume: number; mute: boolean; device_name: string } | null;
  accent: string;
  accent2: string;
  spectrumRef?: MutableRefObject<SpectrumState>;
}) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  // Subtle reactive glow: pulse the master track's box-shadow with the live
  // FFT level so the tile feels alive when audio is playing. No-op when there's
  // no spectrumRef (mock mode) or no live audio.
  useEffect(() => {
    if (!spectrumRef) return;
    let raf = 0;
    // Once the idle glow is painted there's nothing to animate until audio
    // arrives — skip the style write instead of rewriting it at 60fps.
    let settled = false;
    const shouldPaint = createMeterGate();
    const tick = () => {
      raf = requestAnimationFrame(tick);
      if (isAppHidden()) return;
      const sample = spectrumRef.current;
      if (!shouldPaint(performance.now(), sample.live, sample.frameId, getVizMaxFps())) return;
      const el = trackRef.current;
      if (!el) return;
      const live = spectrumRef.current.live;
      if (!live) {
        if (!settled) {
          el.style.boxShadow = `0 0 10px ${accent}14`;
          settled = true;
        }
        return;
      }
      settled = false;
      const lvl = spectrumRef.current.level;
      const intensity = Math.min(1, lvl * 1.2);
      el.style.boxShadow = `0 0 ${10 + intensity * 16}px ${accent}${Math.round(20 + intensity * 60).toString(16).padStart(2, '0')}`;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [spectrumRef, accent]);

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10,
      padding: '12px 14px', flexShrink: 0,
    }}>
      <MuteButton muted={master?.mute ?? false} disabled={!master} accent={accent}
                  onToggle={() => master && mixerControls.setMasterMute(!master.mute)} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 10, color: 'rgba(255,255,255,0.55)', letterSpacing: '.06em',
          textTransform: 'uppercase', fontWeight: 600, marginBottom: 4,
          display: 'flex', justifyContent: 'space-between',
        }}>
          <span>Master</span>
          <span style={{ fontFamily: '"JetBrains Mono", ui-monospace, monospace', color: 'rgba(255,255,255,0.85)' }}>
            {master ? `${Math.round((master.mute ? 0 : master.volume) * 100)}%` : '—'}
          </span>
        </div>
        <Slider
          trackRef={trackRef}
          value={master?.volume ?? 0}
          disabled={!master}
          dimmed={master?.mute ?? false}
          accent={accent}
          accent2={accent2}
          onCommit={(v) => mixerControls.setMasterVolume(v)}
        />
      </div>
    </div>
  );
}

function SessionList({
  sessions, accent, accent2, audioSource, onSetAudioSource,
}: {
  sessions: { pid: number; name: string; volume: number; mute: boolean; is_system_sounds: boolean; icon: string | null; exe: string | null }[];
  accent: string;
  accent2: string;
  audioSource: AudioSource;
  onSetAudioSource: (source: AudioSource) => void;
}) {
  if (sessions.length === 0) {
    return (
      <div style={{
        flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: 'rgba(255,255,255,0.4)', fontSize: 11, padding: 16, textAlign: 'center',
      }}>
        No apps playing audio
      </div>
    );
  }
  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '6px 6px 10px', minHeight: 0 }}>
      {sessions.map((s) => (
        <SessionRow
          key={s.pid + ':' + s.name}
          session={s}
          accent={accent}
          accent2={accent2}
          audioSource={audioSource}
          onSetAudioSource={onSetAudioSource}
        />
      ))}
    </div>
  );
}

function SessionRow({
  session, accent, accent2, audioSource, onSetAudioSource,
}: {
  session: { pid: number; name: string; volume: number; mute: boolean; is_system_sounds: boolean; icon: string | null; exe: string | null };
  accent: string;
  accent2: string;
  audioSource: AudioSource;
  onSetAudioSource: (source: AudioSource) => void;
}) {
  const exe = session.exe;
  const isIncluded = exe != null && audioSource.mode === 'apps' && audioSource.exes.includes(exe);
  const atCap = !isIncluded && audioSource.mode === 'apps' && audioSource.exes.length >= MAX_AUDIO_APPS;
  const displayName = sessionDisplayName(session);
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8,
      padding: '6px 8px', borderRadius: 6,
    }}>
      <SessionAvatar name={displayName} icon={session.icon} isSystem={session.is_system_sounds} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          marginBottom: 2,
        }}>
          <span title={displayName} style={{
            fontSize: 11.5,
            color: session.mute ? 'rgba(255,255,255,0.45)' : 'rgba(255,255,255,0.9)',
            fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            paddingRight: 8,
          }}>
            {displayName}
          </span>
          <span style={{
            fontSize: 10, color: 'rgba(255,255,255,0.5)',
            fontFamily: '"JetBrains Mono", ui-monospace, monospace', flexShrink: 0,
          }}>
            {Math.round((session.mute ? 0 : session.volume) * 100)}%
          </span>
        </div>
        <Slider
          value={session.volume}
          disabled={false}
          dimmed={session.mute}
          accent={accent}
          accent2={accent2}
          onCommit={(v) => mixerControls.setSessionVolume(session.pid, v)}
        />
      </div>
      {exe != null && (
        <SourceButton
          active={isIncluded}
          atCap={atCap}
          accent={accent}
          onToggle={() => onSetAudioSource(toggleAppInSource(audioSource, exe))}
        />
      )}
      <MuteButton
        muted={session.mute}
        disabled={false}
        accent={accent}
        onToggle={() => mixerControls.setSessionMute(session.pid, !session.mute)}
      />
    </div>
  );
}

/** Rust already resolves `name` to the friendliest string it can (a real
 *  display name, then the exe's version info, then a raw fallback — see
 *  mixer.rs). If that's ever empty, fall back to the raw `exe` field as-is —
 *  NOT with a Windows-style `.exe` suffix strip, since on macOS `exe` holds a
 *  bundle identifier (e.g. "com.spotify.client"), not an executable filename,
 *  and stripping ".exe" from that would be a no-op that only looks intentional. */
function sessionDisplayName(session: { name: string; exe: string | null }): string {
  return session.name || session.exe || 'Unknown';
}

function SessionAvatar({ name, icon, isSystem }: { name: string; icon: string | null; isSystem: boolean }) {
  if (isSystem) {
    return (
      <div style={{
        width: 28, height: 28, borderRadius: 6, flexShrink: 0,
        background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.08)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 14, color: 'rgba(255,255,255,0.7)',
      }}>♪</div>
    );
  }
  if (icon) {
    return (
      <img
        src={icon}
        alt=""
        width={28}
        height={28}
        style={{
          width: 28, height: 28, flexShrink: 0,
          borderRadius: 6, objectFit: 'contain',
          imageRendering: 'auto',
          background: 'rgba(255,255,255,0.04)',
          padding: 1,
        }}
      />
    );
  }
  // Fallback when icon extraction failed (32-bit process inaccessible from
  // 64-bit, no shell association, etc.) — colored letter avatar. `name` here
  // is already the resolved display name (see sessionDisplayName), so no
  // further stripping (e.g. a Windows-only ".exe" suffix) belongs here.
  const color = hashColor(name);
  const letter = (name[0] ?? '?').toUpperCase();
  return (
    <div style={{
      width: 28, height: 28, borderRadius: 6, flexShrink: 0,
      background: `linear-gradient(135deg, ${color}aa, ${color}55)`,
      border: `1px solid ${color}66`,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: 12, fontWeight: 700, color: '#fff',
      textShadow: '0 1px 2px rgba(0,0,0,0.4)',
    }}>{letter}</div>
  );
}

function hashColor(s: string): string {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0;
  const palette = ['#fb7185', '#60a5fa', '#a78bfa', '#facc15', '#22c55e', '#06b6d4', '#f472b6', '#f97316'];
  return palette[h % palette.length]!;
}

function SourceButton({
  active, atCap, accent, onToggle,
}: { active: boolean; atCap: boolean; accent: string; onToggle: () => void }) {
  // Membership toggle in the visualizer's include set: from mix this starts
  // the set as [this app]; at the 4-app cap the add is refused, so disable
  // the button and say why rather than offering a silent no-op.
  const title = active
    ? 'Remove this app from the visualizer sources'
    : atCap
      ? `Visualizer already has ${MAX_AUDIO_APPS} apps — remove one first`
      : 'Add this app to the visualizer sources';
  return (
    <button
      onClick={onToggle}
      disabled={atCap}
      title={title}
      aria-label={title}
      style={{
        width: 26, height: 26, padding: 0, flexShrink: 0,
        background: active ? `${accent}22` : 'rgba(255,255,255,0.05)',
        border: `1px solid ${active ? `${accent}66` : 'rgba(255,255,255,0.08)'}`,
        color: active ? accent : 'rgba(255,255,255,0.7)',
        borderRadius: 6,
        cursor: atCap ? 'not-allowed' : 'pointer',
        opacity: atCap ? 0.4 : 1,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 13,
      }}
    >🎧</button>
  );
}

function MuteButton({
  muted, disabled, accent, onToggle,
}: { muted: boolean; disabled: boolean; accent: string; onToggle: () => void }) {
  return (
    <button
      onClick={onToggle}
      disabled={disabled}
      title={muted ? 'Unmute' : 'Mute'}
      aria-label={muted ? 'Unmute' : 'Mute'}
      style={{
        width: 26, height: 26, padding: 0, flexShrink: 0,
        background: muted ? `${accent}22` : 'rgba(255,255,255,0.05)',
        border: `1px solid ${muted ? `${accent}66` : 'rgba(255,255,255,0.08)'}`,
        color: muted ? accent : 'rgba(255,255,255,0.7)',
        borderRadius: 6,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.4 : 1,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 13,
      }}
    >{muted ? '🔇' : '🔊'}</button>
  );
}

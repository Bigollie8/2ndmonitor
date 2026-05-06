import { useEffect, useRef, type MutableRefObject } from 'react';
import { HFTile } from './tiles';
import type { Density } from '../types';
import {
  type MixerOutputDevice,
  type SpectrumState,
  mixerControls,
  useMixerState,
} from '../state/tauri';
import { Slider } from './Slider';

export function AudioMixerTile({
  density, accent, accent2, spectrumRef,
}: {
  density: Density;
  accent: string;
  accent2: string;
  spectrumRef?: MutableRefObject<SpectrumState>;
}) {
  const state = useMixerState();
  const master = state?.master ?? null;
  const sessions = state?.sessions ?? [];
  const devices = state?.devices ?? [];

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
        <SessionList sessions={sessions} accent={accent} accent2={accent2} />
      </div>
    </HFTile>
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
    const tick = () => {
      const el = trackRef.current;
      if (el) {
        const live = spectrumRef.current.live;
        const lvl = live ? spectrumRef.current.level : 0;
        const intensity = Math.min(1, lvl * 1.2);
        el.style.boxShadow = `0 0 ${10 + intensity * 16}px ${accent}${Math.round(20 + intensity * 60).toString(16).padStart(2, '0')}`;
      }
      raf = requestAnimationFrame(tick);
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
  sessions, accent, accent2,
}: {
  sessions: { pid: number; name: string; volume: number; mute: boolean; is_system_sounds: boolean; icon: string | null }[];
  accent: string;
  accent2: string;
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
        <SessionRow key={s.pid + ':' + s.name} session={s} accent={accent} accent2={accent2} />
      ))}
    </div>
  );
}

function SessionRow({
  session, accent, accent2,
}: {
  session: { pid: number; name: string; volume: number; mute: boolean; is_system_sounds: boolean; icon: string | null };
  accent: string;
  accent2: string;
}) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8,
      padding: '6px 8px', borderRadius: 6,
    }}>
      <SessionAvatar name={session.name} icon={session.icon} isSystem={session.is_system_sounds} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          marginBottom: 2,
        }}>
          <span title={session.name} style={{
            fontSize: 11.5,
            color: session.mute ? 'rgba(255,255,255,0.45)' : 'rgba(255,255,255,0.9)',
            fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            paddingRight: 8,
          }}>
            {session.name}
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
      <MuteButton
        muted={session.mute}
        disabled={false}
        accent={accent}
        onToggle={() => mixerControls.setSessionMute(session.pid, !session.mute)}
      />
    </div>
  );
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
  // 64-bit, no shell association, etc.) — colored letter avatar.
  const color = hashColor(name);
  const letter = (name.replace(/\.exe$/i, '')[0] ?? '?').toUpperCase();
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

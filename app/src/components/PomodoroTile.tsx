import React, { useEffect, useRef, useState } from 'react';
import { HFTile } from './tiles';
import {
  type PomodoroPhase,
  type PomodoroSettings,
  type PomodoroState,
  DEFAULT_POMODORO_SETTINGS,
  nextPhase,
  phaseDurationMs,
  tickRemainingMs,
  todayDateString,
} from '../state/pomodoro';
import type { Density } from '../types';

const PHASE_COLORS: Record<PomodoroPhase, string> = {
  focus: '#fb7185',
  shortBreak: '#22d3ee',
  longBreak: '#a78bfa',
};

const PHASE_LABELS: Record<PomodoroPhase, string> = {
  focus: 'Focus',
  shortBreak: 'Short break',
  longBreak: 'Long break',
};

export interface PomodoroTileProps {
  density: Density;
  accent: string;
  editing: boolean;
  state: PomodoroState;
  setState: (next: PomodoroState) => void;
  settings: PomodoroSettings;
  setSettings: (next: PomodoroSettings) => void;
}

export function PomodoroTile({
  density, accent, editing, state, setState, settings, setSettings,
}: PomodoroTileProps) {
  const [, setTick] = useState(0);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const [showSettings, setShowSettings] = useState(false);

  // 1Hz re-render tick when running. Real time math comes from Date.now().
  useEffect(() => {
    if (state.status !== 'running') return;
    const id = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [state.status]);

  const now = Date.now();
  const remainingMs = tickRemainingMs(state, settings, now);

  // Phase-end detection
  useEffect(() => {
    if (state.status !== 'running' || remainingMs > 0) return;
    const today = todayDateString(now);
    const wasFocus = state.phase === 'focus';
    const newCount = state.todayDate === today
      ? (wasFocus ? state.todayCount + 1 : state.todayCount)
      : (wasFocus ? 1 : 0);
    const np = nextPhase(state, settings);
    setState({
      ...state,
      phase: np.phase,
      cycleIndex: np.cycleIndex,
      status: 'running',
      startedAt: now,
      pausedRemainingMs: 0,
      todayCount: newCount,
      todayDate: today,
    });
    if (settings.soundEnabled) playBeep(audioCtxRef);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remainingMs, state.status]);

  // Reset todayCount when date changes (idle/paused only — running case handled above)
  useEffect(() => {
    const today = todayDateString(now);
    if (state.todayDate && state.todayDate !== today && state.status !== 'running') {
      setState({ ...state, todayCount: 0, todayDate: today });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.todayDate]);

  const handleStartPause = () => {
    if (state.status === 'running') {
      setState({
        ...state,
        status: 'paused',
        pausedRemainingMs: remainingMs,
        startedAt: null,
      });
    } else {
      const total = phaseDurationMs(state.phase, settings);
      const remaining = state.status === 'paused' ? state.pausedRemainingMs : total;
      setState({
        ...state,
        status: 'running',
        startedAt: now - (total - remaining),
        pausedRemainingMs: 0,
        todayDate: state.todayDate || todayDateString(now),
      });
    }
  };

  const handleReset = () => {
    setState({
      ...state,
      status: 'idle',
      startedAt: null,
      pausedRemainingMs: 0,
    });
  };

  const handleSkip = () => {
    const np = nextPhase(state, settings);
    setState({
      ...state,
      phase: np.phase,
      cycleIndex: np.cycleIndex,
      status: 'idle',
      startedAt: null,
      pausedRemainingMs: 0,
    });
  };

  const phaseColor = PHASE_COLORS[state.phase];
  const totalSec = Math.ceil(remainingMs / 1000);
  const mm = String(Math.floor(totalSec / 60)).padStart(2, '0');
  const ss = String(totalSec % 60).padStart(2, '0');

  const headRight = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <span style={{
        fontSize: 10, color: 'rgba(255,255,255,0.55)',
        fontFamily: '"JetBrains Mono", ui-monospace, monospace',
      }}>{state.todayCount} today</span>
      <button
        onClick={() => setSettings({ ...settings, soundEnabled: !settings.soundEnabled })}
        title={settings.soundEnabled ? 'Sound on' : 'Sound off'}
        style={iconBtnStyle(settings.soundEnabled, accent)}
      >
        {settings.soundEnabled ? '🔔' : '🔕'}
      </button>
      {editing && (
        <button
          onClick={() => setShowSettings((s) => !s)}
          title="Settings"
          style={iconBtnStyle(showSettings, accent)}
        >⚙</button>
      )}
    </div>
  );

  return (
    <HFTile title="Pomodoro" headRight={headRight} accent={accent} density={density}>
      <div style={{
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        width: '100%', height: '100%', gap: 8,
        position: 'relative',
      }}>
        <div style={{
          fontSize: 'clamp(28px, 18%, 56px)', fontWeight: 700,
          fontFamily: '"JetBrains Mono", ui-monospace, monospace',
          color: phaseColor,
          letterSpacing: '0.02em',
          lineHeight: 1,
        }}>
          {mm}:{ss}
        </div>
        <div style={{
          fontSize: 11, fontWeight: 600,
          color: 'rgba(255,255,255,0.7)',
          textTransform: 'uppercase', letterSpacing: '0.08em',
        }}>
          {PHASE_LABELS[state.phase]}
        </div>

        <div style={{ display: 'flex', gap: 6 }}>
          {Array.from({ length: settings.cycleLength }, (_, i) => (
            <div
              key={i}
              style={{
                width: 6, height: 6, borderRadius: 3,
                background: i < state.cycleIndex ? PHASE_COLORS.focus : 'rgba(255,255,255,0.15)',
                transition: 'background .2s',
              }}
            />
          ))}
        </div>

        <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
          <ActionButton onClick={handleStartPause} accent={phaseColor} primary>
            {state.status === 'running' ? '⏸ Pause' : '▶ Start'}
          </ActionButton>
          <ActionButton onClick={handleReset}>↺ Reset</ActionButton>
          <ActionButton onClick={handleSkip}>⏭ Skip</ActionButton>
        </div>

        {showSettings && editing && (
          <SettingsPopover
            settings={settings}
            setSettings={setSettings}
            onClose={() => setShowSettings(false)}
            accent={accent}
          />
        )}
      </div>
    </HFTile>
  );
}

function ActionButton({
  onClick, accent, primary, children,
}: {
  onClick: () => void;
  accent?: string;
  primary?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '5px 10px', fontSize: 10.5, fontWeight: 600, borderRadius: 5,
        background: primary && accent ? `${accent}22` : 'rgba(255,255,255,0.05)',
        color: primary && accent ? accent : 'rgba(255,255,255,0.75)',
        border: primary && accent ? `1px solid ${accent}55` : '1px solid rgba(255,255,255,0.08)',
        cursor: 'pointer',
        fontFamily: 'inherit',
      }}
    >{children}</button>
  );
}

function iconBtnStyle(active: boolean, accent: string): React.CSSProperties {
  return {
    padding: '3px 6px', fontSize: 11, borderRadius: 4,
    background: active ? `${accent}22` : 'transparent',
    color: active ? accent : 'rgba(255,255,255,0.55)',
    border: active ? `1px solid ${accent}55` : '1px solid rgba(255,255,255,0.08)',
    cursor: 'pointer',
  };
}

function SettingsPopover({
  settings, setSettings, onClose, accent,
}: {
  settings: PomodoroSettings;
  setSettings: (next: PomodoroSettings) => void;
  onClose: () => void;
  accent: string;
}) {
  return (
    <div
      onClick={(e) => e.stopPropagation()}
      style={{
        position: 'absolute', top: 0, right: 0, bottom: 0, left: 0,
        background: 'rgba(8,9,12,0.96)', backdropFilter: 'blur(8px)',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 8, zIndex: 5,
        display: 'flex', flexDirection: 'column',
        padding: 10, gap: 6,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: '#fff' }}>Settings</span>
        <button
          onClick={onClose}
          style={{
            padding: '2px 7px', fontSize: 11, borderRadius: 4,
            background: 'transparent', color: 'rgba(255,255,255,0.55)',
            border: '1px solid rgba(255,255,255,0.1)', cursor: 'pointer',
          }}
        >×</button>
      </div>
      <SettingRow label="Focus min">
        <NumInput value={settings.focusMin} min={1} max={99}
          onChange={(v) => setSettings({ ...settings, focusMin: v })} />
      </SettingRow>
      <SettingRow label="Short break">
        <NumInput value={settings.shortBreakMin} min={1} max={99}
          onChange={(v) => setSettings({ ...settings, shortBreakMin: v })} />
      </SettingRow>
      <SettingRow label="Long break">
        <NumInput value={settings.longBreakMin} min={1} max={99}
          onChange={(v) => setSettings({ ...settings, longBreakMin: v })} />
      </SettingRow>
      <SettingRow label="Cycle length">
        <NumInput value={settings.cycleLength} min={1} max={12}
          onChange={(v) => setSettings({ ...settings, cycleLength: v })} />
      </SettingRow>
      <button
        onClick={() => setSettings({ ...DEFAULT_POMODORO_SETTINGS })}
        style={{
          marginTop: 4, padding: '4px 8px', fontSize: 10.5,
          background: 'rgba(255,255,255,0.04)', color: 'rgba(255,255,255,0.7)',
          border: `1px solid ${accent}33`, borderRadius: 4, cursor: 'pointer',
        }}
      >Reset to defaults</button>
    </div>
  );
}

function SettingRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 10.5 }}>
      <span style={{ flex: 1, color: 'rgba(255,255,255,0.6)' }}>{label}</span>
      {children}
    </label>
  );
}

function NumInput({ value, min, max, onChange }: { value: number; min: number; max: number; onChange: (v: number) => void }) {
  return (
    <input
      type="number"
      value={value}
      min={min}
      max={max}
      onChange={(e) => {
        const n = parseInt(e.target.value, 10);
        if (Number.isFinite(n)) onChange(Math.max(min, Math.min(max, n)));
      }}
      style={{
        width: 50, fontSize: 11, padding: '3px 6px', borderRadius: 4,
        background: 'rgba(255,255,255,0.04)', color: '#fff',
        border: '1px solid rgba(255,255,255,0.1)',
        fontFamily: '"JetBrains Mono", ui-monospace, monospace',
      }}
    />
  );
}

/** Brief beep via Web Audio API. AudioContext is lazily created on first call;
 *  must follow a user-initiated click for browser autoplay policy compliance.
 *  The Start button counts as a user interaction. */
function playBeep(ctxRef: React.MutableRefObject<AudioContext | null>) {
  try {
    if (!ctxRef.current) {
      const Ctx = (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext);
      ctxRef.current = new Ctx();
    }
    const ctx = ctxRef.current;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'square';
    osc.frequency.value = 880;
    osc.connect(gain);
    gain.connect(ctx.destination);
    const now = ctx.currentTime;
    gain.gain.setValueAtTime(0.15, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.2);
    osc.start(now);
    osc.stop(now + 0.2);
  } catch (err) {
    console.warn('pomodoro beep failed', err);
  }
}

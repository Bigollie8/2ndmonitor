/** Pomodoro timer types + pure helpers. The component runs a setInterval for
 *  re-render purposes only; actual time math is wall-clock derived so
 *  backgrounded tabs don't drift. */

export type PomodoroPhase = 'focus' | 'shortBreak' | 'longBreak';
export type PomodoroStatus = 'idle' | 'running' | 'paused';

export interface PomodoroState {
  phase: PomodoroPhase;
  status: PomodoroStatus;
  startedAt: number | null;
  pausedRemainingMs: number;
  cycleIndex: number;
  todayCount: number;
  todayDate: string;
}

export interface PomodoroSettings {
  focusMin: number;
  shortBreakMin: number;
  longBreakMin: number;
  cycleLength: number;
  soundEnabled: boolean;
}

export const DEFAULT_POMODORO_SETTINGS: PomodoroSettings = {
  focusMin: 25,
  shortBreakMin: 5,
  longBreakMin: 15,
  cycleLength: 4,
  soundEnabled: true,
};

export const DEFAULT_POMODORO_STATE: PomodoroState = {
  phase: 'focus',
  status: 'idle',
  startedAt: null,
  pausedRemainingMs: 0,
  cycleIndex: 0,
  todayCount: 0,
  todayDate: '',
};

export function phaseDurationMs(phase: PomodoroPhase, settings: PomodoroSettings): number {
  if (phase === 'focus') return settings.focusMin * 60_000;
  if (phase === 'shortBreak') return settings.shortBreakMin * 60_000;
  return settings.longBreakMin * 60_000;
}

export function tickRemainingMs(state: PomodoroState, settings: PomodoroSettings, now: number): number {
  const total = phaseDurationMs(state.phase, settings);
  if (state.status === 'idle') return total;
  if (state.status === 'paused') return state.pausedRemainingMs;
  if (state.startedAt == null) return total;
  return Math.max(0, total - (now - state.startedAt));
}

export function nextPhase(state: PomodoroState, settings: PomodoroSettings): { phase: PomodoroPhase; cycleIndex: number } {
  if (state.phase === 'focus') {
    const nextCycle = state.cycleIndex + 1;
    if (nextCycle >= settings.cycleLength) {
      return { phase: 'longBreak', cycleIndex: 0 };
    }
    return { phase: 'shortBreak', cycleIndex: nextCycle };
  }
  return { phase: 'focus', cycleIndex: state.cycleIndex };
}

export function todayDateString(now: number): string {
  const d = new Date(now);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

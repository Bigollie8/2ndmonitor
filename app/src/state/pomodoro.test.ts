import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  phaseDurationMs,
  tickRemainingMs,
  nextPhase,
  todayDateString,
  DEFAULT_POMODORO_SETTINGS,
  type PomodoroState,
  type PomodoroSettings,
} from './pomodoro';

const SETTINGS: PomodoroSettings = {
  focusMin: 25,
  shortBreakMin: 5,
  longBreakMin: 15,
  cycleLength: 4,
  soundEnabled: true,
};

test('phaseDurationMs: returns correct ms per phase', () => {
  assert.equal(phaseDurationMs('focus', SETTINGS), 25 * 60_000);
  assert.equal(phaseDurationMs('shortBreak', SETTINGS), 5 * 60_000);
  assert.equal(phaseDurationMs('longBreak', SETTINGS), 15 * 60_000);
});

test('tickRemainingMs: idle returns total phase duration', () => {
  const state: PomodoroState = {
    phase: 'focus', status: 'idle',
    startedAt: null, pausedRemainingMs: 0,
    cycleIndex: 0, todayCount: 0, todayDate: '2026-05-07',
  };
  assert.equal(tickRemainingMs(state, SETTINGS, Date.now()), 25 * 60_000);
});

test('tickRemainingMs: paused returns pausedRemainingMs', () => {
  const state: PomodoroState = {
    phase: 'focus', status: 'paused',
    startedAt: null, pausedRemainingMs: 12345,
    cycleIndex: 0, todayCount: 0, todayDate: '2026-05-07',
  };
  assert.equal(tickRemainingMs(state, SETTINGS, Date.now()), 12345);
});

test('tickRemainingMs: running returns total - elapsed', () => {
  const startedAt = 1_000_000;
  const now = startedAt + 60_000;
  const state: PomodoroState = {
    phase: 'shortBreak', status: 'running',
    startedAt, pausedRemainingMs: 0,
    cycleIndex: 0, todayCount: 0, todayDate: '2026-05-07',
  };
  assert.equal(tickRemainingMs(state, SETTINGS, now), 5 * 60_000 - 60_000);
});

test('tickRemainingMs: running clamps to zero when overrun', () => {
  const startedAt = 1_000_000;
  const now = startedAt + 30 * 60_000;
  const state: PomodoroState = {
    phase: 'focus', status: 'running',
    startedAt, pausedRemainingMs: 0,
    cycleIndex: 0, todayCount: 0, todayDate: '2026-05-07',
  };
  assert.equal(tickRemainingMs(state, SETTINGS, now), 0);
});

test('nextPhase: focus → shortBreak when more cycles remain', () => {
  const state: PomodoroState = {
    phase: 'focus', status: 'running',
    startedAt: 0, pausedRemainingMs: 0,
    cycleIndex: 0, todayCount: 0, todayDate: '2026-05-07',
  };
  assert.deepEqual(nextPhase(state, SETTINGS), { phase: 'shortBreak', cycleIndex: 1 });
});

test('nextPhase: focus → longBreak after final cycle', () => {
  const state: PomodoroState = {
    phase: 'focus', status: 'running',
    startedAt: 0, pausedRemainingMs: 0,
    cycleIndex: 3, todayCount: 0, todayDate: '2026-05-07',
  };
  assert.deepEqual(nextPhase(state, SETTINGS), { phase: 'longBreak', cycleIndex: 0 });
});

test('nextPhase: shortBreak → focus, cycleIndex unchanged', () => {
  const state: PomodoroState = {
    phase: 'shortBreak', status: 'running',
    startedAt: 0, pausedRemainingMs: 0,
    cycleIndex: 2, todayCount: 0, todayDate: '2026-05-07',
  };
  assert.deepEqual(nextPhase(state, SETTINGS), { phase: 'focus', cycleIndex: 2 });
});

test('todayDateString: formats as YYYY-MM-DD with leading zeros', () => {
  const d = new Date(2026, 0, 5).getTime();
  assert.equal(todayDateString(d), '2026-01-05');
});

test('DEFAULT_POMODORO_SETTINGS: standard 25/5/15/4', () => {
  assert.equal(DEFAULT_POMODORO_SETTINGS.focusMin, 25);
  assert.equal(DEFAULT_POMODORO_SETTINGS.shortBreakMin, 5);
  assert.equal(DEFAULT_POMODORO_SETTINGS.longBreakMin, 15);
  assert.equal(DEFAULT_POMODORO_SETTINGS.cycleLength, 4);
  assert.equal(DEFAULT_POMODORO_SETTINGS.soundEnabled, true);
});

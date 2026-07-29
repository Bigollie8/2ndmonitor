import test from 'node:test';
import assert from 'node:assert/strict';
import { paceFrame, type PaceState } from './framePace';

function simulate(vsyncHz: number, capFps: number, frames: number): number[] {
  const minDelta = 1000 / capFps;
  const state: PaceState = { nextDue: 0 };
  const drawTimes: number[] = [];
  for (let i = 0; i < frames; i++) {
    const now = (i * 1000) / vsyncHz;
    if (paceFrame(now, state, minDelta)) drawTimes.push(now);
  }
  return drawTimes;
}

test('144Hz vsync at 120fps cap: draws 5 of every 6 frames, no long-short beat', () => {
  const draws = simulate(144, 120, 1440); // 10 seconds
  // Average rate within 1% of 120fps.
  const rate = (draws.length - 1) / ((draws[draws.length - 1]! - draws[0]!) / 1000);
  assert.ok(Math.abs(rate - 120) < 1.2, `rate ${rate}`);
  // No gap may exceed 2 vsync intervals (old threshold gate produced 2-frame
  // stalls only at chunk boundaries misaligned with the cap — accumulator
  // spreads them evenly: gaps alternate 1 or 2 ticks, never 3+).
  const gaps = draws.slice(1).map((t, i) => t - draws[i]!);
  const tick = 1000 / 144;
  assert.ok(Math.max(...gaps) <= 2 * tick + 0.01, `max gap ${Math.max(...gaps)}`);
});

test('60Hz vsync at 120fps cap: every frame draws', () => {
  const draws = simulate(60, 120, 600);
  assert.equal(draws.length, 600);
});

test('falling behind re-snaps instead of bursting', () => {
  const state: PaceState = { nextDue: 0 };
  const minDelta = 1000 / 120;
  assert.equal(paceFrame(0, state, minDelta), true);
  // 500ms stall (tab hidden), then vsync resumes: first frame draws,
  // and nextDue does NOT owe a burst of back-to-back accepts.
  assert.equal(paceFrame(500, state, minDelta), true);
  assert.equal(paceFrame(500 + 1000 / 144, state, minDelta), false);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { createAutoGain, AGC_TARGET, AGC_MAX_BOOST, AGC_SILENCE } from './autoGain';

const FRAME = 0.04; // the reader's per-frame dt

/** Run `seconds` of frames at a constant peak, returning the final gain. */
function settle(agc: ReturnType<typeof createAutoGain>, peak: number, seconds: number): number {
  let g = 1;
  for (let t = 0; t < seconds; t += FRAME) g = agc.step(peak, FRAME);
  return g;
}

test('loud content is untouched — gain stays at 1', () => {
  const agc = createAutoGain();
  assert.equal(settle(agc, AGC_TARGET, 5), 1);
  assert.equal(settle(agc, 0.95, 5), 1);
});

test('quiet content is boosted toward the target', () => {
  const agc = createAutoGain();
  // A source at ~15% of scale — the "50% app volume" case sensitivity alone
  // could not fix, because a fixed multiplier that big would clip loud tracks.
  const g = settle(agc, 0.15, 10);
  assert.ok(g > 3, `expected substantial boost, got ${g.toFixed(2)}`);
  assert.ok(g <= AGC_MAX_BOOST + 1e-9, 'never past the boost ceiling');
  // Boosted level lands near the target, not past it.
  const level = 0.15 * g;
  assert.ok(level > 0.6 && level <= AGC_TARGET + 0.05, `level ${level.toFixed(2)}`);
});

test('extremely quiet content hits the ceiling rather than boosting to infinity', () => {
  const agc = createAutoGain();
  assert.ok(Math.abs(settle(agc, 0.02, 20) - AGC_MAX_BOOST) < 0.2);
});

test('silence is NOT amplified — gain relaxes back toward 1', () => {
  const agc = createAutoGain();
  settle(agc, 0.1, 10);            // boosted while quiet music played
  const g = settle(agc, AGC_SILENCE / 2, 30); // then the track ends
  assert.ok(g < 1.5, `gain should relax in silence, got ${g.toFixed(2)}`);
});

test('gain falls quickly when quiet content becomes loud (no blown-out drop)', () => {
  const agc = createAutoGain();
  settle(agc, 0.12, 10);           // boosted during a quiet intro
  // The chorus hits: within half a second the gain must be near 1 again.
  let g = AGC_MAX_BOOST;
  for (let t = 0; t < 0.5; t += FRAME) g = agc.step(0.9, FRAME);
  assert.ok(g < 1.6, `fall must be fast, got ${g.toFixed(2)} after 0.5s`);
});

test('gain rises slowly — a one-frame dip does not pump the visuals', () => {
  const agc = createAutoGain();
  settle(agc, 0.8, 5);             // loud steady state, gain ≈ 1
  const g = agc.step(0.1, FRAME);  // single quiet frame (a beat gap)
  assert.ok(g < 1.2, `one quiet frame must not spike the gain, got ${g.toFixed(2)}`);
});

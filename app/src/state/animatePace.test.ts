import test from 'node:test';
import assert from 'node:assert/strict';
import { animateFrame, createAnimatePace } from './animatePace';
test('repeated pause/resume accepts immediately without catch-up bursts', () => {
  const state = createAnimatePace(0);
  for (const start of [0, 100, 200, 130_000]) {
    assert.equal(animateFrame(start, state, false, true, 60), true);
    assert.equal(animateFrame(start + 1, state, true, false, 60), false);
    assert.equal(animateFrame(start + 2, state, false, true, 60), true);
    assert.equal(animateFrame(start + 3, state, false, true, 60), false);
  }
});
test('silence downstages; live return and short track gaps run at full rate', () => {
  const state = createAnimatePace(0);
  animateFrame(0, state, false, true, 120);
  for (const [time, fps] of [[9000, 120], [10000, 30], [120000, 12]]) {
    animateFrame(time!, state, false, false, 120);
    assert.equal(state.interval, 1000 / fps!);
  }
  assert.equal(animateFrame(120001, state, false, true, 120), true);
  assert.equal(animateFrame(120002, state, false, true, 120), false);
  animateFrame(120020, state, false, false, 120);
  assert.equal(state.interval, 1000 / 120);
});
test('visibility resumes immediately; previews never downstage', () => {
  const state = createAnimatePace(0);
  animateFrame(0, state, false, undefined, 60);
  animateFrame(1, state, true, undefined, 60);
  assert.equal(animateFrame(2, state, false, undefined, 60), true);
  animateFrame(200000, state, false, undefined, 60);
  assert.equal(state.interval, 1000 / 60);
});

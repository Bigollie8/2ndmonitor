import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMeterGate } from './meterPace';

test('144Hz display paints each 30Hz audio frame at most once', () => {
  const gate = createMeterGate();
  let paints = 0;
  const painted = new Set<number>();
  for (let tick = 0; tick < 144; tick++) {
    const now = tick * 1000 / 144;
    const frame = Math.floor(now * 30 / 1000);
    if (gate(now, true, frame)) {
      assert.equal(painted.has(frame), false);
      painted.add(frame);
      paints++;
    }
  }
  assert.ok(paints >= 28 && paints <= 30, `${paints} paints`);
});

test('idle paints once, then a fresh audio frame wakes the meter', () => {
  const gate = createMeterGate();
  assert.equal(gate(0, false, 0), true);
  assert.equal(gate(1000, false, 0), false);
  assert.equal(gate(1100, true, 1), true);
  assert.equal(gate(1200, false, 1), true);
  assert.equal(gate(1300, false, 1), false);
});

test('a lower custom FPS cap is respected', () => {
  const gate = createMeterGate();
  assert.equal(gate(0, true, 1, 10), true);
  assert.equal(gate(50, true, 2, 10), false);
  assert.equal(gate(100, true, 2, 10), true);
});

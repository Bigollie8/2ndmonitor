import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  idleFpsCap, IDLE_AFTER_MS, IDLE_FPS, DEEP_IDLE_AFTER_MS, DEEP_IDLE_FPS,
} from './idlePace';

describe('idleFpsCap', () => {
  it('imposes no cap while the silence is shorter than the grace window', () => {
    assert.equal(idleFpsCap(0), null);
    assert.equal(idleFpsCap(IDLE_AFTER_MS - 1), null);
  });

  it('stages down to the idle rate, then the deep-idle rate', () => {
    assert.equal(idleFpsCap(IDLE_AFTER_MS), IDLE_FPS);
    assert.equal(idleFpsCap(DEEP_IDLE_AFTER_MS - 1), IDLE_FPS);
    assert.equal(idleFpsCap(DEEP_IDLE_AFTER_MS), DEEP_IDLE_FPS);
    assert.equal(idleFpsCap(Number.MAX_SAFE_INTEGER), DEEP_IDLE_FPS);
  });

  it('the stages are ordered sensibly (tuning guard)', () => {
    assert.ok(IDLE_AFTER_MS < DEEP_IDLE_AFTER_MS);
    assert.ok(DEEP_IDLE_FPS < IDLE_FPS);
    assert.ok(IDLE_FPS <= 60);
  });
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LAWS, rotateLaw, parseLawsConfig, DEFAULT_LAW_INTERVAL_H } from './lawsOfPower';

test('all 48 laws present, numbered 1..48, concise', () => {
  assert.equal(LAWS.length, 48);
  assert.deepEqual(LAWS.map((l) => l.n), Array.from({ length: 48 }, (_, i) => i + 1));
  for (const l of LAWS) {
    assert.ok(l.title.length > 0 && l.title.length <= 60, `title ${l.n}`);
    assert.ok(l.gist.length > 0 && l.gist.length <= 160, `gist ${l.n} concise`);
  }
});

test('rotateLaw holds the same state (by reference) before the interval', () => {
  const s = { lawIndex: 10, rotatedAt: 1_000 };
  assert.equal(rotateLaw(s, 1_000 + 3_599_000, 3_600_000), s);
});

test('rotateLaw moves to a DIFFERENT law after the interval', () => {
  const s = { lawIndex: 10, rotatedAt: 0 };
  for (let i = 0; i < 50; i++) {
    const next = rotateLaw(s, 4 * 3_600_000, 4 * 3_600_000);
    assert.notEqual(next.lawIndex, 10);
    assert.ok(next.lawIndex >= 0 && next.lawIndex < 48);
    assert.equal(next.rotatedAt, 4 * 3_600_000);
  }
});

test('rotateLaw can reach every other law (uniform over the other 47)', () => {
  const s = { lawIndex: 0, rotatedAt: 0 };
  const seen = new Set<number>();
  for (let i = 0; i < 2000; i++) seen.add(rotateLaw(s, 1e9, 1, Math.random).lawIndex);
  assert.equal(seen.size, 47);
  assert.ok(!seen.has(0));
});

test('corrupt or future-dated state re-seeds cleanly', () => {
  for (const bad of [null, { lawIndex: -1, rotatedAt: 0 }, { lawIndex: 99, rotatedAt: 0 },
    { lawIndex: 2.5, rotatedAt: 0 }, { lawIndex: 3, rotatedAt: 9e15 }]) {
    const out = rotateLaw(bad as never, 5_000, 1_000_000);
    assert.ok(out.lawIndex >= 0 && out.lawIndex < 48);
    assert.equal(out.rotatedAt, 5_000);
  }
});

test('parseLawsConfig clamps to the allowed cadence set', () => {
  assert.equal(parseLawsConfig({ intervalHours: 12 }).intervalHours, 12);
  assert.equal(parseLawsConfig({ intervalHours: 5 }).intervalHours, DEFAULT_LAW_INTERVAL_H);
  assert.equal(parseLawsConfig(null).intervalHours, DEFAULT_LAW_INTERVAL_H);
  assert.equal(parseLawsConfig('x').intervalHours, DEFAULT_LAW_INTERVAL_H);
});

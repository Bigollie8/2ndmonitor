import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEnergyTracker, pickPreset, presetTierOf, DJ_DEFAULTS } from './milkdrop-dj';

// Feed a constant level every 250ms for `ms`, returning the first non-null
// verdict (and the time it fired) or null.
function run(tracker: ReturnType<typeof createEnergyTracker>, level: number | null, fromMs: number, ms: number) {
  for (let t = fromMs; t <= fromMs + ms; t += 250) {
    const v = tracker.feed(level, t);
    if (v) return { verdict: v, at: t };
  }
  return null;
}

test('steady level never triggers a shift, only the long fallback', () => {
  const tr = createEnergyTracker();
  const hit = run(tr, 0.5, 0, DJ_DEFAULTS.fallbackLiveMs + 1_000);
  assert.equal(hit?.verdict, 'fallback');
  assert.ok(hit!.at >= DJ_DEFAULTS.fallbackLiveMs);
});

test('a sustained jump in level triggers a shift after hold+cooldown', () => {
  const tr = createEnergyTracker();
  // establish a quiet baseline well past the cooldown window
  assert.equal(run(tr, 0.2, 0, 20_000), null);
  // the drop hits: level triples and stays there
  const hit = run(tr, 0.7, 20_250, 10_000);
  assert.equal(hit?.verdict, 'shift');
  // fired only after the hold time, not on the first loud sample
  assert.ok(hit!.at >= 20_250 + DJ_DEFAULTS.holdMs);
});

test('a one-sample spike does not trigger (hold requirement)', () => {
  const tr = createEnergyTracker();
  assert.equal(run(tr, 0.2, 0, 20_000), null);
  assert.equal(tr.feed(0.9, 20_250), null); // single spike
  // back to baseline — held divergence resets, nothing fires
  assert.equal(run(tr, 0.2, 20_500, 8_000), null);
});

test('noteAdvance adopts the new baseline — the same level cannot re-trigger', () => {
  const tr = createEnergyTracker();
  assert.equal(run(tr, 0.2, 0, 20_000), null);
  const hit = run(tr, 0.7, 20_250, 10_000);
  assert.equal(hit?.verdict, 'shift');
  tr.noteAdvance(hit!.at);
  // still loud, but loud is the baseline now: quiet until the long fallback
  const next = run(tr, 0.7, hit!.at + 250, DJ_DEFAULTS.fallbackLiveMs + 1_000);
  assert.equal(next?.verdict, 'fallback');
});

test('cooldown blocks a second shift right after an advance', () => {
  const tr = createEnergyTracker();
  assert.equal(run(tr, 0.2, 0, 20_000), null);
  const hit = run(tr, 0.7, 20_250, 10_000)!;
  tr.noteAdvance(hit.at);
  // another genuine shift immediately after — must wait out the cooldown
  const second = run(tr, 0.15, hit.at + 250, DJ_DEFAULTS.cooldownMs + 6_000);
  assert.ok(second === null || second.at >= hit.at + DJ_DEFAULTS.cooldownMs);
});

test('no live audio falls back on the classic 30s cadence', () => {
  const tr = createEnergyTracker();
  const hit = run(tr, null, 0, 35_000);
  assert.equal(hit?.verdict, 'fallback');
  assert.ok(hit!.at >= DJ_DEFAULTS.fallbackDeadMs && hit!.at < 35_000);
});

test('tier follows the fast EMA', () => {
  const tr = createEnergyTracker();
  run(tr, 0.1, 0, 10_000);
  assert.equal(tr.tier(), 0);
  run(tr, 0.5, 10_250, 20_000);
  assert.equal(tr.tier(), 1);
  run(tr, 0.9, 30_500, 20_000);
  assert.equal(tr.tier(), 2);
});

test('presetTierOf is stable and spreads keys across all three tiers', () => {
  const keys = Array.from({ length: 60 }, (_, i) => `bundled:preset-${i}`);
  const tiers = new Set(keys.map(presetTierOf));
  assert.equal(tiers.size, 3);
  assert.equal(presetTierOf('bundled:preset-7'), presetTierOf('bundled:preset-7'));
});

test('pickPreset stays in the requested tier and never returns current', () => {
  const keys = Array.from({ length: 40 }, (_, i) => `k${i}`);
  for (const tier of [0, 1, 2] as const) {
    for (let n = 0; n < 25; n++) {
      const current = n % keys.length;
      const pick = pickPreset(keys, current, tier, Math.random);
      assert.notEqual(pick, current);
      assert.equal(presetTierOf(keys[pick]), tier);
    }
  }
});

test('pickPreset falls back to the whole library when the tier is empty', () => {
  // craft keys all landing in one tier by filtering
  const pool = Array.from({ length: 200 }, (_, i) => `p${i}`).filter((k) => presetTierOf(k) === 0);
  const keys = pool.slice(0, 5);
  const pick = pickPreset(keys, 2, 1, () => 0.99); // tier 1 has no candidates
  assert.notEqual(pick, 2);
  assert.ok(pick >= 0 && pick < keys.length);
});

test('pickPreset with a single-entry library returns current (no thrash)', () => {
  assert.equal(pickPreset(['only'], 0, 2), 0);
});

test('rand at the extremes stays in bounds', () => {
  const keys = ['a', 'b', 'c', 'd', 'e'];
  const low = pickPreset(keys, 0, 1, () => 0);
  const high = pickPreset(keys, 0, 1, () => 0.999999);
  assert.ok(low >= 0 && low < keys.length && high >= 0 && high < keys.length);
});

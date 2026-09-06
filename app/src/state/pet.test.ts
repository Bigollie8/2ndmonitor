import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_PET_NAME,
  DEFAULT_PET_STATE,
  FEED_HAPPINESS_BONUS,
  FEED_HUNGER_RELIEF,
  HAPPINESS_DECAY_PER_HOUR,
  HUNGER_PER_HOUR,
  HUNGRY_DECAY_MULTIPLIER,
  HUNGRY_THRESHOLD,
  MAX_TICK_GAP_MS,
  PET_HAPPINESS_BONUS,
  PET_NAME_MAX,
  PLAY_HAPPINESS_BONUS,
  PLAY_HUNGER_COST,
  deriveMood,
  feedPet,
  hydratePet,
  isSleepHour,
  newPet,
  petAgeDays,
  playWithPet,
  renamePet,
  strokePet,
  tickPet,
  type PetState,
} from './pet';

const H = 3_600_000;
const T0 = 1_700_000_000_000;

const near = (a: number, b: number, eps = 1e-6) =>
  assert.ok(Math.abs(a - b) <= eps, `expected ${a} ≈ ${b}`);

function pet(over: Partial<PetState> = {}): PetState {
  return { ...newPet(T0), ...over };
}

// ---------------------------------------------------------------- newPet

test('newPet: adopted pet is peckish, happy, stamped with now', () => {
  const p = newPet(T0);
  assert.equal(p.name, DEFAULT_PET_NAME);
  assert.equal(p.hunger, 20);
  assert.equal(p.happiness, 80);
  assert.equal(p.born, T0);
  assert.equal(p.lastTickAt, T0);
  assert.equal(p.lastFedAt, null);
  assert.equal(p.lastPlayedAt, null);
  assert.equal(p.fedCount, 0);
  assert.equal(p.playedCount, 0);
});

test('DEFAULT_PET_STATE: timestamps are 0 placeholders, not build time', () => {
  assert.equal(DEFAULT_PET_STATE.born, 0);
  assert.equal(DEFAULT_PET_STATE.lastTickAt, 0);
});

// ---------------------------------------------------------------- tickPet

test('tickPet: hunger rises at HUNGER_PER_HOUR (0→100 over 8h)', () => {
  const p = pet({ hunger: 0, happiness: 100 });
  near(tickPet(p, T0 + 1 * H).hunger, HUNGER_PER_HOUR);
  near(tickPet(p, T0 + 4 * H).hunger, 50);
  near(tickPet(p, T0 + 8 * H).hunger, 100);
});

test('tickPet: happiness decays at HAPPINESS_DECAY_PER_HOUR while fed', () => {
  // Start at 0 hunger so 1h stays well under the hungry threshold.
  const p = pet({ hunger: 0, happiness: 100 });
  near(tickPet(p, T0 + 1 * H).happiness, 100 - HAPPINESS_DECAY_PER_HOUR);
});

test('tickPet: happiness decays faster once the pet is hungry', () => {
  const hungry = pet({ hunger: HUNGRY_THRESHOLD, happiness: 100 });
  const out = tickPet(hungry, T0 + 1 * H);
  near(out.happiness, 100 - HAPPINESS_DECAY_PER_HOUR * HUNGRY_DECAY_MULTIPLIER);
});

test('tickPet: a gap that crosses the hungry threshold splits the decay rate at the crossing', () => {
  // hunger 57.5 → threshold 70 takes exactly 1h at 12.5/h; tick 3h total.
  const p = pet({ hunger: HUNGRY_THRESHOLD - HUNGER_PER_HOUR, happiness: 100 });
  const out = tickPet(p, T0 + 3 * H);
  const expected = 100 - HAPPINESS_DECAY_PER_HOUR * (1 + 2 * HUNGRY_DECAY_MULTIPLIER);
  near(out.happiness, expected);
  near(out.hunger, HUNGRY_THRESHOLD + 2 * HUNGER_PER_HOUR);
});

test('tickPet: meters clamp to [0,100] — a week away starves but never kills', () => {
  const out = tickPet(pet({ hunger: 20, happiness: 80 }), T0 + 7 * 24 * H);
  assert.equal(out.hunger, 100);
  assert.equal(out.happiness, 0);
  assert.equal(out.lastTickAt, T0 + 7 * 24 * H);
});

test('tickPet: elapsed is capped at MAX_TICK_GAP_MS', () => {
  // Same result whether 24h or 240h elapsed — both saturate here, so check
  // the cap via a slow meter: happiness at 100 with hunger 0 for 24h vs 240h.
  const p = pet({ hunger: 0, happiness: 100 });
  const day = tickPet(p, T0 + MAX_TICK_GAP_MS);
  const tenDays = tickPet(p, T0 + 10 * MAX_TICK_GAP_MS);
  assert.equal(day.hunger, tenDays.hunger);
  assert.equal(day.happiness, tenDays.happiness);
});

test('tickPet: clock going backwards advances nothing but re-stamps lastTickAt', () => {
  const p = pet({ hunger: 40, happiness: 60 });
  const out = tickPet(p, T0 - 5 * H);
  assert.equal(out.hunger, 40);
  assert.equal(out.happiness, 60);
  assert.equal(out.lastTickAt, T0 - 5 * H);
});

test('tickPet: same instant returns the same object (no churn)', () => {
  const p = pet();
  assert.equal(tickPet(p, T0), p);
});

test('tickPet: ticking in two steps equals ticking once (path independent)', () => {
  const p = pet({ hunger: 30, happiness: 90 });
  const once = tickPet(p, T0 + 5 * H);
  const twice = tickPet(tickPet(p, T0 + 2 * H), T0 + 5 * H);
  near(once.hunger, twice.hunger);
  near(once.happiness, twice.happiness);
});

// ---------------------------------------------------------------- actions

test('feedPet: relieves hunger, small happiness bonus, stamps + counts', () => {
  const p = pet({ hunger: 60, happiness: 50 });
  const out = feedPet(p, T0);
  assert.equal(out.hunger, 60 - FEED_HUNGER_RELIEF);
  assert.equal(out.happiness, 50 + FEED_HAPPINESS_BONUS);
  assert.equal(out.lastFedAt, T0);
  assert.equal(out.fedCount, 1);
});

test('feedPet: overfeeding a full pet gives no happiness bonus and clamps at 0', () => {
  const out = feedPet(pet({ hunger: 5, happiness: 50 }), T0);
  assert.equal(out.hunger, 0);
  assert.equal(out.happiness, 50);
});

test('feedPet: ticks elapsed time before applying', () => {
  // 4h → hunger 20+50 = 70, then -35 = 35.
  const out = feedPet(pet({ hunger: 20 }), T0 + 4 * H);
  near(out.hunger, 35);
  assert.equal(out.lastTickAt, T0 + 4 * H);
});

test('playWithPet: big happiness boost, works up an appetite', () => {
  const out = playWithPet(pet({ hunger: 20, happiness: 50 }), T0);
  assert.equal(out.happiness, 50 + PLAY_HAPPINESS_BONUS);
  assert.equal(out.hunger, 20 + PLAY_HUNGER_COST);
  assert.equal(out.lastPlayedAt, T0);
  assert.equal(out.playedCount, 1);
});

test('playWithPet: happiness clamps at 100', () => {
  assert.equal(playWithPet(pet({ happiness: 95 }), T0).happiness, 100);
});

test('strokePet: modest happiness bump, no hunger cost, no counters', () => {
  const out = strokePet(pet({ hunger: 20, happiness: 50 }), T0);
  assert.equal(out.happiness, 50 + PET_HAPPINESS_BONUS);
  assert.equal(out.hunger, 20);
  assert.equal(out.fedCount, 0);
  assert.equal(out.playedCount, 0);
});

// ---------------------------------------------------------------- rename

test('renamePet: trims, collapses whitespace, caps length', () => {
  assert.equal(renamePet(pet(), '  Mr   Whiskers  ').name, 'Mr Whiskers');
  assert.equal(renamePet(pet(), 'x'.repeat(50)).name.length, PET_NAME_MAX);
});

test('renamePet: empty / whitespace-only keeps the old name and same object', () => {
  const p = pet();
  assert.equal(renamePet(p, ''), p);
  assert.equal(renamePet(p, '   '), p);
  assert.equal(renamePet(p, DEFAULT_PET_NAME), p);
});

// ---------------------------------------------------------------- mood

test('isSleepHour: 23:00–06:59 wraps midnight', () => {
  assert.equal(isSleepHour(23), true);
  assert.equal(isSleepHour(0), true);
  assert.equal(isSleepHour(6), true);
  assert.equal(isSleepHour(7), false);
  assert.equal(isSleepHour(12), false);
  assert.equal(isSleepHour(22), false);
  assert.equal(isSleepHour(NaN), false);
});

test('deriveMood: hunger wins over everything', () => {
  assert.equal(deriveMood(pet({ hunger: 70, happiness: 100 }), 3), 'hungry');
  assert.equal(deriveMood(pet({ hunger: 100, happiness: 0 }), 12), 'hungry');
});

test('deriveMood: sad beats sleepy; sleepy beats happy/content', () => {
  assert.equal(deriveMood(pet({ hunger: 10, happiness: 10 }), 3), 'sad');
  assert.equal(deriveMood(pet({ hunger: 10, happiness: 100 }), 3), 'sleepy');
  assert.equal(deriveMood(pet({ hunger: 10, happiness: 50 }), 3), 'sleepy');
});

test('deriveMood: daytime happy vs content by threshold', () => {
  assert.equal(deriveMood(pet({ hunger: 10, happiness: 70 }), 12), 'happy');
  assert.equal(deriveMood(pet({ hunger: 10, happiness: 69.9 }), 12), 'content');
  assert.equal(deriveMood(pet({ hunger: 10, happiness: 30 }), 12), 'content');
});

// ---------------------------------------------------------------- age

test('petAgeDays: whole days since born, never negative, 0 for placeholder born', () => {
  assert.equal(petAgeDays(pet(), T0), 0);
  assert.equal(petAgeDays(pet(), T0 + 23 * H), 0);
  assert.equal(petAgeDays(pet(), T0 + 24 * H), 1);
  assert.equal(petAgeDays(pet(), T0 + 10 * 24 * H + 5 * H), 10);
  assert.equal(petAgeDays(pet(), T0 - H), 0);
  assert.equal(petAgeDays(pet({ born: 0 }), T0), 0);
});

// ---------------------------------------------------------------- hydrate

test('hydratePet: non-objects become a fresh pet born now', () => {
  for (const junk of [undefined, null, 42, 'pip', [1, 2], true]) {
    const out = hydratePet(junk, T0);
    assert.deepEqual(out, newPet(T0));
  }
});

test('hydratePet: the persisted DEFAULT_PET_STATE maps 0 timestamps to now', () => {
  const out = hydratePet(DEFAULT_PET_STATE, T0);
  assert.equal(out.born, T0);
  assert.equal(out.lastTickAt, T0);
  assert.equal(out.name, DEFAULT_PET_NAME);
});

test('hydratePet: partial object keeps valid fields, defaults the rest', () => {
  const out = hydratePet({ name: 'Mochi', hunger: 55 }, T0);
  assert.equal(out.name, 'Mochi');
  assert.equal(out.hunger, 55);
  assert.equal(out.happiness, 80);
  assert.equal(out.born, T0);
  assert.equal(out.lastTickAt, T0);
  assert.equal(out.lastFedAt, null);
  assert.equal(out.fedCount, 0);
});

test('hydratePet: corrupt field types fall back safely', () => {
  const out = hydratePet({
    name: 123, hunger: 'lots', happiness: NaN, lastTickAt: 'yesterday',
    lastFedAt: -1, lastPlayedAt: Infinity, born: null, fedCount: -3, playedCount: 2.7,
  }, T0);
  assert.equal(out.name, DEFAULT_PET_NAME);
  assert.equal(out.hunger, 20);
  assert.equal(out.happiness, 80);
  assert.equal(out.lastTickAt, T0);
  assert.equal(out.lastFedAt, null);
  assert.equal(out.lastPlayedAt, null);
  assert.equal(out.born, T0);
  assert.equal(out.fedCount, 0);
  assert.equal(out.playedCount, 2);
});

test('hydratePet: out-of-range meters clamp, valid timestamps survive', () => {
  const out = hydratePet({ hunger: 250, happiness: -40, born: T0 - 3 * 24 * H, lastTickAt: T0 - H, lastFedAt: T0 - 2 * H }, T0);
  assert.equal(out.hunger, 100);
  assert.equal(out.happiness, 0);
  assert.equal(out.born, T0 - 3 * 24 * H);
  assert.equal(out.lastTickAt, T0 - H);
  assert.equal(out.lastFedAt, T0 - 2 * H);
});

test('hydratePet: a valid state round-trips unchanged', () => {
  const p = pet({ name: 'Bean', hunger: 33, happiness: 66, lastFedAt: T0 - H, fedCount: 4 });
  assert.deepEqual(hydratePet(JSON.parse(JSON.stringify(p)), T0 + H), p);
});

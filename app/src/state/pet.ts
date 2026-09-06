/** Virtual pet — types + pure helpers. Nothing here touches the DOM, the
 *  clock, or Tauri: every function takes `now` (epoch ms) so progression is
 *  wall-clock derived and replayable. The component owns a slow setInterval
 *  purely to re-render; there is no animation loop (idle motion is CSS).
 *
 *  Model: two 0–100 meters that drift over real time and are nudged by the
 *  three actions. Hunger climbs (0 = full, 100 = starving); happiness sinks
 *  (100 = delighted). The pet can never die — meters saturate at the clamps
 *  and recover with attention, so a week away leaves a hungry, sulky pet,
 *  not a corpse. Mood is derived, never stored. */

export type PetMood = 'happy' | 'content' | 'hungry' | 'sad' | 'sleepy';

export interface PetState {
  name: string;
  /** 0 = full, 100 = starving. */
  hunger: number;
  /** 0 = miserable, 100 = delighted. */
  happiness: number;
  /** When the meters were last advanced — progression replays from here. */
  lastTickAt: number;
  lastFedAt: number | null;
  lastPlayedAt: number | null;
  /** Epoch ms the pet was adopted; drives the age readout. */
  born: number;
  fedCount: number;
  playedCount: number;
}

export const DEFAULT_PET_NAME = 'Pip';
export const PET_NAME_MAX = 20;

/** Hunger goes 0 → 100 over 8 hours untouched. */
export const HUNGER_PER_HOUR = 100 / 8;
/** Happiness goes 100 → 0 over 12 hours untouched … */
export const HAPPINESS_DECAY_PER_HOUR = 100 / 12;
/** … twice as fast while the pet is hungry. */
export const HUNGRY_DECAY_MULTIPLIER = 2;
/** Above this hunger the pet reads as hungry (and sulks faster). */
export const HUNGRY_THRESHOLD = 70;
export const SAD_THRESHOLD = 30;
export const HAPPY_THRESHOLD = 70;
/** Local hours (inclusive start, exclusive end, wrapping midnight) in which a
 *  fed, content pet dozes off. */
export const SLEEP_START_HOUR = 23;
export const SLEEP_END_HOUR = 7;

/** Elapsed time beyond this is treated as exactly this long. Meters already
 *  saturate at the clamps well before it; the cap exists so a wildly wrong
 *  clock (or a restored backup) cannot produce absurd intermediate math. */
export const MAX_TICK_GAP_MS = 24 * 3_600_000;

export const FEED_HUNGER_RELIEF = 35;
export const FEED_HAPPINESS_BONUS = 5;
export const PLAY_HAPPINESS_BONUS = 25;
export const PLAY_HUNGER_COST = 5;
export const PET_HAPPINESS_BONUS = 10;

const HOUR_MS = 3_600_000;

export function clamp01to100(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, n));
}

/** A freshly adopted pet: a little peckish, in good spirits. */
export function newPet(now: number, name: string = DEFAULT_PET_NAME): PetState {
  return {
    name,
    hunger: 20,
    happiness: 80,
    lastTickAt: now,
    lastFedAt: null,
    lastPlayedAt: null,
    born: now,
    fedCount: 0,
    playedCount: 0,
  };
}

/** The persisted default. `born`/`lastTickAt` are 0 so the first tick in
 *  the component stamps real adoption time — see `hydratePet`, which maps
 *  0 → now. A literal Date.now() at module load would bake build time into
 *  DEFAULT_TWEAKS. */
export const DEFAULT_PET_STATE: PetState = {
  ...newPet(0),
};

/** Advance the meters from `state.lastTickAt` to `now`. Pure and
 *  idempotent for equal `now`; a clock that went backwards advances nothing
 *  but still re-stamps `lastTickAt` so the pet does not freeze until the
 *  clock catches up. */
export function tickPet(state: PetState, now: number): PetState {
  const rawGap = now - state.lastTickAt;
  const gapMs = Math.max(0, Math.min(MAX_TICK_GAP_MS, Number.isFinite(rawGap) ? rawGap : 0));
  if (gapMs === 0) {
    return state.lastTickAt === now ? state : { ...state, lastTickAt: now };
  }
  const hours = gapMs / HOUR_MS;

  // Integrate hunger first; happiness decay depends on whether the pet
  // crossed the hungry threshold during the gap. Split the gap at the
  // crossing so a long absence is charged correctly, not at the start rate.
  const hungerEnd = clamp01to100(state.hunger + HUNGER_PER_HOUR * hours);
  let hungryHours: number;
  if (state.hunger >= HUNGRY_THRESHOLD) {
    hungryHours = hours;
  } else if (hungerEnd < HUNGRY_THRESHOLD) {
    hungryHours = 0;
  } else {
    const hoursToThreshold = (HUNGRY_THRESHOLD - state.hunger) / HUNGER_PER_HOUR;
    hungryHours = Math.max(0, hours - hoursToThreshold);
  }
  const calmHours = hours - hungryHours;
  const decay = HAPPINESS_DECAY_PER_HOUR * (calmHours + hungryHours * HUNGRY_DECAY_MULTIPLIER);

  return {
    ...state,
    hunger: hungerEnd,
    happiness: clamp01to100(state.happiness - decay),
    lastTickAt: now,
  };
}

export function feedPet(state: PetState, now: number): PetState {
  const s = tickPet(state, now);
  // Feeding a full pet is not a treat — no happiness bonus for overfeeding.
  const wasPeckish = s.hunger > 10;
  return {
    ...s,
    hunger: clamp01to100(s.hunger - FEED_HUNGER_RELIEF),
    happiness: clamp01to100(s.happiness + (wasPeckish ? FEED_HAPPINESS_BONUS : 0)),
    lastFedAt: now,
    fedCount: s.fedCount + 1,
  };
}

export function playWithPet(state: PetState, now: number): PetState {
  const s = tickPet(state, now);
  return {
    ...s,
    happiness: clamp01to100(s.happiness + PLAY_HAPPINESS_BONUS),
    hunger: clamp01to100(s.hunger + PLAY_HUNGER_COST),
    lastPlayedAt: now,
    playedCount: s.playedCount + 1,
  };
}

export function strokePet(state: PetState, now: number): PetState {
  const s = tickPet(state, now);
  return {
    ...s,
    happiness: clamp01to100(s.happiness + PET_HAPPINESS_BONUS),
  };
}

/** Trim + length-cap a proposed name; an empty result keeps the old name. */
export function renamePet(state: PetState, proposed: string): PetState {
  const name = sanitizeName(proposed);
  if (name === null || name === state.name) return state;
  return { ...state, name };
}

function sanitizeName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const t = raw.replace(/\s+/g, ' ').trim().slice(0, PET_NAME_MAX);
  return t.length ? t : null;
}

/** Is `hour` (0–23 local) inside the sleep window? Wraps midnight. */
export function isSleepHour(hour: number): boolean {
  if (!Number.isFinite(hour)) return false;
  const h = ((Math.floor(hour) % 24) + 24) % 24;
  return SLEEP_START_HOUR > SLEEP_END_HOUR
    ? h >= SLEEP_START_HOUR || h < SLEEP_END_HOUR
    : h >= SLEEP_START_HOUR && h < SLEEP_END_HOUR;
}

/** Derive mood from the meters (already ticked) and the local hour. Needs
 *  come first: a starving pet is hungry at 3 a.m., not sleepy. */
export function deriveMood(state: PetState, localHour: number): PetMood {
  if (state.hunger >= HUNGRY_THRESHOLD) return 'hungry';
  if (state.happiness < SAD_THRESHOLD) return 'sad';
  if (isSleepHour(localHour)) return 'sleepy';
  if (state.happiness >= HAPPY_THRESHOLD) return 'happy';
  return 'content';
}

export const MOOD_LABELS: Record<PetMood, string> = {
  happy: 'Happy',
  content: 'Content',
  hungry: 'Hungry',
  sad: 'Feeling low',
  sleepy: 'Sleepy',
};

/** Whole days since adoption, never negative. */
export function petAgeDays(state: PetState, now: number): number {
  if (!Number.isFinite(state.born) || state.born <= 0) return 0;
  return Math.max(0, Math.floor((now - state.born) / (24 * HOUR_MS)));
}

/** Coerce whatever came out of persisted JSON into a safe PetState. Partial
 *  objects keep their valid fields; anything missing or the wrong type falls
 *  back to the default. Zero/absent timestamps become `now` so a fresh install
 *  is born the moment the tile first renders. */
export function hydratePet(raw: unknown, now: number): PetState {
  const fresh = newPet(now);
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return fresh;
  const r = raw as Record<string, unknown>;

  const meter = (v: unknown, fallback: number) =>
    typeof v === 'number' && Number.isFinite(v) ? clamp01to100(v) : fallback;
  const stamp = (v: unknown, fallback: number) =>
    typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : fallback;
  const nullableStamp = (v: unknown) =>
    typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null;
  const count = (v: unknown) =>
    typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0;

  return {
    name: sanitizeName(r.name) ?? fresh.name,
    hunger: meter(r.hunger, fresh.hunger),
    happiness: meter(r.happiness, fresh.happiness),
    lastTickAt: stamp(r.lastTickAt, now),
    lastFedAt: nullableStamp(r.lastFedAt),
    lastPlayedAt: nullableStamp(r.lastPlayedAt),
    born: stamp(r.born, now),
    fedCount: count(r.fedCount),
    playedCount: count(r.playedCount),
  };
}

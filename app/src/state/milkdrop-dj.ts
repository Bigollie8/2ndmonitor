// Song-aware MilkDrop preset advancing (0.9.7).
//
// Replaces the blind 30-second random rotation with three triggers:
//   1. Track change — a new song gets a new preset immediately.
//   2. Sustained energy shift — the live level's fast EMA diverging from its
//      slow EMA for holdMs (a drop hitting, a quiet bridge) advances, with a
//      cooldown so a busy mix can't strobe presets.
//   3. Fallback — nothing detected for fallbackLiveMs still advances, so a
//      flat DJ set never freezes on one preset. Without live audio there is
//      no signal at all and the classic 30s cadence is kept as-is.
//
// Preset choice is energy-TIERED: each preset key hashes stably into one of
// three buckets, and the pick draws from the bucket matching the current
// energy tier. Presets carry no intrinsic energy metadata — the bucketing is
// a stable pseudo-random partition, so what it buys is CONSISTENCY (the same
// preset families recur at similar energies within a session, quiet parts
// stop cycling through the whole library) rather than any real analysis of
// preset content. Honest trade-off, documented here on purpose.
//
// Pure module: no DOM, no timers of its own — the component feeds it
// (level, nowMs) samples, which is what makes it node-testable.

export interface EnergyTrackerConfig {
  /** Fast EMA half-life — tracks the current musical moment. */
  fastHalfLifeMs: number;
  /** Slow EMA half-life — the song's recent baseline. */
  slowHalfLifeMs: number;
  /** |fast−slow| / max(slow, floor) must exceed this to count as shifting. */
  shiftRatio: number;
  /** The divergence must persist this long — one snare hit is not a drop. */
  holdMs: number;
  /** Minimum gap between energy-triggered advances. */
  cooldownMs: number;
  /** Advance anyway after this long with live audio but no detected shift. */
  fallbackLiveMs: number;
  /** Advance cadence when there is NO live audio signal (classic behavior). */
  fallbackDeadMs: number;
  /** Level thresholds splitting calm / mid / loud tiers. */
  tierLow: number;
  tierHigh: number;
}

export const DJ_DEFAULTS: EnergyTrackerConfig = {
  fastHalfLifeMs: 1_500,
  slowHalfLifeMs: 15_000,
  shiftRatio: 0.35,
  holdMs: 2_500,
  cooldownMs: 12_000,
  fallbackLiveMs: 75_000,
  fallbackDeadMs: 30_000,
  tierLow: 0.33,
  tierHigh: 0.66,
};

export type AdvanceVerdict = 'shift' | 'fallback' | null;

export interface EnergyTracker {
  /** Feed one sample. `level` null = no live audio this tick. Returns why to
   *  advance now, or null to hold. The caller decides whether to act (auto
   *  off / paused) and reports acting via noteAdvance. */
  feed(level: number | null, nowMs: number): AdvanceVerdict;
  /** Any advance happened (auto OR manual) — restart cooldown + fallback
   *  clocks and adopt the current moment as the new baseline. */
  noteAdvance(nowMs: number): void;
  /** Energy tier of the current musical moment (from the fast EMA). */
  tier(): 0 | 1 | 2;
}

export function createEnergyTracker(overrides: Partial<EnergyTrackerConfig> = {}): EnergyTracker {
  const cfg = { ...DJ_DEFAULTS, ...overrides };
  let fast = 0;
  let slow = 0;
  let primed = false;
  let heldMs = 0;
  let lastFeedMs: number | null = null;
  let lastAdvanceMs: number | null = null;

  return {
    feed(level, nowMs) {
      if (lastAdvanceMs === null) lastAdvanceMs = nowMs;
      // Cap dt so a background-throttled tab resuming doesn't count the whole
      // gap as "sustained" divergence in one bite.
      const dt = lastFeedMs === null ? 0 : Math.min(nowMs - lastFeedMs, 2_000);
      lastFeedMs = nowMs;

      if (level === null) {
        heldMs = 0;
        return nowMs - lastAdvanceMs >= cfg.fallbackDeadMs ? 'fallback' : null;
      }

      if (!primed) {
        fast = slow = level;
        primed = true;
      } else {
        fast += (1 - 0.5 ** (dt / cfg.fastHalfLifeMs)) * (level - fast);
        slow += (1 - 0.5 ** (dt / cfg.slowHalfLifeMs)) * (level - slow);
      }

      // The floor keeps near-silence from turning any noise into a huge
      // ratio; below it, divergence is judged against the floor instead.
      const divergence = Math.abs(fast - slow) / Math.max(slow, 0.05);
      heldMs = divergence >= cfg.shiftRatio ? heldMs + dt : 0;

      if (heldMs >= cfg.holdMs && nowMs - lastAdvanceMs >= cfg.cooldownMs) return 'shift';
      if (nowMs - lastAdvanceMs >= cfg.fallbackLiveMs) return 'fallback';
      return null;
    },
    noteAdvance(nowMs) {
      lastAdvanceMs = nowMs;
      heldMs = 0;
      // The level we just switched at IS the new normal — without this the
      // same divergence immediately re-arms after the cooldown.
      slow = fast;
    },
    tier() {
      return fast < cfg.tierLow ? 0 : fast < cfg.tierHigh ? 1 : 2;
    },
  };
}

/** FNV-1a — stable across sessions (preset keys are stable strings). */
export function hashKey(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** The stable pseudo-tier a preset belongs to (see module comment). */
export function presetTierOf(key: string): 0 | 1 | 2 {
  return (hashKey(key) % 3) as 0 | 1 | 2;
}

/** Pick the next preset index: random within the tier matching the current
 *  energy, never the current preset; falls back to the whole library when the
 *  tier has no other candidates. `rand` injected for testability. */
export function pickPreset(
  keys: readonly string[],
  currentIndex: number,
  tier: 0 | 1 | 2,
  rand: () => number = Math.random,
): number {
  if (keys.length <= 1) return currentIndex;
  let candidates: number[] = [];
  for (let i = 0; i < keys.length; i++) {
    if (i !== currentIndex && presetTierOf(keys[i]) === tier) candidates.push(i);
  }
  if (!candidates.length) {
    candidates = keys.map((_, i) => i).filter((i) => i !== currentIndex);
  }
  return candidates[Math.min(candidates.length - 1, Math.floor(rand() * candidates.length))];
}

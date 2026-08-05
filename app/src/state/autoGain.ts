// ─────────────────────────────────────────────────────────────────────────────
// Adaptive gain for the visualizers (0.8.6).
//
// Fixed sensitivity cannot serve both a source at full volume and one at 20%:
// a multiplier big enough to make quiet playback react would clip everything
// on loud playback. The 0.8.3 floor change (-60 → -80 dB) made quiet content
// *survive* the pipeline; this makes it *fill* it, by tracking how loud the
// source actually is and boosting toward a target — classic AGC.
//
// Deliberate asymmetries, each covered by a test:
//   - Boost only. Gain never drops below 1, so loud content renders exactly
//     as it does with AGC off.
//   - Slow rise, fast fall. Rising slowly means a beat gap or a quiet bar
//     doesn't pump the visuals; falling fast means the chorus after a quiet
//     intro doesn't blow the display out for seconds.
//   - Silence relaxes toward 1 rather than boosting. Without the gate, the
//     gap between tracks would ride the gain to maximum and amplify the
//     noise floor into a full-scale light show.
//
// Pure module — no React, no audio APIs — so the behaviour is node-testable.
// ─────────────────────────────────────────────────────────────────────────────

/** Where the loudest band should sit after boosting (0..1 scale). Slightly
 *  under 1 so peaks still have somewhere to go. */
export const AGC_TARGET = 0.85;
/** Boost ceiling. 6x ≈ +15.6 dB on top of the -80 dB floor — enough for a
 *  source around 15-20% volume without turning the noise floor into signal. */
export const AGC_MAX_BOOST = 6;
/** Frame peaks below this are treated as silence, not as very quiet music. */
export const AGC_SILENCE = 0.015;

/** Seconds for the gain to rise toward a higher target. */
const RISE_TC = 2.0;
/** Seconds for the gain to fall when content gets loud. */
const FALL_TC = 0.18;
/** Seconds for the gain to relax toward 1 during silence. */
const SILENCE_TC = 4.0;

export interface AutoGain {
  /** Feed one frame's raw peak (pre-sensitivity, 0..1); returns the gain to
   *  multiply into this frame. */
  step(framePeak: number, dtSec: number): number;
}

export function createAutoGain(): AutoGain {
  let gain = 1;
  return {
    step(framePeak: number, dtSec: number): number {
      const dt = Math.max(0, Math.min(0.25, dtSec));
      if (!(framePeak > AGC_SILENCE)) {
        // Silence (or NaN): relax toward neutral so the next track starts
        // sane instead of inheriting a full boost.
        gain += (1 - gain) * Math.min(1, dt / SILENCE_TC);
        return gain;
      }
      const desired = Math.max(1, Math.min(AGC_MAX_BOOST, AGC_TARGET / framePeak));
      const tc = desired < gain ? FALL_TC : RISE_TC;
      gain += (desired - gain) * Math.min(1, dt / tc);
      return gain;
    },
  };
}

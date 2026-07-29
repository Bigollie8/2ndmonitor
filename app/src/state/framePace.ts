/** Fixed-timestep frame acceptance for FPS-capped rAF loops. The naive
 *  `now - last >= minDelta` gate beats against vsync when the cap is close
 *  to but below the display rate (144Hz vs 120 cap → alternating 7/14ms
 *  gaps). Tracking an absolute deadline and advancing it by exactly
 *  minDelta spreads skips evenly. Pure — exported for unit tests. */
export interface PaceState { nextDue: number }

export function paceFrame(now: number, state: PaceState, minDelta: number): boolean {
  if (now < state.nextDue) return false;
  // More than one interval late (stall, tab hidden): re-anchor to now so we
  // don't accept a burst of frames to "catch up".
  state.nextDue = now - state.nextDue > minDelta ? now + minDelta : state.nextDue + minDelta;
  return true;
}

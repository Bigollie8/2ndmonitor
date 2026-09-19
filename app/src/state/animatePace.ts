import { paceFrame } from './framePace';
import { idleFpsCap } from './idlePace';

export function createAnimatePace(now: number) {
  return { nextDue: 0, lastLiveAt: now, blocked: true, live: false, interval: 0 };
}

/** One deadline for all caps. Observe transitions even on rejected frames. */
export function animateFrame(now: number, state: ReturnType<typeof createAnimatePace>,
  blocked: boolean, live: boolean | undefined, maxFps: number): boolean {
  const resumed = state.blocked && !blocked;
  const audioReturned = live === true && !state.live;
  if (live || resumed) state.lastLiveAt = now;
  state.live = live === true;
  state.blocked = blocked;
  if (blocked) return false;
  const idleCap = live === false ? idleFpsCap(now - state.lastLiveAt) : null;
  const cap = Math.min(maxFps > 0 ? maxFps : Infinity, idleCap ?? Infinity);
  const interval = Number.isFinite(cap) ? 1000 / cap : 0;
  if (resumed || audioReturned || interval !== state.interval) state.nextDue = now;
  state.interval = interval;
  return interval === 0 || paceFrame(now, state, interval);
}

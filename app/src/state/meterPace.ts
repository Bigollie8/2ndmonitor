import { paceFrame } from './framePace';

/** Decorative meters consume new audio at up to 30 Hz. Never repeatedly
 * paint an unchanged input on a high-refresh display. An idle transition
 * gets one final paint to settle the meter. */
export function createMeterGate() {
  const pace = { nextDue: 0 };
  let lastFrame: number | undefined;
  let wasLive: boolean | undefined;
  return (now: number, live: boolean, frameId?: number, fpsCap = 30): boolean => {
    if (live === wasLive && (!live || (frameId !== undefined && frameId === lastFrame))) return false;
    if (!paceFrame(now, pace, 1000 / Math.min(30, fpsCap > 0 ? fpsCap : 30))) return false;
    lastFrame = frameId;
    wasLive = live;
    return true;
  };
}

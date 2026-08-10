/** F11 fullscreen converge math (round 5).
 *
 *  Round 4's loop asked for the monitor rect, measured where the window
 *  settled, and — when they disagreed — asked for the SAME rect again. On
 *  Windows an undecorated window can keep an invisible DWM/resize frame, so a
 *  request for 0,0 lands the client area at 8,1 every single pass and the
 *  loop can never converge (the 0.9.4 report: settled 8,1 2560x1440 for
 *  target 0,0 2560x1440, five identical passes, then the diagnostic card).
 *
 *  The fix is a feedback loop: each pass corrects the NEXT request by the
 *  measured miss, so a constant frame offset is cancelled on the second pass
 *  and the client area truly lands on the monitor rect. Pure functions,
 *  because the window plumbing itself cannot run under node:test. */

export interface Rect { x: number; y: number; w: number; h: number }

/** Converged = the measured CLIENT rect covers the target exactly. Right
 *  size at the wrong origin is the reported bug, not success. */
export function atTarget(settled: Rect, target: Rect): boolean {
  return settled.x === target.x && settled.y === target.y
    && settled.w === target.w && settled.h === target.h;
}

/** How far a request may ever stray from the target, per axis. Invisible
 *  window frames are a few pixels, a couple dozen at the outside — while a
 *  measurement that raced a restore animation can miss by an entire monitor.
 *  Feeding THAT back unbounded would park an undecorated, always-on-top
 *  window somewhere no title bar can rescue it from, so corrections saturate
 *  here and a wild read costs one pass instead of the window. */
export const MAX_CORRECTION = 64;

/** The next request, given what we asked for last time and where the window
 *  actually settled: subtract the miss from the last request (not from the
 *  target — corrections must accumulate when the OS honours them partially),
 *  saturating at MAX_CORRECTION from the target on every axis. */
export function correctedRequest(lastRequest: Rect, settled: Rect, target: Rect): Rect {
  const near = (v: number, t: number) =>
    Math.min(t + MAX_CORRECTION, Math.max(t - MAX_CORRECTION, v));
  return {
    x: near(lastRequest.x - (settled.x - target.x), target.x),
    y: near(lastRequest.y - (settled.y - target.y), target.y),
    w: near(lastRequest.w - (settled.w - target.w), target.w),
    h: near(lastRequest.h - (settled.h - target.h), target.h),
  };
}

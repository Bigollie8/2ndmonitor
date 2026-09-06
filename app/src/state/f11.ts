/** F11 fullscreen converge math (round 5) and the converge loop itself
 *  (round 6, 0.9.18).
 *
 *  Round 4's loop asked for the monitor rect, measured where the window
 *  settled, and — when they disagreed — asked for the SAME rect again. On
 *  Windows an undecorated window can keep an invisible DWM/resize frame, so a
 *  request for 0,0 lands the client area at 8,1 every single pass and the
 *  loop can never converge (the 0.9.3 report: settled 8,1 2560x1440 for
 *  target 0,0 2560x1440, five identical passes, then the diagnostic card).
 *
 *  Round 5 made it a feedback loop: each pass corrects the NEXT request by
 *  the measured miss, so a constant frame offset is cancelled on the second
 *  pass and the client area truly lands on the monitor rect.
 *
 *  Round 6 names the frame. The 3-monitor report (target 3440,212, settled
 *  3448,213 — the same +8,+1) is tao's own undecorated-window-with-shadow
 *  geometry, read straight from tao 0.34.8 `platform_impl/windows`:
 *    - WM_NCCALCSIZE shrinks the CLIENT rect inside the window rect by
 *      `calculate_insets_for_dpi`: left/right/bottom = SM_CXSIZEFRAME +
 *      SM_CXPADDEDBORDER (4 + 4 = 8 px at 96 dpi), top = round(dpi/96)
 *      (1 px on Windows 11, 0 on Windows 10).
 *    - `set_outer_position` moves the WINDOW rect (SetWindowPos), while
 *      `inner_position` reports the CLIENT origin (ClientToScreen). So a
 *      request for x lands the client at x + 8: the offset is additive to
 *      whatever is requested, which is exactly what round 5 corrects.
 *    - `set_inner_size` already adds (window − client) to the requested
 *      size, so the client SIZE lands exactly on pass 1 — matching every
 *      report ("size right, origin off").
 *  Because the frame is measurable BEFORE the first request (outer vs inner
 *  origin of the window as it stands), `convergeOnRect` compensates on pass
 *  1 and the feedback loop only has to mop up whatever else Windows does.
 *
 *  Everything here is pure or driver-injected, because the window plumbing
 *  itself cannot run under node:test — `f11.test.ts` drives the real loop
 *  against a model of tao's geometry. */

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

const near = (v: number, t: number) =>
  Math.min(t + MAX_CORRECTION, Math.max(t - MAX_CORRECTION, v));

/** The next request, given what we asked for last time and where the window
 *  actually settled: subtract the miss from the last request (not from the
 *  target — corrections must accumulate when the OS honours them partially),
 *  saturating at MAX_CORRECTION from the target on every axis. */
export function correctedRequest(lastRequest: Rect, settled: Rect, target: Rect): Rect {
  return {
    x: near(lastRequest.x - (settled.x - target.x), target.x),
    y: near(lastRequest.y - (settled.y - target.y), target.y),
    w: near(lastRequest.w - (settled.w - target.w), target.w),
    h: near(lastRequest.h - (settled.h - target.h), target.h),
  };
}

/** The invisible frame between the window rect and the client rect, as the
 *  window currently stands: where the client origin sits relative to the
 *  outer origin, and how much larger the outer size is. Position-independent,
 *  so it can be read wherever the window happens to be. */
export interface Frame { dx: number; dy: number; dw: number; dh: number }

export function measureFrame(
  outer: { x: number; y: number; w: number; h: number },
  inner: { x: number; y: number; w: number; h: number },
): Frame {
  return { dx: inner.x - outer.x, dy: inner.y - outer.y, dw: outer.w - inner.w, dh: outer.h - inner.h };
}

/** The first request, pre-compensated for a measured frame. setPosition
 *  moves the OUTER origin and the client sits `frame.dx/dy` inside it, so
 *  ask for the outer origin that puts the client on the target. setSize is
 *  a CLIENT size (tao adds the frame itself), so the size is requested as
 *  is. Saturated like every other request: a wild pre-measurement must not
 *  be able to fling the window either. */
export function frameCompensatedRequest(target: Rect, frame: Frame): Rect {
  return {
    x: near(target.x - frame.dx, target.x),
    y: near(target.y - frame.dy, target.y),
    w: target.w,
    h: target.h,
  };
}

/** The slice of the Tauri window API the loop needs, in physical pixels.
 *  App.tsx adapts `getCurrentWindow()`; tests supply a model. */
export interface WindowDriver {
  setPosition(x: number, y: number): Promise<void>;
  setSize(w: number, h: number): Promise<void>;
  innerPosition(): Promise<{ x: number; y: number }>;
  innerSize(): Promise<{ w: number; h: number }>;
  outerPosition(): Promise<{ x: number; y: number }>;
  outerSize(): Promise<{ w: number; h: number }>;
  /** Let Windows apply the async SetWindowPos before measuring. */
  wait(ms: number): Promise<void>;
}

export interface ConvergeOptions {
  /** Attempts before giving up. */
  passes?: number;
  /** Settle time after each apply, ms. */
  settleMs?: number;
  /** Called on every miss with the pass number — App.tsx logs it. */
  onMiss?: (pass: number, settled: Rect, request: Rect) => void;
}

export interface ConvergeResult {
  converged: boolean;
  /** Where the client rect was last measured. */
  settled: Rect;
  /** The last request actually sent to the window. */
  request: Rect;
  /** Passes spent (1 = landed first time). */
  passes: number;
  /** The frame measured before the first request — the diagnostic card
   *  shows it so a report tells us whether the offset was the frame. */
  frame: Frame;
}

/** Ask, measure, correct — up to `passes` times — until the CLIENT rect
 *  covers `target`. Pass 1 is already compensated for the measured frame;
 *  every later pass feeds back the miss (round 5). Never moves the window
 *  further than MAX_CORRECTION from the target on any axis. Does NOT park
 *  the window on failure — the caller decides what to do with the evidence. */
export async function convergeOnRect(
  win: WindowDriver,
  target: Rect,
  opts: ConvergeOptions = {},
): Promise<ConvergeResult> {
  const passes = opts.passes ?? 5;
  const settleMs = opts.settleMs ?? 120;
  // Pre-measure the frame from the window as it stands. Both reads are of
  // the same window state, so a mid-animation window still yields the right
  // OFFSET even if its absolute position is nonsense.
  let frame: Frame = { dx: 0, dy: 0, dw: 0, dh: 0 };
  try {
    const [op, os, ip, is] = await Promise.all([
      win.outerPosition(), win.outerSize(), win.innerPosition(), win.innerSize(),
    ]);
    frame = measureFrame({ x: op.x, y: op.y, w: os.w, h: os.h }, { x: ip.x, y: ip.y, w: is.w, h: is.h });
  } catch { /* fall back to the plain target; the feedback loop still works */ }
  let req = frameCompensatedRequest(target, frame);
  let settled: Rect = { x: 0, y: 0, w: 0, h: 0 };
  for (let attempt = 1; attempt <= passes; attempt++) {
    await win.setPosition(req.x, req.y);
    await win.setSize(req.w, req.h);
    await win.wait(settleMs);
    const p = await win.innerPosition();
    const s = await win.innerSize();
    settled = { x: p.x, y: p.y, w: s.w, h: s.h };
    if (atTarget(settled, target)) {
      return { converged: true, settled, request: req, passes: attempt, frame };
    }
    opts.onMiss?.(attempt, settled, req);
    // Correct only while another pass remains to send it — the diagnostic
    // card's `request` line must show what was actually asked of Windows,
    // not a correction that never went out.
    if (attempt < passes) req = correctedRequest(req, settled, target);
  }
  return { converged: false, settled, request: req, passes, frame };
}

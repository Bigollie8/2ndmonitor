import test from 'node:test';
import assert from 'node:assert/strict';
import {
  atTarget, correctedRequest, convergeOnRect, frameCompensatedRequest, measureFrame,
  MAX_CORRECTION, type Rect, type WindowDriver,
} from './f11';

// The reporter's setup (0.9.3): single 2560x1440 monitor at 0,0, scale 1.
// Requesting 0,0 landed the client area at 8,1 — the invisible frame of an
// undecorated Windows window — and the old loop re-requested 0,0 forever.
const TARGET: Rect = { x: 0, y: 0, w: 2560, h: 1440 };

test('atTarget is an exact cover of the monitor rect', () => {
  assert.equal(atTarget({ x: 0, y: 0, w: 2560, h: 1440 }, TARGET), true);
  // The reported bug: right size, wrong origin — must NOT count as converged.
  assert.equal(atTarget({ x: 8, y: 1, w: 2560, h: 1440 }, TARGET), false);
  assert.equal(atTarget({ x: 0, y: 0, w: 2576, h: 1479 }, TARGET), false);
});

test('correctedRequest feeds the measured miss back into the next request', () => {
  // Asked for 0,0 2560x1440, settled at 8,1 2560x1440 → ask for -8,-1 next.
  const next = correctedRequest(TARGET, { x: 8, y: 1, w: 2560, h: 1440 }, TARGET);
  assert.deepEqual(next, { x: -8, y: -1, w: 2560, h: 1440 });
});

test('a constant frame offset converges in one correction', () => {
  // Model the OS the reporter saw: every request lands +8,+1 from where it
  // was asked, size honoured exactly.
  const settle = (req: Rect): Rect => ({ x: req.x + 8, y: req.y + 1, w: req.w, h: req.h });
  let req = TARGET;
  let settled = settle(req);
  assert.equal(atTarget(settled, TARGET), false);
  req = correctedRequest(req, settled, TARGET);
  settled = settle(req);
  assert.equal(atTarget(settled, TARGET), true, 'second pass must land the client at 0,0');
});

test('a well-behaved OS converges on the first pass with no correction drift', () => {
  const settled = { ...TARGET };
  assert.equal(atTarget(settled, TARGET), true);
  // Even if correction were computed, a zero miss changes nothing.
  assert.deepEqual(correctedRequest(TARGET, settled, TARGET), TARGET);
});

test('negative-origin monitors correct the same way', () => {
  // display1 at -2560,0 on the reporter's own setup.
  const target: Rect = { x: -2560, y: 0, w: 2560, h: 1440 };
  const settle = (req: Rect): Rect => ({ x: req.x + 8, y: req.y + 1, w: req.w, h: req.h });
  let req = target;
  req = correctedRequest(req, settle(req), target);
  assert.deepEqual(req, { x: -2568, y: -1, w: 2560, h: 1440 });
  assert.equal(atTarget(settle(req), target), true);
});

test('a size miss is corrected too, not only position', () => {
  // An OS that pads the frame into the size: settled 16 wider, 39 taller.
  const settled: Rect = { x: 0, y: 0, w: 2576, h: 1479 };
  const next = correctedRequest(TARGET, settled, TARGET);
  assert.deepEqual(next, { x: 0, y: 0, w: 2544, h: 1401 });
});

test('a wild transient measurement cannot fling the request off-screen', () => {
  // The read raced a restore animation: settled reports the old windowed
  // rect, nowhere near the monitor. An unbounded correction would request
  // -1200,-700 — parking an undecorated, always-on-top window somewhere
  // unreachable. Corrections stay within a frame-sized bound of the target.
  const settled: Rect = { x: 1200, y: 700, w: 900, h: 600 };
  const next = correctedRequest(TARGET, settled, TARGET);
  assert.deepEqual(next, {
    x: -MAX_CORRECTION, y: -MAX_CORRECTION,
    w: 2560 + MAX_CORRECTION, h: 1440 + MAX_CORRECTION,
  });
});

test('the bound holds across passes — accumulation cannot creep past it', () => {
  const settle = (req: Rect): Rect => ({ x: req.x + 100, y: req.y, w: req.w, h: req.h });
  let req = TARGET;
  for (let i = 0; i < 5; i++) {
    req = correctedRequest(req, settle(req), TARGET);
    assert.ok(Math.abs(req.x - TARGET.x) <= MAX_CORRECTION, `pass ${i}: ${req.x}`);
  }
});

test('corrections accumulate across passes rather than resetting to the target', () => {
  // An OS that only honours half the correction each time still converges,
  // because each pass corrects from the LAST REQUEST, not from the target.
  const settle = (req: Rect): Rect => ({ x: req.x + 8, y: req.y + 1, w: req.w, h: req.h });
  let req: Rect = { x: -4, y: 0, w: 2560, h: 1440 }; // partway corrected already
  const settled = settle(req); // 4,1
  req = correctedRequest(req, settled, TARGET);
  assert.deepEqual(req, { x: -8, y: -1, w: 2560, h: 1440 });
});

// ─────────────────────────────────────────────────────────────────────────────
// Round 6 (0.9.18): drive the REAL loop against a model of tao 0.34.8's
// undecorated-window-with-shadow geometry (platform_impl/windows):
//   client origin = outer origin + insets (left 8, top 1 on Windows 11)
//   set_outer_position moves the OUTER origin
//   set_inner_size requests a CLIENT size (tao adds outer−client itself)
// The 3-monitor report: target 3440,212 1920x1080, settled 3448,213 1920x1080.
// ─────────────────────────────────────────────────────────────────────────────

interface Insets { left: number; top: number; right: number; bottom: number }
const WIN11_INSETS: Insets = { left: 8, top: 1, right: 8, bottom: 8 };
const DISPLAY3: Rect = { x: 3440, y: 212, w: 1920, h: 1080 };

/** A tao-shaped window: state is the OUTER rect; the client sits inside it. */
function taoWindow(outer: Rect, insets: Insets = WIN11_INSETS) {
  const calls: string[] = [];
  const st = { outer: { ...outer }, insets };
  const driver: WindowDriver = {
    async setPosition(x, y) { calls.push(`pos ${x},${y}`); st.outer.x = x; st.outer.y = y; },
    async setSize(w, h) {
      calls.push(`size ${w}x${h}`);
      // tao set_inner_size: desired += (window − client); client then lands on w×h.
      st.outer.w = w + st.insets.left + st.insets.right;
      st.outer.h = h + st.insets.top + st.insets.bottom;
    },
    async innerPosition() { return { x: st.outer.x + st.insets.left, y: st.outer.y + st.insets.top }; },
    async innerSize() {
      return { w: st.outer.w - st.insets.left - st.insets.right, h: st.outer.h - st.insets.top - st.insets.bottom };
    },
    async outerPosition() { return { x: st.outer.x, y: st.outer.y }; },
    async outerSize() { return { w: st.outer.w, h: st.outer.h }; },
    async wait() { /* no real time in tests */ },
  };
  return { driver, calls, st };
}

test('measureFrame reads the +8,+1 shadow insets off the standing window', () => {
  // The reporter's pre-F11 window: outer 3440,235 1936x1048.
  const frame = measureFrame(
    { x: 3440, y: 235, w: 1936, h: 1048 },
    { x: 3448, y: 236, w: 1920, h: 1039 },
  );
  assert.deepEqual(frame, { dx: 8, dy: 1, dw: 16, dh: 9 });
});

test('frameCompensatedRequest asks for the OUTER origin that lands the client on the target', () => {
  const req = frameCompensatedRequest(DISPLAY3, { dx: 8, dy: 1, dw: 16, dh: 9 });
  // Position pre-shifted by the frame; size requested as the client size
  // (tao adds the frame to that itself).
  assert.deepEqual(req, { x: 3432, y: 211, w: 1920, h: 1080 });
  // Saturates like every other request.
  const wild = frameCompensatedRequest(DISPLAY3, { dx: 500, dy: -500, dw: 0, dh: 0 });
  assert.deepEqual(wild, { x: 3440 - MAX_CORRECTION, y: 212 + MAX_CORRECTION, w: 1920, h: 1080 });
});

test('the 3-monitor report: +8,+1 shadow insets converge on DISPLAY3 in one pass', async () => {
  const { driver, st } = taoWindow({ x: 3440, y: 235, w: 1936, h: 1048 });
  const misses: number[] = [];
  const r = await convergeOnRect(driver, DISPLAY3, { onMiss: (p) => misses.push(p) });
  assert.equal(r.converged, true);
  assert.equal(r.passes, 1, 'the pre-measured frame lands the first request');
  assert.deepEqual(r.settled, DISPLAY3);
  assert.deepEqual(r.frame, { dx: 8, dy: 1, dw: 16, dh: 9 });
  assert.deepEqual(misses, []);
  // And the OUTER window really sits 8,1 up-left of the monitor, 16x9 larger —
  // the invisible frame hangs off the monitor edge, the client covers it.
  assert.deepEqual(st.outer, { x: 3432, y: 211, w: 1936, h: 1089 });
});

test('without a usable pre-measurement the feedback loop still converges by pass 2', async () => {
  const { driver } = taoWindow({ x: 3440, y: 235, w: 1936, h: 1048 });
  // Pre-measurement unavailable (e.g. the read threw) → plain target first.
  const blind: WindowDriver = { ...driver, outerPosition: async () => { throw new Error('nope'); } };
  const r = await convergeOnRect(blind, DISPLAY3);
  assert.equal(r.converged, true);
  assert.equal(r.passes, 2, 'round 5 behaviour: the constant +8,+1 cancels on the second pass');
  assert.deepEqual(r.settled, DISPLAY3);
});

test('a frame that changes between pre-measure and the first apply is mopped up by feedback', async () => {
  // Pre-measured with Windows 10 insets (top 0), but the style change lands
  // Windows 11 insets before the first apply — the loop must not trust the
  // pre-measurement blindly.
  const model = taoWindow({ x: 0, y: 0, w: 1000, h: 700 }, { left: 8, top: 0, right: 8, bottom: 8 });
  let applied = false;
  const driver: WindowDriver = {
    ...model.driver,
    async setPosition(x, y) {
      if (!applied) { model.st.insets = WIN11_INSETS; applied = true; }
      return model.driver.setPosition(x, y);
    },
  };
  const target: Rect = { x: -1920, y: 351, w: 1920, h: 1080 }; // DISPLAY2 in the report
  const r = await convergeOnRect(driver, target);
  assert.equal(r.converged, true);
  assert.ok(r.passes <= 2, `passes ${r.passes}`);
  assert.deepEqual(r.settled, target);
});

test('Windows 10 (no top inset) converges first pass too', async () => {
  const { driver } = taoWindow({ x: 100, y: 100, w: 800, h: 600 }, { left: 8, top: 0, right: 8, bottom: 8 });
  const r = await convergeOnRect(driver, { x: 0, y: 0, w: 2560, h: 1440 });
  assert.equal(r.converged, true);
  assert.equal(r.passes, 1);
});

test('a window that refuses to move gives up after the pass budget, request still bounded', async () => {
  const { driver } = taoWindow({ x: 3440, y: 235, w: 1936, h: 1048 });
  // Windows ignores every position request: outer origin stays put.
  const stuck: WindowDriver = { ...driver, async setPosition() { /* ignored */ } };
  const misses: number[] = [];
  const r = await convergeOnRect(stuck, DISPLAY3, { passes: 5, onMiss: (p) => misses.push(p) });
  assert.equal(r.converged, false);
  assert.equal(r.passes, 5);
  assert.deepEqual(misses, [1, 2, 3, 4, 5]);
  assert.ok(Math.abs(r.request.x - DISPLAY3.x) <= MAX_CORRECTION);
  assert.ok(Math.abs(r.request.y - DISPLAY3.y) <= MAX_CORRECTION);
  // The evidence for the card: settled shows the residual, frame shows why.
  assert.deepEqual(r.settled, { x: 3448, y: 236, w: 1920, h: 1080 });
  assert.deepEqual(r.frame, { dx: 8, dy: 1, dw: 16, dh: 9 });
});

test('a frameless window (macOS-like, inner == outer) lands first pass with no correction', async () => {
  const { driver, calls } = taoWindow({ x: 50, y: 50, w: 900, h: 600 }, { left: 0, top: 0, right: 0, bottom: 0 });
  const r = await convergeOnRect(driver, { x: 0, y: 0, w: 2560, h: 1440 });
  assert.equal(r.converged, true);
  assert.equal(r.passes, 1);
  assert.deepEqual(calls, ['pos 0,0', 'size 2560x1440']);
});

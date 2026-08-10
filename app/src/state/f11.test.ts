import test from 'node:test';
import assert from 'node:assert/strict';
import { atTarget, correctedRequest, MAX_CORRECTION, type Rect } from './f11';

// The reporter's setup (0.9.4): single 2560x1440 monitor at 0,0, scale 1.
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

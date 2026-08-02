import { test } from 'node:test';
import assert from 'node:assert/strict';

import { clampPanelOffset } from './panelDrag';

const VIEWPORT = { w: 1920, h: 1080 };
// A panel like the edit-mode Layers panel: anchored bottom-left-ish.
const LAYERS = { left: 16, top: 800, width: 240, height: 264 };
// A panel like the Properties panel: anchored top-right.
const PROPS = { left: 1624, top: 80, width: 280, height: 400 };

test('clampPanelOffset: offset inside the viewport passes through unchanged', () => {
  assert.deepEqual(clampPanelOffset({ x: 100, y: -50 }, LAYERS, VIEWPORT), { x: 100, y: -50 });
});

test('clampPanelOffset: zero offset is always allowed for an on-screen panel', () => {
  assert.deepEqual(clampPanelOffset({ x: 0, y: 0 }, PROPS, VIEWPORT), { x: 0, y: 0 });
});

test('clampPanelOffset: dragging past the left/top edges pins the panel at 0,0', () => {
  const c = clampPanelOffset({ x: -9999, y: -9999 }, LAYERS, VIEWPORT);
  assert.equal(LAYERS.left + c.x, 0);
  assert.equal(LAYERS.top + c.y, 0);
});

test('clampPanelOffset: dragging past the right/bottom edges pins the panel flush to them', () => {
  const c = clampPanelOffset({ x: 9999, y: 9999 }, LAYERS, VIEWPORT);
  assert.equal(LAYERS.left + c.x + LAYERS.width, VIEWPORT.w);
  assert.equal(LAYERS.top + c.y + LAYERS.height, VIEWPORT.h);
});

test('clampPanelOffset: a panel taller than the viewport keeps its top edge (header) visible', () => {
  const tall = { left: 16, top: 80, width: 280, height: 2000 };
  const c = clampPanelOffset({ x: 0, y: 9999 }, tall, VIEWPORT);
  assert.equal(tall.top + c.y, 0);
});

test('clampPanelOffset: a panel wider than the viewport keeps its left edge visible', () => {
  const wide = { left: 16, top: 80, width: 4000, height: 200 };
  const c = clampPanelOffset({ x: 9999, y: 0 }, wide, VIEWPORT);
  assert.equal(wide.left + c.x, 0);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { storeLayoutFor } from './storeLayout';

test('wide: sidebar plus a detail pane beside the grid', () => {
  const l = storeLayoutFor(1600);
  assert.equal(l.mode, 'wide');
  assert.equal(l.showSidebar, true);
  assert.equal(l.detailAsPane, true);
});

test('medium: no sidebar, detail takes the whole body', () => {
  const l = storeLayoutFor(900);
  assert.equal(l.mode, 'medium');
  assert.equal(l.showSidebar, false);
  assert.equal(l.detailAsPane, false);
});

test('narrow: single column, still no sidebar', () => {
  const l = storeLayoutFor(600);
  assert.equal(l.mode, 'narrow');
  assert.equal(l.showSidebar, false);
  assert.equal(l.detailAsPane, false);
});

test('boundaries are inclusive at the lower edge of each band', () => {
  assert.equal(storeLayoutFor(1100).mode, 'wide');
  assert.equal(storeLayoutFor(1099).mode, 'medium');
  assert.equal(storeLayoutFor(700).mode, 'medium');
  assert.equal(storeLayoutFor(699).mode, 'narrow');
});

test('a portrait second monitor gets the narrow treatment, not a squeezed sidebar', () => {
  // This app runs orientation-aware dashboards; a 1080x1920 panel is a real
  // configuration, not a hypothetical.
  const l = storeLayoutFor(1080);
  assert.equal(l.showSidebar, false, 'a 1080-wide portrait panel cannot afford 180px of rail');
});

test('cards get wider minimums as the window narrows, so a narrow window is not a column of slivers', () => {
  assert.ok(storeLayoutFor(600).cardMin >= storeLayoutFor(1600).cardMin);
});

test('a zero or negative width does not produce a broken layout', () => {
  const l = storeLayoutFor(0);
  assert.equal(l.mode, 'narrow');
  assert.ok(l.cardMin > 0);
});

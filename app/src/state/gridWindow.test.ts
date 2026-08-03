import test from 'node:test';
import assert from 'node:assert/strict';
import { gridWindowFor } from './gridWindow';

const base = {
  total: 100, scrollTop: 0, viewportHeight: 600,
  containerWidth: 1000, cardMin: 210, rowHeight: 220, gap: 10,
};

test('columns fall out of the container width and the card minimum', () => {
  assert.equal(gridWindowFor({ ...base, containerWidth: 1000 }).columns, 4);
  assert.equal(gridWindowFor({ ...base, containerWidth: 500 }).columns, 2);
});

test('there is always at least one column, however narrow the container', () => {
  assert.equal(gridWindowFor({ ...base, containerWidth: 50 }).columns, 1);
  assert.equal(gridWindowFor({ ...base, containerWidth: 0 }).columns, 1);
});

test('at the top, the window starts at the first item', () => {
  assert.equal(gridWindowFor(base).firstIndex, 0);
  assert.equal(gridWindowFor(base).padTop, 0);
});

test('scrolling down advances the window and pads the space above', () => {
  const w = gridWindowFor({ ...base, scrollTop: 2300 });
  assert.ok(w.firstIndex > 0);
  assert.ok(w.padTop > 0);
});

test('the window never runs past the end', () => {
  const w = gridWindowFor({ ...base, total: 7, scrollTop: 99999 });
  assert.equal(w.lastIndex, 6);
  assert.equal(w.padBottom, 0);
});

test('an empty list produces an empty window rather than a negative range', () => {
  const w = gridWindowFor({ ...base, total: 0 });
  assert.equal(w.firstIndex, 0);
  assert.equal(w.lastIndex, -1);
  assert.equal(w.padTop, 0);
  assert.equal(w.padBottom, 0);
});

test('overscan renders whole rows above and below, so scrolling does not flash blanks', () => {
  const tight = gridWindowFor({ ...base, scrollTop: 2300, overscanRows: 0 });
  const loose = gridWindowFor({ ...base, scrollTop: 2300, overscanRows: 3 });
  assert.ok(loose.firstIndex < tight.firstIndex);
  assert.ok(loose.lastIndex > tight.lastIndex);
});

test('the window always covers the visible rows', () => {
  const w = gridWindowFor({ ...base, scrollTop: 1000, overscanRows: 0 });
  const rowOf = (i: number) => Math.floor(i / w.columns);
  const firstVisibleRow = Math.floor(1000 / (base.rowHeight + base.gap));
  assert.ok(rowOf(w.firstIndex) <= firstVisibleRow);
});

test('padTop plus rendered rows plus padBottom equals the full scroll height', () => {
  const w = gridWindowFor({ ...base, scrollTop: 1500 });
  const rows = Math.ceil(base.total / w.columns);
  const full = rows * (base.rowHeight + base.gap);
  const rendered = (Math.floor(w.lastIndex / w.columns) - Math.floor(w.firstIndex / w.columns) + 1)
    * (base.rowHeight + base.gap);
  assert.equal(w.padTop + rendered + w.padBottom, full,
    'a mismatch here makes the scrollbar jump as you scroll');
});

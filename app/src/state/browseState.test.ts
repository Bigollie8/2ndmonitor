import test from 'node:test';
import assert from 'node:assert/strict';
import { browseReducer, INITIAL_BROWSE } from './browseState';
import { EMPTY_FACETS } from './catalogFilter';

test('browseReducer: opening a shelf goes to the grid with that shelf\'s facets and sort', () => {
  const s = browseReducer(INITIAL_BROWSE, {
    type: 'open-shelf', facets: { ...EMPTY_FACETS, kind: 'tile' }, sort: 'installs',
  });
  assert.equal(s.view, 'grid');
  assert.equal(s.facets.kind, 'tile');
  assert.equal(s.sort, 'installs');
});

test('browseReducer: opening detail pushes the previous state so back restores it', () => {
  const grid = browseReducer(INITIAL_BROWSE, {
    type: 'open-shelf', facets: { ...EMPTY_FACETS, category: 'weather' }, sort: 'name',
  });
  const detail = browseReducer(grid, { type: 'open-detail', key: 'tile:radar' });
  assert.equal(detail.view, 'detail');
  assert.equal(detail.selectedKey, 'tile:radar');

  const back = browseReducer(detail, { type: 'back' });
  assert.equal(back.view, 'grid');
  assert.equal(back.facets.category, 'weather', 'filters must survive the round trip');
});

test('browseReducer: back from the grid returns to discover', () => {
  const grid = browseReducer(INITIAL_BROWSE, {
    type: 'open-shelf', facets: EMPTY_FACETS, sort: 'name',
  });
  assert.equal(browseReducer(grid, { type: 'back' }).view, 'discover');
});

test('browseReducer: back at discover is a no-op the caller can detect', () => {
  const s = browseReducer(INITIAL_BROWSE, { type: 'back' });
  assert.equal(s, INITIAL_BROWSE, 'same reference means "nothing to pop, close the store"');
});

test('browseReducer: the stack does not grow without bound', () => {
  let s = INITIAL_BROWSE;
  for (let i = 0; i < 50; i++) s = browseReducer(s, { type: 'open-detail', key: `k${i}` });
  assert.ok(s.stack.length <= 16, `stack grew to ${s.stack.length}`);
});

test('browseReducer: typing a query moves off discover into the grid', () => {
  const s = browseReducer(INITIAL_BROWSE, { type: 'set-query', query: 'radar' });
  assert.equal(s.view, 'grid', 'a search with no results surface would show nothing');
  assert.equal(s.query, 'radar');
  assert.equal(s.sort, 'relevance', 'searching implies relevance ordering');
});

test('browseReducer: clearing the query returns to discover when no facets are set', () => {
  const searched = browseReducer(INITIAL_BROWSE, { type: 'set-query', query: 'radar' });
  const cleared = browseReducer(searched, { type: 'set-query', query: '' });
  assert.equal(cleared.view, 'discover');
});

test('browseReducer: clearing the query keeps the grid when facets are set', () => {
  let s = browseReducer(INITIAL_BROWSE, {
    type: 'open-shelf', facets: { ...EMPTY_FACETS, kind: 'tile' }, sort: 'name',
  });
  s = browseReducer(s, { type: 'set-query', query: 'x' });
  s = browseReducer(s, { type: 'set-query', query: '' });
  assert.equal(s.view, 'grid');
  assert.equal(s.facets.kind, 'tile');
});

test('browseReducer: toggling a tag adds then removes it', () => {
  const on = browseReducer(INITIAL_BROWSE, { type: 'toggle-tag', tag: 'rain' });
  assert.deepEqual(on.facets.tags, ['rain']);
  assert.equal(on.view, 'grid');
  const off = browseReducer(on, { type: 'toggle-tag', tag: 'rain' });
  assert.deepEqual(off.facets.tags, []);
});

test('browseReducer: reset returns to the initial state', () => {
  let s = browseReducer(INITIAL_BROWSE, { type: 'set-query', query: 'x' });
  s = browseReducer(s, { type: 'open-detail', key: 'k' });
  assert.deepEqual(browseReducer(s, { type: 'reset' }), INITIAL_BROWSE);
});

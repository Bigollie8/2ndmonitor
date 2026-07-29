import test from 'node:test';
import assert from 'node:assert';
import { NEW_VIZ_CODE, newVizManifest } from './template';
import { validateManifest } from './manifest';

test('template manifest validates', () => {
  const r = validateManifest(JSON.parse(newVizManifest('my-first-viz')));
  assert.ok(r.ok, !r.ok ? r.error : '');
});

test('template code is syntactically valid', () => {
  new Function(NEW_VIZ_CODE);
});

test('template code registers a frame handler', () => {
  assert.ok(NEW_VIZ_CODE.includes("viz.on('frame'"));
});

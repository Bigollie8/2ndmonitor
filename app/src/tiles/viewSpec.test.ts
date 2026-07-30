import test from 'node:test';
import assert from 'node:assert/strict';
import { validateViewSpec } from './viewSpec';

const ok = {
  source: { kind: 'http', url: 'https://api.example.com/x', intervalMs: 60000 },
  select: 'items',
  view: { type: 'list', row: { title: '{{item.name}}' } },
};

test('validateViewSpec: accepts a minimal http list spec', () => {
  const r = validateViewSpec(ok);
  assert.equal(r.ok, true);
});

test('validateViewSpec: rejects a non-object', () => {
  assert.equal(validateViewSpec(null).ok, false);
  assert.equal(validateViewSpec([]).ok, false);
});

test('validateViewSpec: http source must be https', () => {
  const r = validateViewSpec({ ...ok, source: { kind: 'http', url: 'http://x.com', intervalMs: 60000 } });
  assert.equal(r.ok, false);
});

test('validateViewSpec: intervalMs has a floor of 15s to protect upstreams', () => {
  const r = validateViewSpec({ ...ok, source: { kind: 'http', url: 'https://x.com', intervalMs: 1000 } });
  assert.equal(r.ok, false);
});

test('validateViewSpec: rejects an unknown view type', () => {
  const r = validateViewSpec({ ...ok, view: { type: 'canvas' } });
  assert.equal(r.ok, false);
});

test('validateViewSpec: accepts each of the five primitives', () => {
  for (const view of [
    { type: 'list', row: { title: '{{item.a}}' } },
    { type: 'stat', value: '{{data.n}}', label: 'Count' },
    { type: 'rows', rows: [{ label: 'A', value: '{{data.a}}' }] },
    { type: 'text', body: '{{data.t}}' },
    { type: 'badge', value: '{{data.s}}' },
  ]) {
    const r = validateViewSpec({ ...ok, view });
    assert.equal(r.ok, true, `${view.type} should validate: ${r.ok ? '' : r.error}`);
  }
});

test('validateViewSpec: {{secret.x}} is allowed in url and headers', () => {
  const r = validateViewSpec({
    ...ok,
    source: {
      kind: 'http', url: 'https://x.com/{{secret.k}}', intervalMs: 60000,
      headers: { Authorization: 'Bearer {{secret.token}}' },
    },
  });
  assert.equal(r.ok, true);
});

test('validateViewSpec: {{secret.x}} anywhere in view is rejected', () => {
  const r = validateViewSpec({ ...ok, view: { type: 'text', body: 'token is {{secret.token}}' } });
  assert.equal(r.ok, false);
  assert.match(r.ok ? '' : r.error, /secret/i);
});

test('validateViewSpec: tauri source requires a command name', () => {
  assert.equal(validateViewSpec({ ...ok, source: { kind: 'tauri', intervalMs: 60000 } }).ok, false);
  assert.equal(validateViewSpec({ ...ok, source: { kind: 'tauri', command: 'docker_ps', intervalMs: 60000 } }).ok, true);
});

test('validateViewSpec: rejects an unknown source kind', () => {
  assert.equal(validateViewSpec({ ...ok, source: { kind: 'ftp', intervalMs: 60000 } }).ok, false);
});

test('validateViewSpec: select must be a dot-path, not an expression', () => {
  assert.equal(validateViewSpec({ ...ok, select: 'items[0].x' }).ok, false);
  assert.equal(validateViewSpec({ ...ok, select: 'a.b.c' }).ok, true);
});

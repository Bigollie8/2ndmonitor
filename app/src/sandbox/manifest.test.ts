import test from 'node:test';
import assert from 'node:assert';
import { validateManifest } from './manifest';

const good = { id: 'my-viz1', name: 'My Viz', version: '1.0.0', api: 1, permissions: [] };

test('valid manifest passes and echoes fields', () => {
  const r = validateManifest(good);
  assert.ok(r.ok);
  if (r.ok) {
    assert.equal(r.manifest.id, 'my-viz1');
    assert.equal(r.manifest.api, 1);
  }
});

test('optional author accepted', () => {
  assert.ok(validateManifest({ ...good, author: 'oliver' }).ok);
});

test('rejects wrong api version', () => {
  const r = validateManifest({ ...good, api: 2 });
  assert.ok(!r.ok);
  if (!r.ok) assert.match(r.error, /api/);
});

test('rejects bad ids', () => {
  for (const id of ['../x', 'A B', '', 'x'.repeat(65), 'UPPER', 'dot.dot']) {
    const r = validateManifest({ ...good, id });
    assert.ok(!r.ok, `id ${JSON.stringify(id)} should fail`);
  }
});

test('rejects non-empty permissions in api 1', () => {
  const r = validateManifest({ ...good, permissions: ['net'] });
  assert.ok(!r.ok);
  if (!r.ok) assert.match(r.error, /permissions/);
});

test('rejects non-objects and missing fields', () => {
  assert.ok(!validateManifest(null).ok);
  assert.ok(!validateManifest('x').ok);
  assert.ok(!validateManifest({ id: 'a' }).ok);
});

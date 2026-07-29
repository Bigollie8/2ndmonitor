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

// ── Phase 3: permission grammar ──────────────────────────────────────────────

import { parsePermission } from './manifest';

test('parsePermission accepts valid net and tauri perms', () => {
  const n = parsePermission('net:api.open-meteo.com');
  assert.ok(n.ok && n.perm.kind === 'net' && n.perm.host === 'api.open-meteo.com');
  const t = parsePermission('tauri:get_system_stats');
  assert.ok(t.ok && t.perm.kind === 'tauri' && t.perm.command === 'get_system_stats');
});

test('parsePermission rejects urls, ports, paths, bad commands', () => {
  for (const bad of ['net:https://x.y', 'net:x.y/path', 'net:x.y:8080', 'net:', 'net:a b', 'tauri:Bad-Cmd', 'shell:run']) {
    assert.ok(!parsePermission(bad).ok, `${bad} should fail`);
  }
});

test('local manifests still reject permissions; allowPermissions accepts them', () => {
  const withPerms = { ...good, permissions: ['net:api.weather.com'] };
  assert.ok(!validateManifest(withPerms).ok);
  const r = validateManifest(withPerms, { allowPermissions: true });
  assert.ok(r.ok);
  if (r.ok) assert.deepEqual(r.manifest.permissions, ['net:api.weather.com']);
});

test('allowPermissions still validates grammar and caps at 16', () => {
  assert.ok(!validateManifest({ ...good, permissions: ['net:bad host'] }, { allowPermissions: true }).ok);
  const many = Array.from({ length: 17 }, (_, i) => `net:h${i}.example.com`);
  assert.ok(!validateManifest({ ...good, permissions: many }, { allowPermissions: true }).ok);
});

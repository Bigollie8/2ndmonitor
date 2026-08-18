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

// ── secret:<key> permission + secrets/config manifest fields ────────────────

test('parsePermission: accepts secret:<key>', () => {
  const r = parsePermission('secret:github_pat');
  assert.equal(r.ok, true);
  assert.deepEqual(r.ok && r.perm, { kind: 'secret', key: 'github_pat' });
});

test('parsePermission: rejects a malformed secret key', () => {
  assert.equal(parsePermission('secret:').ok, false);
  assert.equal(parsePermission('secret:Has Space').ok, false);
  assert.equal(parsePermission('secret:UPPER').ok, false);
});

test('validateManifest: accepts secrets and config declarations', () => {
  const r = validateManifest({
    id: 'x', name: 'X', version: '1.0.0', api: 1,
    permissions: ['secret:token'],
    secrets: [{ key: 'token', label: 'API token', kind: 'password' }],
    config: [{ key: 'symbols', label: 'Symbols', type: 'text' }],
  }, { allowPermissions: true });
  assert.equal(r.ok, true);
});

test('validateManifest: a declared secret must have a matching secret: permission', () => {
  const r = validateManifest({
    id: 'x', name: 'X', version: '1.0.0', api: 1,
    permissions: [],
    secrets: [{ key: 'token', label: 'API token', kind: 'password' }],
  }, { allowPermissions: true });
  assert.equal(r.ok, false);
  assert.match(r.ok ? '' : r.error, /secret:token/);
});

test('validateManifest: a secret: permission with no secrets array at all is rejected', () => {
  const r = validateManifest({
    id: 'x', name: 'X', version: '1.0.0', api: 1,
    permissions: ['secret:token'],
  }, { allowPermissions: true });
  assert.equal(r.ok, false);
  assert.match(r.ok ? '' : r.error, /secret:token/);
});

test('validateManifest: a secret: permission not covered by any secrets entry is rejected', () => {
  const r = validateManifest({
    id: 'x', name: 'X', version: '1.0.0', api: 1,
    // 'other' is present and matched (satisfies the forward rule) so this
    // isolates the reverse rule: 'token' has a permission but no secrets entry.
    permissions: ['secret:token', 'secret:other'],
    secrets: [{ key: 'other', label: 'Other', kind: 'text' }],
  }, { allowPermissions: true });
  assert.equal(r.ok, false);
  assert.match(r.ok ? '' : r.error, /secret:token/);
});

function secretsOf(n: number) {
  return Array.from({ length: n }, (_, i) => ({ key: `key${i}`, label: `key${i}`, kind: 'text' as const }));
}
function permsOf(n: number) {
  return Array.from({ length: n }, (_, i) => `secret:key${i}`);
}
function configOf(n: number) {
  return Array.from({ length: n }, (_, i) => ({ key: `key${i}`, label: `key${i}`, type: 'text' as const }));
}

test('validateManifest: exactly 8 secrets passes', () => {
  const r = validateManifest({
    id: 'x', name: 'X', version: '1.0.0', api: 1,
    permissions: permsOf(8),
    secrets: secretsOf(8),
  }, { allowPermissions: true });
  assert.equal(r.ok, true);
});

test('validateManifest: 9 secrets fails', () => {
  const r = validateManifest({
    id: 'x', name: 'X', version: '1.0.0', api: 1,
    permissions: permsOf(9),
    secrets: secretsOf(9),
  }, { allowPermissions: true });
  assert.equal(r.ok, false);
});

test('validateManifest: exactly 8 config entries passes', () => {
  const r = validateManifest({
    id: 'x', name: 'X', version: '1.0.0', api: 1,
    permissions: [],
    config: configOf(8),
  }, { allowPermissions: true });
  assert.equal(r.ok, true);
});

test('validateManifest: 9 config entries fails', () => {
  const r = validateManifest({
    id: 'x', name: 'X', version: '1.0.0', api: 1,
    permissions: [],
    config: configOf(9),
  }, { allowPermissions: true });
  assert.equal(r.ok, false);
});

// ── surface: 'canvas' | 'dom' ────────────────────────────────────────────────

test('validateManifest: surface defaults to canvas when absent', () => {
  const r = validateManifest({ id: 'x', name: 'X', version: '1.0.0', api: 1, permissions: [] });
  assert.equal(r.ok, true);
  assert.equal(r.ok && r.manifest.surface, 'canvas');
});

test('validateManifest: surface accepts dom', () => {
  const r = validateManifest({ id: 'x', name: 'X', version: '1.0.0', api: 1, permissions: [], surface: 'dom' });
  assert.equal(r.ok && r.manifest.surface, 'dom');
});

test('validateManifest: an unknown surface is rejected, not silently defaulted', () => {
  const r = validateManifest({ id: 'x', name: 'X', version: '1.0.0', api: 1, permissions: [], surface: 'webgl' });
  assert.equal(r.ok, false);
});

test('validateManifest: surface must be a string', () => {
  assert.equal(validateManifest({ id: 'x', name: 'X', version: '1.0.0', api: 1, permissions: [], surface: 1 }).ok, false);
});

// ── InitMessage carries the resolved surface (Task 3) ────────────────────────

import type { InitMessage, DataMessage, SandboxToHost } from './manifest';
import { MSG_DATA } from './manifest';

test('InitMessage: surface is a required field carrying the validated manifest value', () => {
  // Compile-time pin as much as runtime: if `surface` were ever dropped from
  // InitMessage this object literal would fail `tsc -b`, not just this
  // assertion — see viz-sandbox-surface.tsx's sendInit, which builds exactly
  // this shape from validateManifest's own output.
  const msg: InitMessage = {
    type: 'init',
    code: '',
    settings: {},
    size: { width: 1, height: 1 },
    theme: { accent: '#000', accent2: '#fff' },
    surface: 'dom',
  };
  assert.equal(msg.surface, 'dom');
});

test('data message: additive host<->frame channel for first-party surfaces', () => {
  assert.equal(MSG_DATA, 'data');
  const msg: DataMessage = { type: MSG_DATA, payload: { kind: 'milkdrop:load' } };
  // Must be a member of SandboxToHost so the host dispatch can narrow on it.
  const narrowed: SandboxToHost = msg;
  assert.equal(narrowed.type, 'data');
});

test('sync flag parses strictly: literal true only (0.9.10)', () => {
  const base = { id: 'x', name: 'X', version: '1.0.0', api: 1, permissions: [] };
  const on = validateManifest({ ...base, sync: true });
  assert.ok(on.ok && on.manifest.sync === true);
  for (const v of [undefined, false, 'true', 1, null]) {
    const r = validateManifest({ ...base, sync: v });
    assert.ok(r.ok && r.manifest.sync === false, `sync=${String(v)} means off`);
  }
});

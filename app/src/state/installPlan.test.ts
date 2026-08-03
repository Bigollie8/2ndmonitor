import test from 'node:test';
import assert from 'node:assert/strict';
import { planMultiInstall } from './installPlan';
import type { CatalogItem } from './catalog';

const item = (o: Partial<CatalogItem> = {}): CatalogItem => ({
  key: 'tile:x', kind: 'tile', id: 'x', name: 'X', description: '', category: 'weather',
  source: 'bundle', installed: false, installedVersion: null, availableVersion: '1.0.0',
  updateAvailable: false, permissions: [], needsSetup: false, downloads: 0, brokenReason: null,
  removed: false, hasPreview: false, rating: null,
  summary: null, tags: [], icon: null, changelog: null, minAppVersion: null,
  featured: false, approvedAt: null, mediaCount: 0, authorDisplay: null, ...o,
});

const APP = '0.8.0';

test('an all-new, zero-permission set needs no consent', () => {
  const p = planMultiInstall([item({ key: 'a', id: 'a' }), item({ key: 'b', id: 'b' })], APP);
  assert.equal(p.toInstall.length, 2);
  assert.equal(p.needsConsent, false);
  assert.deepEqual(p.grants, []);
});

test('already-installed items are separated out, not reinstalled', () => {
  const p = planMultiInstall([
    item({ key: 'a', id: 'a', installed: true }),
    item({ key: 'b', id: 'b' }),
  ], APP);
  assert.deepEqual(p.toInstall.map((e) => e.item.id), ['b']);
  assert.deepEqual(p.alreadyInstalled.map((i) => i.id), ['a']);
});

test('an incompatible item is blocked with a reason rather than silently dropped', () => {
  const p = planMultiInstall([item({ key: 'a', id: 'a', minAppVersion: '0.9.0' })], APP);
  assert.equal(p.toInstall.length, 0);
  assert.equal(p.blocked.length, 1);
  assert.ok(p.blocked[0].reason.includes('0.9.0'));
});

test('a removed item is blocked -- installing something the user tombstoned needs an explicit restore', () => {
  const p = planMultiInstall([item({ key: 'a', id: 'a', removed: true })], APP);
  assert.equal(p.blocked.length, 1);
});

// The whole point: consent must say WHO wants WHAT.
test('each grant names every bundle that wants it', () => {
  const p = planMultiInstall([
    item({ key: 'a', id: 'a', name: 'Alpha', permissions: ['net:api.example.com'] }),
    item({ key: 'b', id: 'b', name: 'Beta', permissions: ['net:api.example.com'] }),
    item({ key: 'c', id: 'c', name: 'Gamma', permissions: ['secret:token'] }),
  ], APP);
  const net = p.grants.find((g) => g.permission === 'net:api.example.com')!;
  assert.deepEqual(net.wantedBy.sort(), ['Alpha', 'Beta']);
  const secret = p.grants.find((g) => g.permission === 'secret:token')!;
  assert.deepEqual(secret.wantedBy, ['Gamma']);
  assert.equal(p.needsConsent, true);
});

test('grants are deduped -- the same permission from three bundles is one row, not three', () => {
  const p = planMultiInstall([
    item({ key: 'a', id: 'a', permissions: ['net:x.example'] }),
    item({ key: 'b', id: 'b', permissions: ['net:x.example'] }),
    item({ key: 'c', id: 'c', permissions: ['net:x.example'] }),
  ], APP);
  assert.equal(p.grants.length, 1);
  assert.equal(p.grants[0].wantedBy.length, 3);
});

test('every grant carries plain-English text, not the raw permission string', () => {
  const p = planMultiInstall([item({ key: 'a', id: 'a', permissions: ['net:api.example.com'] })], APP);
  assert.ok(p.grants[0].description.includes('api.example.com'));
  assert.notEqual(p.grants[0].description, 'net:api.example.com');
});

test('permissions of a blocked or already-installed item do not enter the grant list', () => {
  // Consenting to a capability for something that will not be installed
  // would be asking for a grant that is never used.
  const p = planMultiInstall([
    item({ key: 'a', id: 'a', installed: true, permissions: ['net:installed.example'] }),
    item({ key: 'b', id: 'b', minAppVersion: '9.9.9', permissions: ['net:blocked.example'] }),
    item({ key: 'c', id: 'c', permissions: ['net:real.example'] }),
  ], APP);
  assert.deepEqual(p.grants.map((g) => g.permission), ['net:real.example']);
});

test('an empty set is a valid plan that needs no consent', () => {
  const p = planMultiInstall([], APP);
  assert.equal(p.needsConsent, false);
  assert.deepEqual(p.toInstall, []);
});

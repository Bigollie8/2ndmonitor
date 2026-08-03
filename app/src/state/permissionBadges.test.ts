import test from 'node:test';
import assert from 'node:assert/strict';
import { permissionBadges, describePermission } from './permissionBadges';

test('no permissions reads as offline-safe, which is a selling point not an absence', () => {
  const b = permissionBadges([]);
  assert.deepEqual(b.map((x) => x.text), ['offline']);
  assert.equal(b[0].tone, 'neutral');
});

test('a net permission surfaces as internet, with the host in the tooltip', () => {
  const b = permissionBadges(['net:api.example.com']);
  assert.ok(b.some((x) => x.text === 'internet'));
  assert.ok(b.find((x) => x.text === 'internet')!.title.includes('api.example.com'));
});

test('several net permissions collapse to one badge naming the count', () => {
  const b = permissionBadges(['net:a.example', 'net:b.example', 'net:c.example']);
  assert.equal(b.filter((x) => x.text === 'internet').length, 1);
  assert.ok(b.find((x) => x.text === 'internet')!.title.includes('3'));
});

test('a secret permission surfaces as needing a key and is the warning tone', () => {
  const b = permissionBadges(['secret:api_key']);
  const key = b.find((x) => x.text === 'key')!;
  assert.equal(key.tone, 'warn');
  assert.ok(key.title.includes('api_key'));
});

test('a command permission is the warning tone -- running an app command is the sharpest capability', () => {
  const b = permissionBadges(['tauri:app_open_url']);
  const cmd = b.find((x) => x.text === 'command')!;
  assert.equal(cmd.tone, 'warn');
});

test('offline never appears alongside a real capability', () => {
  const b = permissionBadges(['net:a.example']);
  assert.equal(b.some((x) => x.text === 'offline'), false);
});

test('an unparseable permission still produces a badge rather than vanishing', () => {
  // Silently dropping something we could not parse would UNDERSTATE what a
  // bundle asked for, which is the one direction this must never fail in.
  const b = permissionBadges(['nonsense']);
  assert.ok(b.length > 0);
  assert.equal(b[0].tone, 'warn');
});

test('describePermission renders plain English for each kind', () => {
  assert.equal(describePermission('net:api.example.com'), 'Access the internet at api.example.com');
  assert.equal(describePermission('secret:api_key'), 'Store a credential named "api_key"');
  assert.equal(describePermission('tauri:app_open_url'), 'Run the app command "app_open_url"');
});

test('describePermission falls back to the raw string it cannot parse', () => {
  assert.equal(describePermission('nonsense'), 'nonsense');
});

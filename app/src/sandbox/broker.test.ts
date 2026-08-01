import test from 'node:test';
import assert from 'node:assert';
import { brokerDecide, makeBrokerHandler, permissionsOf, BROKER_COMMANDS } from './broker';

const perms = permissionsOf(['net:api.weather.com', 'tauri:get_system_stats']);

test('declared https host is allowed', () => {
  const d = brokerDecide(perms, { rpc: 'net.fetch', url: 'https://api.weather.com/v1/now' });
  assert.ok(d.allow);
});

test('undeclared host, subdomain, http, and garbage are denied', () => {
  for (const url of [
    'https://evil.example.com/x',
    'https://sub.api.weather.com/x', // exact host match only
    'http://api.weather.com/x',
    'not a url',
  ]) {
    const d = brokerDecide(perms, { rpc: 'net.fetch', url });
    assert.ok(!d.allow, `${url} should be denied`);
  }
});

test('tauri command denied unless in manifest AND broker allowlist', () => {
  // Declared in manifest but allowlist ships empty → denied.
  const d1 = brokerDecide(perms, { rpc: 'tauri.invoke', command: 'get_system_stats' });
  assert.ok(!d1.allow);
  assert.match((d1 as { reason: string }).reason, /broker-exposable/);
  // Not declared at all → denied with the manifest reason.
  const d2 = brokerDecide(perms, { rpc: 'tauri.invoke', command: 'secret_get' });
  assert.ok(!d2.allow);
  assert.match((d2 as { reason: string }).reason, /not declared/);
});

test('zero-permission bundle can do nothing', () => {
  const d = brokerDecide([], { rpc: 'net.fetch', url: 'https://api.weather.com/x' });
  assert.ok(!d.allow);
});

test('handler executes allowed fetch and reports denials without calling deps', async () => {
  let fetched: string[] = [];
  const handler = makeBrokerHandler(perms, {
    fetch: async (url) => { fetched.push(url); return { status: 200, body: 'ok' }; },
    invoke: async () => { throw new Error('should not be called'); },
  });
  const allowed = await handler({ rpc: 'net.fetch', url: 'https://api.weather.com/v1' });
  assert.ok(allowed.ok && (allowed.value as { status: number }).status === 200);
  assert.deepEqual(fetched, ['https://api.weather.com/v1']);
  const denied = await handler({ rpc: 'net.fetch', url: 'https://evil.example.com/' });
  assert.ok(!denied.ok);
  assert.equal(fetched.length, 1);
});

test('allowlist is empty at launch (deliberate fail-closed posture)', () => {
  assert.equal(Object.keys(BROKER_COMMANDS).length, 0);
});

test('brokerDecide: a secret: permission grants no fetch or invoke on its own', () => {
  const perms = permissionsOf(['secret:token']);
  // Note: brokerDecide returns `{ allow }`, not `{ ok }` (that shape belongs
  // to makeBrokerHandler); the brief's snippet used `.ok`, which doesn't
  // exist on this return type and would fail `tsc --noEmit`.
  assert.equal(brokerDecide(perms, { rpc: 'net.fetch', url: 'https://x.com/' }).allow, false);
  assert.equal(brokerDecide(perms, { rpc: 'tauri.invoke', command: 'anything' }).allow, false);
});

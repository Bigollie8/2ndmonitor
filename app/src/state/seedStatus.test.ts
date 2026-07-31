import test from 'node:test';
import assert from 'node:assert/strict';
import {
  markSeedSettled, isSeedSettled, subscribeSeedSettled, __resetSeedStatusForTests,
} from './seedStatus';
import { resolveVizSurface } from './contentRegistry';

test('seedStatus: starts unsettled, so nothing concludes the catalog is complete', () => {
  __resetSeedStatusForTests();
  assert.equal(isSeedSettled(), false);
});

test('seedStatus: marking settles it and notifies subscribers', () => {
  __resetSeedStatusForTests();
  let fired = 0;
  subscribeSeedSettled(() => { fired++; });
  markSeedSettled();
  assert.equal(isSeedSettled(), true);
  assert.equal(fired, 1);
});

// The success path, the failure path and the watchdog can all call this — in
// App.tsx the `finally` and the timeout genuinely race. A second call must
// cost nothing rather than firing a spurious re-render of every consumer.
test('seedStatus: marking twice is a no-op, not a second notification', () => {
  __resetSeedStatusForTests();
  let fired = 0;
  subscribeSeedSettled(() => { fired++; });
  markSeedSettled();
  markSeedSettled();
  markSeedSettled();
  assert.equal(fired, 1);
});

test('seedStatus: unsubscribing stops notifications', () => {
  __resetSeedStatusForTests();
  let fired = 0;
  const off = subscribeSeedSettled(() => { fired++; });
  off();
  markSeedSettled();
  assert.equal(fired, 0);
  assert.equal(isSeedSettled(), true, 'the latch is set regardless of listeners');
});

// Subscribing after the fact must not hang waiting for an event that already
// happened — useSyncExternalStore reads the snapshot on first render, which is
// why the getter is separate from the subscription.
test('seedStatus: a late reader sees the settled state immediately', () => {
  __resetSeedStatusForTests();
  markSeedSettled();
  let fired = 0;
  subscribeSeedSettled(() => { fired++; });
  assert.equal(isSeedSettled(), true);
  assert.equal(fired, 0, 'no replayed notification — the snapshot carries the state');
});

test('seedStatus: the latch is one-way — nothing in app code can un-settle it', () => {
  __resetSeedStatusForTests();
  markSeedSettled();
  const exported = Object.keys({ markSeedSettled, isSeedSettled, subscribeSeedSettled });
  assert.ok(!exported.some((k) => /unsettle|reset|clear/i.test(k)));
  assert.equal(isSeedSettled(), true);
});

// The composition this exists for: `useVizStyles` reports
// `loaded = installedResolved && seedSettled`, and the surface holds at
// 'pending' until both are true. Modelled here without React so the decision
// itself is covered — the hook is a two-line binding over these two facts.
test('seedStatus: an unseeded launch holds the surface pending, not on a fallback', () => {
  const installed = [{ id: 'milkdrop' as const }, { id: 'scripted' as const }];
  const loaded = (installedResolved: boolean, seedSettled: boolean) => installedResolved && seedSettled;

  // visualizers_list has resolved, but seed_sync has not written bundle:bars
  // yet. Concluding "absent" here is what mounted and tore down MilkDrop.
  assert.deepEqual(
    resolveVizSurface('bundle:bars', installed, loaded(true, false)),
    { kind: 'pending' },
  );

  // Once seeding settles, the same catalog resolves for real.
  assert.deepEqual(
    resolveVizSurface('bundle:bars', installed, loaded(true, true)),
    { kind: 'style', mode: 'milkdrop' },
    'still a fallback if bars genuinely never arrived — but now it is an answer, not a guess',
  );

  // And a bundle that DID get seeded renders itself, no pending frame at all.
  assert.deepEqual(
    resolveVizSurface('bundle:bars', [...installed, { id: 'bundle:bars' as const }], loaded(true, true)),
    { kind: 'style', mode: 'bundle:bars' },
  );
});

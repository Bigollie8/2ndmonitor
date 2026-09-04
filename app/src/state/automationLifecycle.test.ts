import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { useProfileAutomation } from './useProfileAutomation';
import type { ProfileAutomation } from './profileAutomation';

const settle = async () => { for (let n = 0; n < 12; n++) await Promise.resolve(); };
test('automation honors manual pause and modal blocking, recalls scale, and stops on unmount', async t => {
  t.mock.timers.enable({ apis: ['setInterval', 'Date'], now: 1000 });
  let active = 'work'; let blocked = false; let app = 'game.exe'; let display = 'A'; let calls = 0;
  const selected: string[] = []; const scales: number[] = [];
  const settings: ProfileAutomation = { enabled: true, rules: [{ app: 'game', profileId: 'gaming' }], displays: [{ display: 'B', profileId: 'work', uiScale: 1.25 }] };
  const sources = { foreground: async () => { calls++; return { process_name: app, window_title: '', pid: 1 }; }, display: async () => display };
  let controller!: ReturnType<typeof useProfileAutomation>;
  function Probe() { controller = useProfileAutomation({ settings, profileIds: ['work', 'gaming'], activeProfileId: active, blocked, sources, select: id => { active = id; selected.push(id); }, setScale: n => scales.push(n) }); return null; }
  let tree!: ReactTestRenderer;
  await act(async () => { tree = create(createElement(Probe)); await settle(); });
  const tick = async () => { await act(async () => { t.mock.timers.tick(2000); await settle(); }); };
  await tick(); assert.deepEqual(selected, []);
  await tick(); assert.deepEqual(selected, ['gaming']);
  await act(async () => controller.pause());
  active = 'work'; await act(async () => tree.update(createElement(Probe)));
  await tick(); await tick(); await tick(); assert.equal(selected.length, 1);
  await act(async () => controller.resume());
  blocked = true; await act(async () => tree.update(createElement(Probe)));
  await tick(); await tick(); await tick(); assert.equal(selected.length, 1);
  blocked = false; await act(async () => tree.update(createElement(Probe)));
  await tick(); await tick(); await tick(); assert.equal(selected.at(-1), 'gaming');
  app = 'unmatched'; display = 'B';
  await tick(); await tick(); await tick();
  assert.equal(selected.at(-1), 'work'); assert.deepEqual(scales, [1.25]);
  await act(async () => tree.unmount()); const before = calls;
  await tick(); assert.equal(calls, before);
});

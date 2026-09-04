import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LayoutHistory } from './layoutHistory';
import type { OrientationLayout } from './layout';
import { matchingProfile, parseAutomation, StableProfileMatch } from './profileAutomation';
import { buildSetupExport } from './profileIO';
import { setupRequirements } from './setupRequirements';
import { freshness, pollHealth } from './pollHealth';
import { seedStarterProfiles } from './starterProfiles';

const layout = (x: number): OrientationLayout => ({ tiles: [{ instanceId: 'a', type: 'notes', rect: { x, y: .1, w: .3, h: .3 }, config: { text: 'old' } }] });
test('layout history separates profiles/orientations and preserves live content', () => {
  const h = new LayoutHistory();
  h.record('work', 'landscape', layout(.1), layout(.2));
  assert.deepEqual(h.available('work', 'portrait'), { undo: false, redo: false });
  assert.deepEqual(h.available('game', 'landscape'), { undo: false, redo: false });
  const current = layout(.2); current.tiles[0]!.config = { text: 'new' };
  const undone = h.move('work', 'landscape', current, 'undo')!;
  assert.equal(undone.tiles[0]!.rect.x, .1);
  assert.deepEqual(undone.tiles[0]!.config, { text: 'new' });
  assert.equal(h.move('work', 'landscape', undone, 'redo')!.tiles[0]!.rect.x, .2);
});
test('undo removal restores the tile; new edits invalidate redo and history is bounded', () => {
  const h = new LayoutHistory();
  h.record('p', 'landscape', layout(.1), { tiles: [] });
  assert.equal(h.move('p', 'landscape', { tiles: [] }, 'undo')!.tiles[0]!.type, 'notes');
  h.record('p', 'landscape', layout(.1), layout(.2));
  assert.equal(h.available('p', 'landscape').redo, false);
  for (let n = 0; n < 70; n++) h.record('p', 'portrait', layout(n / 100), layout((n + 1) / 100));
  let count = 0; while (h.move('p', 'portrait', layout(0), 'undo')) count++;
  assert.equal(count, 50);
  h.retain(new Set()); assert.equal(h.available('p', 'landscape').undo, false);
});
test('live configuration updates do not create undo steps', () => {
  const h = new LayoutHistory(); const next = layout(.1); next.tiles[0]!.config = { text: 'new' };
  h.record('p', 'landscape', layout(.1), next);
  assert.equal(h.available('p', 'landscape').undo, false);
});
test('automation is opt-in, exact match only, and ignores deleted profiles', () => {
  assert.equal(parseAutomation({ enabled: 'true', rules: [null], displays: [{}] }).enabled, false);
  assert.deepEqual(parseAutomation(null), { enabled: false, rules: [], displays: [] });
  const rules = [{ app: 'Code.exe', profileId: 'work' }];
  assert.equal(matchingProfile(rules, 'code.EXE', ['work']), 'work');
  assert.equal(matchingProfile(rules, 'my-code.exe', ['work']), null);
  assert.equal(matchingProfile(rules, 'code.exe', []), null);
});
test('profile matching waits four seconds and resets after interruption', () => {
  const match = new StableProfileMatch();
  assert.equal(match.update('work', 100), null);
  assert.equal(match.update('work', 4099), null);
  assert.equal(match.update('work', 4100), 'work');
  assert.equal(match.update(null, 4200), null);
  assert.equal(match.update('work', 4300), null);
  assert.equal(match.update('game', 9000), null);
  match.reset(); assert.equal(match.update('game', 14000), null);
});
test('shared exports omit personal content, nested credentials and all bundle config', () => {
  const tiles = layout(.1).tiles;
  tiles[0]!.config = { text: 'private note', url: 'https://secret/?token=x', nested: { apiKey: 'secret' }, token: 'secret', mapView: { lat: 5 }, opacity: .5 };
  tiles.push({ ...tiles[0]!, instanceId: 'bundle', type: 'bundle:custom', config: { harmless: 'secret in unknown schema', opacity: .2 } });
  const exported = buildSetupExport('Shared', 'landscape', tiles);
  assert.deepEqual(exported.tiles[0]!.config, { opacity: .5 });
  assert.equal(exported.tiles[1]!.config, undefined);
  assert.ok(!JSON.stringify(exported).includes('secret'));
});
test('dependency preview distinguishes unknown catalog state and missing bundles', () => {
  const tiles = [{ ...layout(.1).tiles[0]!, type: 'bundle:weather' as const }, { ...layout(.1).tiles[0]!, type: 'claude' as const }];
  assert.equal(setupRequirements(tiles, null).bundles[0]!.available, null);
  assert.equal(setupRequirements(tiles, []).bundles[0]!.available, false);
  assert.equal(setupRequirements(tiles, ['bundle:weather']).bundles[0]!.available, true);
  assert.ok(setupRequirements(tiles, []).connections.length > 0);
});
test('data health tracks staleness, setup, errors and unregisters on cleanup', () => {
  const row = { id: 'test', label: 'Test', intervalMs: 1000, updatedAt: 100, failed: false, pending: false, retry: () => {} };
  pollHealth.put(row);
  assert.equal(freshness(row, 1000), 'Up to date');
  assert.equal(freshness(row, 2200), 'Stale');
  assert.equal(freshness({ ...row, failed: true }, 1000), 'Retrying · showing saved data');
  assert.equal(freshness({ ...row, needsSetup: true }, 1000), 'Needs setup');
  pollHealth.remove('test'); assert.equal(pollHealth.getSnapshot().length, 0);
});
test('fresh Work profile starts without unconfigured Discord or Claude', () => {
  const work = seedStarterProfiles()[0]!;
  assert.ok(work.landscape.tiles.some(t => t.type === 'notes'));
  assert.ok(work.landscape.tiles.every(t => t.type !== 'claude' && t.type !== 'discord'));
});

import test from 'node:test';
import assert from 'node:assert';
import { mergePresetLibrary, resolvePreset } from './milkdrop-presets';

test('bundled first (sorted), then user (as given), keys unique', () => {
  const lib = mergePresetLibrary(
    { 'Zebra': {}, 'Alpha': {} },
    [{ name: 'mine', file: 'mine.json', ext: 'json' }, { name: 'raw', file: 'raw.milk', ext: 'milk' }],
  );
  assert.deepEqual(lib.map((e) => e.label), ['Alpha', 'Zebra', 'mine', 'raw']);
  assert.deepEqual(lib.map((e) => e.source), ['bundled', 'bundled', 'user', 'user']);
  assert.equal(new Set(lib.map((e) => e.key)).size, 4);
});

test('user preset colliding with bundled name still gets a unique key', () => {
  const lib = mergePresetLibrary({ 'Same': {} }, [{ name: 'Same', file: 'Same.json', ext: 'json' }]);
  assert.equal(new Set(lib.map((e) => e.key)).size, 2);
});

test('resolvePreset: bundled returns the pack object', async () => {
  const preset = { baseVals: {} };
  const lib = mergePresetLibrary({ 'One': preset }, []);
  const got = await resolvePreset(lib[0], { bundled: { 'One': preset }, readUserFile: async () => '' });
  assert.strictEqual(got, preset);
});

test('resolvePreset: user json parses; invalid json throws readable error', async () => {
  const entry = { key: 'u:a.json', label: 'a', source: 'user' as const, file: 'a.json', ext: 'json' };
  const deps = { bundled: {}, readUserFile: async () => '{"waves":[]}' };
  assert.deepEqual(await resolvePreset(entry, deps), { waves: [] });
  const bad = { bundled: {}, readUserFile: async () => 'not json' };
  await assert.rejects(() => resolvePreset(entry, bad), /not valid Butterchurn preset JSON/);
});

test('resolvePreset: .milk reports conversion unavailable', async () => {
  const entry = { key: 'u:x.milk', label: 'x', source: 'user' as const, file: 'x.milk', ext: 'milk' };
  const deps = { bundled: {}, readUserFile: async () => '[preset00]' };
  await assert.rejects(() => resolvePreset(entry, deps), /\.milk conversion unavailable/);
});

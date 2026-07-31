import test from 'node:test';
import assert from 'node:assert';
import { mergePresetLibrary, resolveLoadSource } from './milkdrop-presets';

test('bundled first (sorted), then user (as given), keys unique', () => {
  const lib = mergePresetLibrary(
    ['Zebra', 'Alpha'],
    [{ name: 'mine', file: 'mine.json', ext: 'json' }, { name: 'raw', file: 'raw.milk', ext: 'milk' }],
  );
  assert.deepEqual(lib.map((e) => e.label), ['Alpha', 'Zebra', 'mine', 'raw']);
  assert.deepEqual(lib.map((e) => e.source), ['bundled', 'bundled', 'user', 'user']);
  assert.equal(new Set(lib.map((e) => e.key)).size, 4);
});

test('user preset colliding with bundled name still gets a unique key', () => {
  const lib = mergePresetLibrary(['Same'], [{ name: 'Same', file: 'Same.json', ext: 'json' }]);
  assert.equal(new Set(lib.map((e) => e.key)).size, 2);
});

test('resolveLoadSource: bundled entries resolve to a by-name reference, no read', async () => {
  let reads = 0;
  const src = await resolveLoadSource(
    { key: 'b:Alpha', label: 'Alpha', source: 'bundled' },
    async () => { reads++; return ''; },
  );
  assert.deepEqual(src, { bundled: 'Alpha' });
  assert.equal(reads, 0, 'the frame owns bundled presets; the host must not read anything');
});

test('resolveLoadSource: user json parses to an inline preset object', async () => {
  const src = await resolveLoadSource(
    { key: 'u:a.json', label: 'a', source: 'user', file: 'a.json', ext: 'json' },
    async () => '{"baseVals":{}}',
  );
  assert.deepEqual(src, { preset: { baseVals: {} } });
});

test('resolveLoadSource: user json that is not an object is a readable error', async () => {
  await assert.rejects(
    resolveLoadSource(
      { key: 'u:a.json', label: 'a', source: 'user', file: 'a.json', ext: 'json' },
      async () => '[1,2]',
    ),
    /not valid Butterchurn preset JSON/,
  );
});

test('resolveLoadSource: .milk still reports the conversion gap', async () => {
  await assert.rejects(
    resolveLoadSource(
      { key: 'u:a.milk', label: 'a', source: 'user', file: 'a.milk', ext: 'milk' },
      async () => 'per_frame_1=',
    ),
    /\.milk conversion unavailable/,
  );
});

import test from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mergePresetLibrary, resolveLoadSource } from './milkdrop-presets';

const __dirname = dirname(fileURLToPath(import.meta.url));

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

const readComponent = () =>
  readFileSync(join(__dirname, '..', 'components', 'viz-milkdrop.tsx'), 'utf8');

test('milkdrop host: renders through the sandbox surface, not a direct butterchurn import', () => {
  const tsx = readComponent();
  assert.ok(!tsx.includes("import('butterchurn')"), 'butterchurn must not load in the app document (CSP)');
  assert.ok(tsx.includes('<SandboxVizSurface'), 'rendering goes through the sandbox surface');
  assert.ok(tsx.includes('localSource={MILKDROP_LOCAL_SOURCE}'), 'frame code passed as a stable module constant');
  assert.ok(/const MILKDROP_LOCAL_SOURCE = \{ code: MILKDROP_FRAME_CODE \}/.test(tsx),
    'localSource identity must be module-scope stable or the surface re-inits every render');
});

test('milkdrop host: every pending load resolves — result, timeout, or not-ready', () => {
  const tsx = readComponent();
  assert.ok(tsx.includes("kind: 'milkdrop:load'"), 'loads travel the data channel');
  assert.ok(tsx.includes('no response from visualizer frame'), 'a dead frame times out instead of hanging the walk-forward');
  assert.ok(tsx.includes('visualizer not ready'), 'posting before ready fails fast');
  assert.ok(tsx.includes("kind === 'milkdrop:load:result'"), 'results resolve by seq');
});

test('milkdrop host: names arrival rebuilds the library and restores the saved preset', () => {
  const tsx = readComponent();
  assert.ok(tsx.includes("kind === 'milkdrop:names'"));
  assert.ok(tsx.includes('mergePresetLibrary('));
  assert.ok(tsx.includes('LS_PRESET'), 'saved-preset restore survives the rewrite');
});

test('milkdrop host: hover chrome works over an iframe (pointer shield)', () => {
  const tsx = readComponent();
  // Mouse events over an iframe go to ITS document, never the parent's —
  // without a shield above the frame, onMouseEnter never fires and the chips
  // are unreachable. The visualizer needs no pointer input, so a full-cover
  // div above the iframe costs nothing.
  assert.ok(tsx.includes('data-pointer-shield'), 'a full-cover div must sit above the iframe');
});

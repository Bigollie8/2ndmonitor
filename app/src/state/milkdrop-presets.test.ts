import test from 'node:test';
import assert from 'node:assert';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mergePresetLibrary, resolveLoadSource } from './milkdrop-presets';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Static form (`from 'butterchurn'`) as well as the dynamic one, single- or
// double-quoted. Deliberately does NOT match the sanctioned subpath ?raw
// specifiers in components/milkdrop-code.ts (e.g.
// 'butterchurn/lib/butterchurn.min.js?raw') — those aren't bare `butterchurn`
// or `butterchurn-presets` module specifiers, they're raw-text asset imports.
const BUTTERCHURN_MODULE_IMPORT =
  /from\s+['"](butterchurn|butterchurn-presets)['"]|import\s*\(\s*['"](butterchurn|butterchurn-presets)['"]\s*\)/;

test('originals first (authored order), then bundled (sorted), then user (as given), keys unique', () => {
  const lib = mergePresetLibrary(
    [{ id: 'tron-grid', label: 'The Grid' }, { id: 'tron-city', label: 'Tron City' }],
    ['Zebra', 'Alpha'],
    [{ name: 'mine', file: 'mine.json', ext: 'json' }, { name: 'raw', file: 'raw.milk', ext: 'milk' }],
  );
  assert.deepEqual(lib.map((e) => e.label), ['The Grid', 'Tron City', 'Alpha', 'Zebra', 'mine', 'raw']);
  assert.deepEqual(lib.map((e) => e.source), ['original', 'original', 'bundled', 'bundled', 'user', 'user']);
  assert.equal(new Set(lib.map((e) => e.key)).size, 6);
});

test('originals, then market (sorted case-insensitively by name), then bundled, then user', () => {
  const lib = mergePresetLibrary(
    [{ id: 'tron-grid', label: 'The Grid' }],
    ['Zebra', 'Alpha'],
    [{ name: 'mine', file: 'mine.json', ext: 'json' }],
    [{ id: 'm2', name: 'zeta' }, { id: 'm1', name: 'Beta' }],
  );
  assert.deepEqual(lib.map((e) => e.label), ['The Grid', 'Beta', 'zeta', 'Alpha', 'Zebra', 'mine']);
  assert.deepEqual(lib.map((e) => e.source), ['original', 'market', 'market', 'bundled', 'bundled', 'user']);
  assert.deepEqual(lib.filter((e) => e.source === 'market').map((e) => e.key), ['m:m1', 'm:m2']);
  assert.deepEqual(lib.filter((e) => e.source === 'market').map((e) => e.id), ['m1', 'm2']);
});

test('a market preset and a bundled preset with the same display name coexist (distinct keys)', () => {
  const lib = mergePresetLibrary([], ['Same'], [], [{ id: 'mkt1', name: 'Same' }]);
  assert.equal(new Set(lib.map((e) => e.key)).size, 2);
  assert.deepEqual(lib.map((e) => e.key).sort(), ['b:Same', 'm:mkt1']);
});

test('user preset colliding with bundled name still gets a unique key', () => {
  const lib = mergePresetLibrary([], ['Same'], [{ name: 'Same', file: 'Same.json', ext: 'json' }]);
  assert.equal(new Set(lib.map((e) => e.key)).size, 2);
});

test('an original whose label matches a bundled name cannot collide (o:/b: namespaces)', () => {
  const lib = mergePresetLibrary([{ id: 'same', label: 'Same' }], ['Same'], []);
  assert.equal(new Set(lib.map((e) => e.key)).size, 2);
});

test('resolveLoadSource: original entries resolve through the injected builder, no read', async () => {
  let reads = 0;
  const src = await resolveLoadSource(
    { key: 'o:tron-grid', label: 'The Grid', source: 'original', id: 'tron-grid' },
    async () => { reads++; return ''; },
    (id) => ({ builtFor: id }),
  );
  assert.deepEqual(src, { preset: { builtFor: 'tron-grid' } });
  assert.equal(reads, 0, 'originals are built host-side; the host must not read files for them');
});

test('resolveLoadSource: an original without a builder is a readable error', async () => {
  await assert.rejects(
    resolveLoadSource(
      { key: 'o:tron-grid', label: 'The Grid', source: 'original', id: 'tron-grid' },
      async () => '',
    ),
    /no builder/,
  );
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

test('resolveLoadSource: a market entry calls readMarketPreset with the entry id and returns the parsed object', async () => {
  let calledWith = '';
  const src = await resolveLoadSource(
    { key: 'm:abc', label: 'Cool One', source: 'market', id: 'abc' },
    async () => '',
    undefined,
    async (id) => { calledWith = id; return '{"baseVals":{"x":1}}'; },
  );
  assert.deepEqual(src, { preset: { baseVals: { x: 1 } } });
  assert.equal(calledWith, 'abc');
});

test('resolveLoadSource: a market entry with invalid JSON is a readable error mentioning preset', async () => {
  await assert.rejects(
    resolveLoadSource(
      { key: 'm:abc', label: 'Cool One', source: 'market', id: 'abc' },
      async () => '',
      undefined,
      async () => 'not json',
    ),
    /preset/,
  );
});

test('resolveLoadSource: a market entry that is not an object is a readable error mentioning preset', async () => {
  await assert.rejects(
    resolveLoadSource(
      { key: 'm:abc', label: 'Cool One', source: 'market', id: 'abc' },
      async () => '',
      undefined,
      async () => '[1,2]',
    ),
    /preset/,
  );
});

test('resolveLoadSource: a market entry without a reader throws a specific error', async () => {
  await assert.rejects(
    resolveLoadSource(
      { key: 'm:abc', label: 'Cool One', source: 'market', id: 'abc' },
      async () => '',
    ),
    /no reader for marketplace presets/,
  );
});

const readComponent = () =>
  readFileSync(join(__dirname, '..', 'components', 'viz-milkdrop.tsx'), 'utf8');

test('milkdrop host: renders through the sandbox surface, not a direct butterchurn import', () => {
  const tsx = readComponent();
  assert.ok(!BUTTERCHURN_MODULE_IMPORT.test(tsx), 'butterchurn must not load in the app document (CSP)');
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

test('CSP regression sweep: no app-document module imports butterchurn as a module', () => {
  // The guard above only reads viz-milkdrop.tsx; the bug it catches (loading
  // butterchurn in the app document, where CSP forbids the new Function()
  // calls butterchurn's preset compiler needs) could be reintroduced from any
  // module under src, not just this one. Walk the whole tree instead of
  // trusting one file to stay the sole offender.
  const srcRoot = join(__dirname, '..');
  const offenders: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!/\.tsx?$/.test(entry.name)) continue;
      if (entry.name.endsWith('.test.ts') || entry.name.endsWith('.test.tsx')) continue;
      // The sanctioned path: raw-text asset imports of butterchurn's built
      // JS, executed only inside the sandboxed iframe (see that file's own
      // header comment). Its specifiers are subpaths ending `?raw`, which
      // BUTTERCHURN_MODULE_IMPORT does not match anyway — skipped here mainly
      // so a future edit to that file doesn't need to fight this test too.
      const rel = relative(srcRoot, full).split(sep).join('/');
      if (rel === 'components/milkdrop-code.ts') continue;
      const text = readFileSync(full, 'utf8');
      if (BUTTERCHURN_MODULE_IMPORT.test(text)) offenders.push(rel);
    }
  };
  walk(srcRoot);
  assert.deepEqual(offenders, [], `butterchurn must not load in the app document (CSP): ${offenders.join(', ')}`);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateMetadata } from './backfill-metadata.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLES = join(ROOT, 'bundles');

const bundleIds = () => readdirSync(BUNDLES, { withFileTypes: true })
  .filter((d) => d.isDirectory() && d.name !== 'dist')
  .filter((d) => existsSync(join(BUNDLES, d.name, 'manifest.json')))
  .map((d) => d.name);

const kindOf = (id) => {
  const m = JSON.parse(readFileSync(join(BUNDLES, id, 'manifest.json'), 'utf8'));
  if (existsSync(join(BUNDLES, id, 'view.json'))) return 'tile';
  if (existsSync(join(BUNDLES, id, 'preset.json'))) return 'preset';
  return m.kind ?? 'visualizer';
};

const data = JSON.parse(readFileSync(join(BUNDLES, 'metadata.json'), 'utf8'));

test('every bundle folder has a metadata entry', () => {
  const missing = bundleIds().filter((id) => !data[id]);
  assert.deepEqual(missing, [], `bundles with no metadata entry: ${missing.join(', ')}`);
});

test('every metadata entry names a real bundle', () => {
  const ids = new Set(bundleIds());
  const orphans = Object.keys(data).filter((id) => !ids.has(id));
  assert.deepEqual(orphans, [], `metadata for bundles that do not exist: ${orphans.join(', ')}`);
});

test('the whole file validates', () => {
  const res = validateMetadata(data, kindOf);
  assert.equal(res.ok, true, res.ok ? '' : res.errors.join('\n'));
});

test('a summary over 100 chars is rejected', () => {
  const res = validateMetadata({ aurora: { ...data.aurora, summary: 'x'.repeat(101) } }, () => 'visualizer');
  assert.equal(res.ok, false);
});

test('a category from the wrong kind is rejected', () => {
  const res = validateMetadata({ aurora: { ...data.aurora, category: 'weather' } }, () => 'visualizer');
  assert.equal(res.ok, false, "'weather' is a tile category, not a visualizer one");
});

test('a tag with capitals or spaces is rejected', () => {
  const res = validateMetadata({ aurora: { ...data.aurora, tags: ['Has Caps'] } }, () => 'visualizer');
  assert.equal(res.ok, false);
});

test('more than 8 tags is rejected', () => {
  const tags = Array.from({ length: 9 }, (_, i) => `t${i}`);
  assert.equal(validateMetadata({ aurora: { ...data.aurora, tags } }, () => 'visualizer').ok, false);
});

// tileMeta.ts documents the rule: geometric glyphs only, because emoji render
// differently per Windows version and clash with the mono/glass aesthetic.
// The server cannot detect this, so the gate lives here.
test('an emoji icon is rejected', () => {
  const res = validateMetadata({ aurora: { ...data.aurora, icon: '🌈' } }, () => 'visualizer');
  assert.equal(res.ok, false, 'emoji icons are a documented no in this project');
});

test('a geometric glyph icon is accepted', () => {
  assert.equal(validateMetadata({ aurora: { ...data.aurora, icon: '◈' } }, () => 'visualizer').ok, true);
});

// The glyphs already in tileMeta.ts live in the same Unicode neighbourhood as
// some emoji, so a lazy block-range check would reject the project's own
// house style. Pin that it does not.
test('the glyphs tileMeta.ts already ships are accepted', () => {
  for (const icon of ['☀', '✈', '✎', '✹', '❋', '⌘', '≈', '↯', '◐']) {
    assert.equal(
      validateMetadata({ aurora: { ...data.aurora, icon } }, () => 'visualizer').ok,
      true,
      `${icon} is in tileMeta.ts and must not be treated as an emoji`,
    );
  }
});

test('a variation-selector emoji presentation is rejected', () => {
  const res = validateMetadata({ aurora: { ...data.aurora, icon: '☀️' } }, () => 'visualizer');
  assert.equal(res.ok, false, 'U+FE0F forces emoji presentation on a glyph that would otherwise be fine');
});

test('no two bundles share an identical summary', () => {
  // A copy-pasted summary is worse than none: it makes two cards look like
  // the same thing in a grid built around scanning summaries.
  const seen = new Map();
  const dupes = [];
  for (const [id, m] of Object.entries(data)) {
    const s = (m.summary ?? '').trim().toLowerCase();
    if (!s) continue;
    if (seen.has(s)) dupes.push(`${seen.get(s)} and ${id}`);
    seen.set(s, id);
  }
  assert.deepEqual(dupes, [], `duplicate summaries: ${dupes.join('; ')}`);
});

test('4-6 bundles are featured -- enough to clear SHELF_MIN with room for the dedupe', () => {
  const featured = Object.values(data).filter((m) => m.featured === true).length;
  assert.ok(featured >= 4 && featured <= 6, `${featured} featured, expected 4-6`);
});

// Run: node --test "scripts/**/*.test.mjs"  (bare "node --test scripts/" breaks on Node 24+)
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseChangelog,
  parseEnvFile,
  buildReleaseEmbed,
  buildSpotlightEmbed,
  buildDevEmbed,
  buildProgressEmbed,
  buildFeatureEmbed,
  buildInfoEmbed,
  truncateDescription,
  CHANGELOG_URL,
} from './changelog.mjs';

const SAMPLE = `# Changelog

Intro text.

## [Unreleased]

### Added
- WIP thing

## [0.4.0] - 2026-05-08

### Added
- Now Playing tile
- Apple Music integration

### Fixed
- A bug

## [0.3.1] - 2026-05-08

### Fixed
- Tiles fill their rect
`;

test('returns released versions newest-first, skipping Unreleased', () => {
  const entries = parseChangelog(SAMPLE);
  assert.deepEqual(entries.map((e) => e.version), ['0.4.0', '0.3.1']);
  assert.equal(entries[0].date, '2026-05-08');
});

test('body holds the full section content including subsection headings', () => {
  const [v040] = parseChangelog(SAMPLE);
  assert.ok(v040.body.startsWith('### Added'));
  assert.ok(v040.body.includes('- Apple Music integration'));
  assert.ok(v040.body.includes('### Fixed'));
  assert.ok(!v040.body.includes('## [0.3.1]'));
});

test('added holds only the Added bullets, null when absent', () => {
  const [v040, v031] = parseChangelog(SAMPLE);
  assert.equal(v040.added, '- Now Playing tile\n- Apple Music integration');
  assert.equal(v031.added, null);
});

test('empty or heading-free input yields empty array', () => {
  assert.deepEqual(parseChangelog('# Changelog\n\nnothing yet'), []);
});

test('added is null when the Added section is empty, even with a following section', () => {
  const changelog = `## [0.6.0] - 2026-05-12

### Added

### Fixed
- x`;
  const entries = parseChangelog(changelog);
  assert.equal(entries[0].version, '0.6.0');
  assert.equal(entries[0].added, null);
  assert.ok(entries[0].body.includes('### Fixed'));
  assert.ok(entries[0].body.includes('- x'));
});

test('added captures bullets even when not the first subsection', () => {
  const changelog = `## [0.5.0] - 2026-05-10

### Changed
- Layout refactor

### Added
- Feature one
- Feature two

### Fixed
- Bug fix`;
  const entries = parseChangelog(changelog);
  assert.equal(entries[0].version, '0.5.0');
  assert.equal(entries[0].added, '- Feature one\n- Feature two');
});

const ENTRY = {
  version: '0.4.0',
  date: '2026-05-08',
  body: '### Added\n- Now Playing tile',
  added: '- Now Playing tile',
};

test('release embed carries title, body, color, dated footer', () => {
  const e = buildReleaseEmbed(ENTRY);
  assert.equal(e.title, '2ndMonitor v0.4.0');
  assert.equal(e.description, ENTRY.body);
  assert.equal(e.color, 0x5865f2);
  assert.equal(e.footer.text, '2ndMonitor Releases • 2026-05-08');
});

test('spotlight embed uses Added alone when there are no fixes', () => {
  const e = buildSpotlightEmbed(ENTRY);
  assert.equal(e.title, '✨ New in 2ndMonitor v0.4.0');
  assert.equal(e.description, '- Now Playing tile');
  assert.equal(e.color, 0x57f287);
});

test('spotlight embed carries BOTH sections when a release adds and fixes', () => {
  // The 0.8.2 failure mode: four fixes plus one incidental Added line meant
  // the features channel announced only that line, and read as though the
  // licence note were the entire release.
  const e = buildSpotlightEmbed({ ...ENTRY, fixed: '- Radar no longer glitches' });
  assert.match(e.description, /\*\*New\*\*/);
  assert.match(e.description, /Now Playing tile/);
  assert.match(e.description, /\*\*Fixed\*\*/);
  assert.match(e.description, /Radar no longer glitches/);
});

test('spotlight embed falls back to Fixed when a release adds nothing', () => {
  // 0.8.2 shipped four fixes and one incidental Added line about licence
  // notices; the features channel therefore announced only the licence and
  // read as though that were the entire release. A fixes-only release used to
  // post nothing at all.
  const e = buildSpotlightEmbed({ ...ENTRY, added: null, fixed: '- Radar no longer glitches' });
  assert.ok(e, 'a fixes-only release must still produce a spotlight');
  assert.match(e.title, /Fixed in 2ndMonitor v0\.4\.0/);
  assert.equal(e.description, '- Radar no longer glitches');
});

test('spotlight embed is null only when there is nothing to say', () => {
  assert.equal(buildSpotlightEmbed({ ...ENTRY, added: null, fixed: null }), null);
});

test('parseChangelog exposes the Fixed section alongside Added', () => {
  const [entry] = parseChangelog([
    '## [1.2.3] - 2026-01-01',
    '',
    '### Added',
    '- a new thing',
    '',
    '### Fixed',
    '- a broken thing',
    '',
  ].join('\n'));
  assert.equal(entry.added, '- a new thing');
  assert.equal(entry.fixed, '- a broken thing');
});

test('dev embed frames in-development work', () => {
  const e = buildDevEmbed({ title: 'Tile Library', body: 'Browse and add tiles.', date: '2026-07-31' });
  assert.equal(e.title, '🔧 In development — Tile Library');
  assert.equal(e.description, 'Browse and add tiles.');
  assert.equal(e.color, 0xfaa61a);
  assert.equal(e.footer.text, '2ndMonitor Features • 2026-07-31');
});

test('truncateDescription caps at 4096 and links the changelog', () => {
  const short = 'fits fine';
  assert.equal(truncateDescription(short), short);
  const long = 'x'.repeat(5000);
  const out = truncateDescription(long);
  assert.ok(out.length <= 4096);
  assert.ok(out.endsWith(`…[full changelog](${CHANGELOG_URL})`));
});

test('parseEnvFile reads KEY=value, skips comments/blanks, keeps = in values', () => {
  const env = parseEnvFile('# secrets\n\nA=1\nB=https://x/y?a=b=c\n');
  assert.deepEqual(env, { A: '1', B: 'https://x/y?a=b=c' });
});

test('progress embed frames work-in-progress with dev-log footer', () => {
  const e = buildProgressEmbed({ title: 'Marketplace uplevel', body: 'Catalog shipped.', date: '2026-07-31' });
  assert.equal(e.title, '🚧 In progress — Marketplace uplevel');
  assert.equal(e.description, 'Catalog shipped.');
  assert.equal(e.color, 0xeb459e);
  assert.equal(e.footer.text, 'Dev Log • 2026-07-31');
});

test('feature embed frames detailed showcases for the features channel', () => {
  const e = buildFeatureEmbed({ title: 'Dashboard & tiles', body: 'Long-form detail.', date: '2026-07-31' });
  assert.equal(e.title, '✨ Dashboard & tiles');
  assert.equal(e.description, 'Long-form detail.');
  assert.equal(e.color, 0x57f287);
  assert.equal(e.footer.text, '2ndMonitor Features • 2026-07-31');
});

test('info embed frames evergreen posts for the info channel', () => {
  const e = buildInfoEmbed({ title: 'Roadmap', body: 'Where we are headed.', date: '2026-07-31' });
  assert.equal(e.title, '📘 Roadmap');
  assert.equal(e.description, 'Where we are headed.');
  assert.equal(e.color, 0x5bc0de);
  assert.equal(e.footer.text, '2ndMonitor Info • 2026-07-31');
});

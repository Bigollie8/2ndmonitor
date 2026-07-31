import test from 'node:test';
import assert from 'node:assert/strict';
import { parseChangelog } from './changelog.mjs';

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

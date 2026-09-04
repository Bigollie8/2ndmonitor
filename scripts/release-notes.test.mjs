import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseChangelog, buildReleaseEmbed, buildSpotlightEmbed } from './changelog.mjs';

const script = fileURLToPath(new URL('./release-notes.mjs', import.meta.url));
const entry = parseChangelog(readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8'))[0];

test('release CLI emits the current changelog for both version and tag input', () => {
  for (const version of [entry.version, `v${entry.version}`]) {
    const result = spawnSync(process.execPath, [script, version], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), entry.body);
  }
});

test('missing release notes fail instead of publishing a placeholder', () => {
  const result = spawnSync(process.execPath, [script, '0.0.0'], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
});

test('the current release produces both Discord messages within the embed limit', () => {
  const release = buildReleaseEmbed(entry);
  const spotlight = buildSpotlightEmbed(entry);
  assert.ok(spotlight, 'the features webhook must have a spotlight to send');
  for (const embed of [release, spotlight]) {
    assert.ok(embed.title.includes(entry.version));
    assert.ok(embed.description.length > 0 && embed.description.length <= 4096);
  }
});

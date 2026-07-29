import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  dedupePrs,
  mapItems,
  repoFromUrl,
  type GithubPr,
  type RawIssueItem,
} from './github';

// ─── repoFromUrl ─────────────────────────────────────────────────────────────

test('repoFromUrl: extracts owner/repo from a GitHub API repository_url', () => {
  assert.equal(
    repoFromUrl('https://api.github.com/repos/anthropics/claude-code'),
    'anthropics/claude-code',
  );
});

test('repoFromUrl: handles owners/repos with dots and dashes', () => {
  assert.equal(
    repoFromUrl('https://api.github.com/repos/my-org.io/some_repo-2.0'),
    'my-org.io/some_repo-2.0',
  );
});

test('repoFromUrl: undefined input returns empty string', () => {
  assert.equal(repoFromUrl(undefined), '');
});

test('repoFromUrl: URL without a repos/ segment returns empty string', () => {
  assert.equal(repoFromUrl('https://api.github.com/users/octocat'), '');
});

// ─── mapItems ────────────────────────────────────────────────────────────────

/** Realistic GitHub search-API item (subset of fields the mapper reads). */
function searchItem(overrides: Partial<RawIssueItem> = {}): RawIssueItem {
  return {
    id: 2141592653,
    number: 812,
    title: 'fix: debounce resize observer to stop layout thrash',
    html_url: 'https://github.com/acme/dashboard/pull/812',
    draft: false,
    updated_at: '2026-07-27T18:42:11Z',
    user: { login: 'octocat' },
    repository_url: 'https://api.github.com/repos/acme/dashboard',
    ...overrides,
  };
}

test('mapItems: maps a full search item into a GithubPr with the given bucket', () => {
  const out = mapItems([searchItem()], 'assigned');
  assert.equal(out.length, 1);
  assert.deepEqual(out[0], {
    id: 2141592653,
    number: 812,
    title: 'fix: debounce resize observer to stop layout thrash',
    url: 'https://github.com/acme/dashboard/pull/812',
    repo: 'acme/dashboard',
    user: 'octocat',
    draft: false,
    updatedAt: '2026-07-27T18:42:11Z',
    bucket: 'assigned',
  });
});

test('mapItems: fills defaults for missing optional fields', () => {
  const out = mapItems([{
    number: 3,
    html_url: 'https://github.com/acme/widgets/pull/3',
  }], 'authored');
  assert.equal(out.length, 1);
  const pr = out[0]!;
  assert.equal(pr.id, 0);
  assert.equal(pr.title, '(untitled)');
  assert.equal(pr.repo, '');
  assert.equal(pr.user, '');
  assert.equal(pr.draft, false);
  assert.equal(pr.updatedAt, '');
  assert.equal(pr.bucket, 'authored');
});

test('mapItems: drops items missing number or html_url', () => {
  const out = mapItems([
    searchItem({ number: undefined }),               // no number → dropped
    searchItem({ html_url: undefined }),             // no url → dropped
    searchItem({ id: 7, number: 42 }),               // valid → kept
  ], 'review-requested');
  assert.equal(out.length, 1);
  assert.equal(out[0]!.number, 42);
});

test('mapItems: draft flag is preserved', () => {
  const out = mapItems([searchItem({ draft: true })], 'authored');
  assert.equal(out[0]!.draft, true);
});

test('mapItems: undefined items returns empty array', () => {
  assert.deepEqual(mapItems(undefined, 'assigned'), []);
});

// ─── dedupePrs ───────────────────────────────────────────────────────────────

function pr(id: number, bucket: GithubPr['bucket']): GithubPr {
  return {
    id,
    number: id,
    title: `PR ${id}`,
    url: `https://github.com/acme/dashboard/pull/${id}`,
    repo: 'acme/dashboard',
    user: 'octocat',
    draft: false,
    updatedAt: '2026-07-27T00:00:00Z',
    bucket,
  };
}

test('dedupePrs: a PR in multiple buckets keeps only its first occurrence', () => {
  // PR 10 is both review-requested and authored — the review-requested copy
  // (first list passed) wins.
  const out = dedupePrs([
    [pr(1, 'assigned')],
    [pr(10, 'review-requested'), pr(2, 'review-requested')],
    [pr(10, 'authored'), pr(3, 'authored')],
  ]);
  assert.deepEqual(out.map((p) => p.id), [1, 10, 2, 3]);
  assert.equal(out.find((p) => p.id === 10)!.bucket, 'review-requested');
});

test('dedupePrs: no duplicates → concatenation in order', () => {
  const out = dedupePrs([[pr(1, 'assigned')], [pr(2, 'review-requested')], [pr(3, 'authored')]]);
  assert.deepEqual(out.map((p) => p.id), [1, 2, 3]);
});

test('dedupePrs: empty input returns empty array', () => {
  assert.deepEqual(dedupePrs([]), []);
  assert.deepEqual(dedupePrs([[], []]), []);
});

test('dedupePrs: duplicate within a single bucket is also collapsed', () => {
  const out = dedupePrs([[pr(5, 'assigned'), pr(5, 'assigned')]]);
  assert.equal(out.length, 1);
});

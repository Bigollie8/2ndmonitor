# GitHub PRs

Fetches GitHub's public `search/issues` API and shows open pull requests
**review-requested from you**. Migrated from the built-in `GithubPrsTile`,
with real capability loss from three buckets down to one — read on before
installing.

## One bucket, not three — read why

The built-in fires three separate `search/issues` queries (`assigned`,
`review-requested`, `authored`) via a Tauri command
(`invoke('fetch_github_prs', …)`, `market.rs`) and merges/dedupes them
client-side (`github.ts`'s `dedupePrs`). A declarative tile has exactly one
`source.url` and no loop, batching, or merge primitive — see
`tile-stocks/README.md`'s "One symbol, not a watchlist" for the same
constraint applied to a different built-in. So this bundle sends **one**
query instead of three: `review-requested:<user>` — the bucket that most
directly answers "does something need my attention right now," and the one
GitHub's own PR badge count is built around. `assigned` and `authored` are
not available from this bundle at all.

GitHub's search doesn't reliably support OR-of-qualifiers (the same reason
`github.ts` fires three separate requests rather than one combined query —
see its own header comment), so there's no clever single query that
recovers all three buckets either.

## Verified live, unauthenticated

The endpoint, query syntax, and response shape were all confirmed live
2026-07-31 against `https://api.github.com/search/issues` (no PAT
available in this environment, so verification used GitHub's generous
unauthenticated rate limit rather than a real token):

- `GET https://api.github.com/search/issues?q=is%3Aopen%20is%3Apr%20review-requested%3Atorvalds%20archived%3Afalse&per_page=30` → `200`, no redirect, well-formed JSON.
- A broader query (`repo:microsoft/vscode`) confirmed the real item shape:

```json
{
  "total_count": 2327,
  "items": [
    {
      "number": 328458,
      "title": "Investigate and add unit tests for Chat Completions issue",
      "html_url": "https://github.com/microsoft/vscode/pull/328458",
      "user": { "login": "vritant24" }
    }
  ]
}
```

This matches `github.ts`'s own `RawIssueItem` parsing exactly
(`number`, `title`, `html_url`, `user.login`) — the auth-only part
(`Authorization: Bearer <token>`) could not be exercised live, but the
header name/format mirrors `market.rs`'s `fetch_github_prs` verbatim
(`Bearer {token}`, plus the same `Accept: application/vnd.github+json`).

- `select: "items"`, row `left` is `#{{item.number}}`, `title` is
  `{{item.title}}`, `right` is `{{item.user.login}}` (the PR author, since
  `repo` — the bucket label the built-in shows in `right` — isn't a field
  the response returns directly at this shape; deriving it would need
  `repoFromUrl`'s regex over `repository_url`, which the template grammar
  can't do), `openUrl` is `{{item.html_url}}` so clicking a row opens the
  PR, matching the built-in's `PrRow onClick`.

## Why an explicit `User-Agent` header

Confirmed live: GitHub's API 403s a request sent with an explicitly empty
User-Agent, but accepts any non-empty one (curl's own default UA passed).
`broker_fetch` (Rust, `marketplace.rs`) builds its request with `ureq`,
whose default UA behavior isn't something this bundle should depend on, so
`view.json` sets `User-Agent: 2ndMonitorHub-Tile/1.0` explicitly rather
than hoping the underlying HTTP client's default is good enough forever.

## Known limitations

- Only the `review-requested` bucket — see above. No PRs you authored or
  are assigned to (not review-requested) show up here at all.
- No draft styling — the built-in dims draft PRs (`pr.draft ? …`); the
  `list` view has no conditional styling, so drafts render identically to
  ready-for-review PRs.
- `config.user` substitutes into the query string unencoded — fine for a
  normal GitHub username (`[A-Za-z0-9-]`, GitHub's own rule), but would
  break for anything containing a `%`, space, or other character requiring
  percent-encoding (not a valid GitHub username shape anyway).
- `intervalMs` is 300000 (5m), matching the built-in's `REFRESH_MS`.

`net:api.github.com` only. Secret: `github_pat`. Config: `user` (GitHub
username, required — starts unconfigured).

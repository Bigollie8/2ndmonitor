# Daily challenge

Fetches LeetCode's public `activeDailyCodingChallengeQuestion` GraphQL query
— the same query `state/dailyChallenge.ts`'s `fetchDailyChallenge` sends —
and shows today's problem title, difficulty, acceptance rate, and a link.

## Why GET, not POST

The built-in component POSTs a JSON body to `https://leetcode.com/graphql`.
A declarative `http` source has no `method` or `body` field (see
`TileSource` in `viewSpec.ts`), and the host's `broker_fetch` (Rust,
`src-tauri/src/marketplace.rs`) only ever issues `ureq::get` — there is no
POST path for tile fetches. LeetCode's GraphQL endpoint accepts the same
query as GET params, though, so `source.url` sends the full query and
`operationName` as a URL-encoded query string instead. Confirmed live
2026-07-30 — GET and POST return the same shape for this query.

## Fields

Real response, fetched live 2026-07-30:

```json
{"data":{"activeDailyCodingChallengeQuestion":{
  "date":"2026-07-30",
  "link":"/problems/minimum-number-of-pushes-to-type-word-i/",
  "question":{
    "questionId":"3275","titleSlug":"minimum-number-of-pushes-to-type-word-i",
    "title":"Minimum Number of Pushes to Type Word I","difficulty":"Easy",
    "acRate":70.22912315748056
  }
}}}
```

Renders with `rows` (no `select` needed — every value is referenced by its
full path from the response root): `Problem` is
`{{data.activeDailyCodingChallengeQuestion.question.title}}`, `Difficulty`
is `.difficulty`, `Accept rate` is `.acRate` (with a literal `%` appended
in the template string), `Link` is
`https://leetcode.com{{data.activeDailyCodingChallengeQuestion.link}}`
(prefixed with the host, since the API returns a path, not a full URL).

**Revision note:** the first draft of this bundle used `list` selecting
`question.topicTags`, rendering one row per topic tag — which meant the
challenge's actual title never appeared anywhere on the tile; a user could
see "Math", "String", "Greedy" but not know what problem those tags
belonged to without clicking through. `rows` fixes that: the title is now
front and center.

The GraphQL query intentionally does **not** request `question.content`
(the HTML problem statement the built-in strips and previews): `{{path}}`
substitution renders raw strings into React text nodes, so embedding raw
HTML would show literal `<p>` tags rather than stripped text — there is no
HTML-stripping primitive here, unlike `stripHtml()` in
`state/dailyChallenge.ts`. `rows` also has no clickable-link affordance
(unlike `list`'s `row.openUrl`), so `Link` is shown as a plain URL string
rather than something you can click — a `rows` tradeoff for showing the
title, accepted here since knowing the problem's name is more valuable
than a raw URL being tappable.

No secrets; no config.

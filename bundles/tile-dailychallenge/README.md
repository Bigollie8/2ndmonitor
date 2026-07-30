# Daily challenge

Fetches LeetCode's public `activeDailyCodingChallengeQuestion` GraphQL query
— the same query `state/dailyChallenge.ts`'s `fetchDailyChallenge` sends —
and lists today's problem topics, each linking to the problem.

## Why GET, not POST

The built-in component POSTs a JSON body to `https://leetcode.com/graphql`.
A declarative `http` source has no `method` or `body` field (see
`TileSource` in `viewSpec.ts`), and the host's `broker_fetch` (Rust,
`src-tauri/src/marketplace.rs`) only ever issues `ureq::get` — there is no
POST path for tile fetches. LeetCode's GraphQL endpoint accepts the same
query as GET params, though, so `source.url` sends the full query and
`operationName` as a URL-encoded query string instead. Confirmed live
2026-07-29 — GET and POST return the same shape for this query.

## Fields

Real response (abbreviated, `content` omitted — see below):

```json
{"data":{"activeDailyCodingChallengeQuestion":{
  "date":"2026-07-30",
  "link":"/problems/minimum-number-of-pushes-to-type-word-i/",
  "question":{
    "questionId":"3275","titleSlug":"minimum-number-of-pushes-to-type-word-i",
    "title":"Minimum Number of Pushes to Type Word I","difficulty":"Easy",
    "acRate":69.9,"topicTags":[{"name":"Math"},{"name":"String"},{"name":"Greedy"}]
  }
}}}
```

`select` is `data.activeDailyCodingChallengeQuestion.question.topicTags`;
`list` renders one row per topic (`{{item.name}}`), each carrying the
challenge's difficulty (`right`) and a link back to the problem
(`openUrl`, `data.activeDailyCodingChallengeQuestion.link` prefixed with the
host since the API returns a path, not a full URL).

The GraphQL query intentionally does **not** request `question.content`
(the HTML problem statement the built-in strips and previews): `{{path}}`
substitution renders raw strings into React text nodes, so embedding raw
HTML would show literal `<p>` tags rather than stripped text — there is no
HTML-stripping primitive here, unlike `stripHtml()` in
`state/dailyChallenge.ts`. Title/difficulty/acceptance-rate/topics are
reachable and are what this tile shows; the free-text preview is not.

No secrets; no config.

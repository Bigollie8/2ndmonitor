# Quote of the day

Fetches `https://zenquotes.io/api/today` (public, key-less, CORS-friendly)
every hour and shows today's quote with its author. Migrated from the
built-in `QuoteTile` — same endpoint, same refresh cadence.

## Fields

The real response is a bare top-level JSON array with one element, e.g.
(fetched live 2026-07-30):

```json
[{"q":"It isn't that they can't see the solution. It is that they can't see the problem.","a":"Gilbert Chesterton","i":"https://zenquotes.io/img/gilbert-chesterton.jpg","h":"<blockquote>...</blockquote>","date":"2026-07-30"}]
```

`body` is `{{data.0.q}}`, `attribution` is `{{data.0.a}}` — the `0` indexes
the array's first (and, for this endpoint, only) element via a literal
integer path segment (`select`/`{{path}}` now allow one, see
`viewSpec.ts`'s `DOT_PATH` / `template.ts`'s `PLACEHOLDER`); `select` itself
is omitted, so `data` in the template scope is the raw response array.
Renders with the `text` primitive: an italic quote with the author
right-aligned below it, matching the built-in `QuoteTile`'s layout —
`list` (this bundle's first draft, before the grammar supported array
indexing) truncated long quotes to one line via its row's `nowrap`
ellipsis; `text` wraps up to six lines like the built-in.

## Limitation

This endpoint returns one quote per day, not a rotating feed — refetching
within the same day returns the same quote (there's no per-request random
pick server-side), matching the built-in's cadence. Unlike the built-in,
this tile has no local day-keyed cache, so a poll right at day rollover
could show a brief transition the built-in's cache would have smoothed
over; not worth a config/cache workaround for a cosmetic edge case.

No permissions beyond `net:zenquotes.io`; no secrets; no config.

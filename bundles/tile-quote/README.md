# Quote of the day

Fetches `https://zenquotes.io/api/today` (public, key-less, CORS-friendly)
every hour and shows today's quote with its author. Migrated from the
built-in `QuoteTile` — same endpoint, same refresh cadence.

## Primitive

Uses `list`, not `text`. The real response is a bare JSON array —
`[{"q": "...", "a": "...", "i": "...", "h": "...", "date": "..."}]` — never a
plain object. `select` and `{{path}}` are dot-path only (no array indexing,
by design — see `viewSpec.ts`), so a `text`/`stat`/`rows`/`badge` view can
never reach into element `0` of that array. `list` is the only primitive
that consumes an array directly, so `select` is omitted (the response is
already the array `list` expects) and each row renders one quote:
`row.title` is `{{item.q}}`, `row.right` is `{{item.a}}`. In practice the
endpoint returns exactly one element, so this renders as a single row —
visually close to the built-in's italic quote + right-aligned attribution,
though without the built-in's larger type treatment (the `list` primitive
has no "text at 14px, attribution right-aligned below" layout of its own).

No permissions beyond `net:zenquotes.io`; no secrets; no config.

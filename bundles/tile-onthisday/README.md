# On this day

Fetches `https://api.wikimedia.org/feed/v1/wikipedia/en/onthisday/events/<mm>/<dd>`
(Wikipedia's "on this day" feed, public, key-less, generous CORS) and shows
that date's historical events. Migrated from the built-in `OnThisDayTile`,
with one deliberate behavior change — read on.

## Why `/events/`, not `/all/` — read this before "simplifying" back

The feed has two shapes at the same host: `/onthisday/all/<mm>/<dd>` bundles
`selected`, `births`, `deaths`, `events` and `holidays` into one payload;
`/onthisday/events/<mm>/<dd>` returns `events` alone. This tile only ever
rendered `events` (see Fields below), but it originally shipped pointed at
`/all/` anyway, because Task 1 verified it with bare `curl`, which has no
size limit. `broker_fetch` — the only network path a bundle tile can
actually use — does: `FETCH_CAP` in `app/src-tauri/src/marketplace.rs` caps
every response at 1 MiB (1,048,576 bytes), and `/all/07/31` measured
**1,470,210 bytes** live, ~40% over. Every fetch through the real app
failed with `TileError "response too large"` — deterministically, for
every date, for every user; confirmed in packaged-build verification
(Task 4). `/events/07/31` measured **413,994 bytes** live on the same
date — 39% of the cap, comfortably clear with room for a busier news date.
The response shape for `events` itself is unchanged between the two
endpoints (both put a top-level `events` array at the response root, no
`data` envelope on either), so `select: "events"` and every path below
still resolve exactly as documented — only the URL and the payload size
differ.

## Pinned date, not a rolling "today" — read why

The built-in computes `mm`/`dd` from `new Date()` on every poll, so it
always shows *today's* events and rolls forward at midnight automatically.
A declarative tile's `source.url` is a fixed template substituted only from
`config`/`secret` — there is no way to inject "the current date" into it (no
date arithmetic, no clock access in the template grammar; see
`tiles/template.ts`'s header comment). This is the same category of gap
`tile-dictionary`'s README documents for the retired "word of the day" tile,
solved the same way: **pin one value via `config` instead of trying to
rotate it**. `config: month` / `config: day` (both `type: "text"`, entered
as 2-digit strings — see below) are substituted into `source.url`, so this
tile shows history for **whichever date you configure**, not necessarily
today. Install it once per date you want pinned, the same way you'd pin a
dictionary word or a stock symbol; re-open the tile's setup panel to change
the date (e.g. to re-pin it each morning, if that's the workflow you want).

### Why 2-digit *text*, not a `number` config

Wikimedia's endpoint 404s on an unpadded single-digit month or day —
confirmed live: `.../events/7/31` → 404, `.../events/07/31` → 200. A `number`
config's template substitution has no zero-pad step (`render()` just calls
`String(v)`), so `config.month = 7` would render as `7` and break every
month before October. A `text` config lets the user type the zero-padded
string directly (`"07"`), which substitutes verbatim and always resolves.

## Fields

`select` is `events` (the array of historical events for the pinned date —
`/events/` returns only this array, so there's no `births`/`deaths` to
select away anymore, but the field stays named the same as the array it
targets — `events` matches the built-in's default tab). Real response for
`07/31` from the live `/events/` endpoint (fetched 2026-07-31, top-level
keys `["events"]`, 55 items, 413,994 bytes total), first element:

```json
{"text":"A De Havilland Canada DHC-2 Beaver and Piper PA-12 Super Cruiser collide over Soldotna, Alaska, killing all seven people on board both aircraft, including state representative Gary Knopp.","pages":[{"content_urls":{"desktop":{"page":"https://en.wikipedia.org/wiki/De_Havilland_Canada_DHC-2_Beaver"}}}],"year":2020}
```

Resolved against the real response: `{{item.year}}` → `2020`,
`{{item.text}}` → the sentence above, `{{item.pages.0.content_urls.desktop.page}}`
→ `https://en.wikipedia.org/wiki/De_Havilland_Canada_DHC-2_Beaver`. Renders
with the `list` primitive: year on the left, event text as the row title,
click-through to the linked article, and `row.right` set to
`"{{config.month}}/{{config.day}}"` on every row, e.g. `07/31`.

### The pinned date is shown on every row — read why

A tile named "On this day" implies currency. Because the date is pinned
(see above), a tile installed today and never reopened would keep showing
that day's history indefinitely while looking identical to a live "today"
feed — a silent staleness bug with no on-screen cue. `row.right` costs
nothing extra to fetch (`config.month`/`config.day` are already in scope)
and turns that into a visible fact: every row states which date it's
showing, so a user looking at this tile a month after installing it sees
`07/31` printed on the date they'd otherwise mistake for today's.

## Known limitations

- No births/deaths tabs — `list` renders one `select`-ed array; the built-in's
  tab switcher has no declarative equivalent.
- A birth/death/event entry with no linked page renders no `openUrl` (the
  row just isn't clickable) — same as the built-in's `it.url` being `null`.
- `intervalMs` is 21600000 (6h), matching the built-in's `REFRESH_MS`. Well
  above the 15s floor; no adjustment needed.
- `config.month`/`config.day` have no zero-pad enforcement — the input is
  freeform `text`, so an unpadded or invalid value 404s. That's a loud
  `TileError`, not a silent wrong answer, so it's a rough edge rather than
  a bug worth adding validation for.

No secrets. `config`: `month`, `day` (both required before the tile can
fetch — it starts unconfigured, same "needs setup" state as any tile with
unfilled config).

## Coexists with the built-in — does not replace it

Per the migration's Task 1 review: this bundle pins a date instead of
rolling forward automatically, which is a real behavior change from the
built-in `OnThisDayTile`, not just an implementation detail — so the
built-in is **not** being retired in favor of this bundle. Both are
available; install this one if "history for a date I choose, that stays
put until I change it" is what you actually want.

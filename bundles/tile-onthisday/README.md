# On this day

Fetches `https://api.wikimedia.org/feed/v1/wikipedia/en/onthisday/all/<mm>/<dd>`
(Wikipedia's "on this day" feed, public, key-less, generous CORS) and shows
that date's historical events. Migrated from the built-in `OnThisDayTile`,
with one deliberate behavior change — read on.

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
confirmed live: `.../all/7/31` → 404, `.../all/07/31` → 200. A `number`
config's template substitution has no zero-pad step (`render()` just calls
`String(v)`), so `config.month = 7` would render as `7` and break every
month before October. A `text` config lets the user type the zero-padded
string directly (`"07"`), which substitutes verbatim and always resolves.

## Fields

`select` is `events` (the array of historical events for the pinned date;
`births`/`deaths` are also in the response but a declarative tile can only
render one array — `events` matches the built-in's default tab). Real
response for `07/31` (fetched live 2026-07-31), first element:

```json
{"text":"A De Havilland Canada DHC-2 Beaver and Piper PA-12 Super Cruiser collide over Soldotna, Alaska, killing all seven people on board both aircraft, including state representative Gary Knopp.","pages":[{"content_urls":{"desktop":{"page":"https://en.wikipedia.org/wiki/De_Havilland_Canada_DHC-2_Beaver"}}}],"year":2020}
```

Resolved against the real response: `{{item.year}}` → `2020`,
`{{item.text}}` → the sentence above, `{{item.pages.0.content_urls.desktop.page}}`
→ `https://en.wikipedia.org/wiki/De_Havilland_Canada_DHC-2_Beaver`. Renders
with the `list` primitive: year on the left, event text as the row title,
click-through to the linked article.

## Known limitations

- No births/deaths tabs — `list` renders one `select`-ed array; the built-in's
  tab switcher has no declarative equivalent.
- A birth/death/event entry with no linked page renders no `openUrl` (the
  row just isn't clickable) — same as the built-in's `it.url` being `null`.
- `intervalMs` is 21600000 (6h), matching the built-in's `REFRESH_MS`. Well
  above the 15s floor; no adjustment needed.

No secrets. `config`: `month`, `day` (both required before the tile can
fetch — it starts unconfigured, same "needs setup" state as any tile with
unfilled config).

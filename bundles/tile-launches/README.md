# Space launches

Fetches `https://ll.thespacedevs.com/2.2.0/launch/upcoming/?limit=8&mode=list`
(The Space Devs Launch Library 2, public, key-less, CORS-friendly, 15
req/h anonymous rate limit) and lists upcoming launches. Migrated from the
built-in `LaunchesTile` — same endpoint and cadence, different fields, for a
reason worth documenting.

## `mode=list` is flatter than the built-in's parser expects — read why

The built-in's `RawLaunch`/`toLaunch()` (`state/launches.ts`) reads
`launch_service_provider.name`, `pad.name`/`pad.location.name`,
`mission.name`, `rocket.configuration.name`, and `image.image_url` —
nested-object shapes. The **live** `mode=list` response does not have any
of those nested objects: each result carries flat `lsp_name` (string),
`pad` (string), `location` (string), `mission` (string), `image` (string
URL), and there is no `rocket` field at all. Confirmed by fetching the
built-in's exact URL and printing `Object.keys(results[0])` — this is what
`mode=list` actually returns today, not what the TS types assume. (Whether
this makes the built-in itself under-render some fields is outside this
task's scope — built-ins are not touched here, per Task 3.) This bundle's
`view.json` was written against the fields that are actually present, not
against the built-in's type definitions.

## Fields

Real response, fetched live 2026-07-31 (`select: "results"`), first
element:

```json
{
  "name": "Falcon 9 Block 5 | Starlink Group 17-52",
  "status": {"name": "Go for Launch", "abbrev": "Go"},
  "net": "2026-08-01T02:59:28Z",
  "lsp_name": "SpaceX",
  "mission": "Starlink Group 17-52",
  "pad": "Space Launch Complex 4E",
  "location": "Vandenberg SFB, CA, USA"
}
```

Resolved: `{{item.status.abbrev}}` → `Go`, `{{item.name}}` →
`Falcon 9 Block 5 | Starlink Group 17-52`, `{{item.lsp_name}}` → `SpaceX`,
`{{item.net}}` → `2026-08-01T02:59:28Z`. Renders with the `list` primitive:
status abbreviation on the left, mission name as the row title, provider +
raw ISO launch time on the right (`"{{item.lsp_name}} · {{item.net}}"` —
two placeholders in one template string, which `substitute()` supports).

## Known limitations

- `net` renders as a raw ISO-8601 timestamp (`2026-08-01T02:59:28Z`), not
  the built-in's "T-6h 30m" relative countdown — the template grammar has
  no date arithmetic, and there is no ticking clock driving a re-render
  every minute the way the built-in's `now` state does.
- No status-color coding (the built-in colors "Go" green, "Hold"/"Failure"
  red) — the view format has no conditional styling.
- No `openUrl` — the built-in's `LaunchRow` isn't clickable either (no
  `onClick`/`href` in the source), so this isn't a regression.
- `intervalMs` is 1800000 (30m), matching the built-in's `REFRESH_MS` and
  its comment about the 15 req/h anonymous rate limit. No adjustment
  needed.

No secrets, no config. `net:ll.thespacedevs.com` only.

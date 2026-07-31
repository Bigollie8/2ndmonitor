# Recent birds

Fetches eBird's public `obs/geo/recent` endpoint and lists recent bird
observations near a point. Migrated from the built-in `BirdsTile`, with one
real capability loss: location must be entered manually instead of coming
from the app's configured weather location — read on before installing.

## Manual lat/lon, not the app's weather location — read why

The built-in receives `location: WeatherLocation` as a prop from the app
shell (`state/weatherLocation.ts`) and reads `location.lat` / `location.lon`
automatically. `DeclarativeTile.tsx`'s template scope declares an optional
`location` root (`tiles/template.ts`'s `TemplateScope`, and
`sandbox/bundles.test.ts`'s `ALLOWED_ROOTS` already permits
`{{location.*}}` in a view spec) — but nothing in `DeclarativeTile.tsx`
actually populates it yet: `buildRequest` is called with only
`{ config, secret }`, never `location` (confirmed by reading the component
end to end, not just the type declaration). So `{{location.lat}}` would
validate and then silently resolve to nothing.

Given that, this bundle exposes `lat` / `lon` as `config` (`type:
"number"`) instead — the user types their own coordinates once at setup,
same pattern as `tile-stocks`'s `config.symbol`. This is a real, permanent
UX regression versus the built-in (no auto-detected location), not a
temporary one — it will stay this way unless/until `DeclarativeTile.tsx` is
changed to actually wire `location` into the render *and* fetch scopes.

## Verified live, unauthenticated

`https://api.ebird.org/v2/data/obs/geo/recent?lat=40.7128&lng=-74.0060&dist=25`
(fetched live 2026-07-31, no key) returned `403 Forbidden` with an empty
body — no redirect, confirming the endpoint, host, and query-param names
(`lat`, `lng`, `dist`) are correct, but the response *shape* for a
successful authenticated call could not be exercised (no free eBird key
available in this environment). The item fields below (`comName`,
`locName`) are therefore derived from `state/ebird.ts`'s own
`RawObservation` parser, not confirmed against a live 200 response —
`fetchRecentBirds` there expects a bare top-level JSON array of objects
with `speciesCode`, `comName`, `sciName`, `obsDt`, `howMany`, `locName`,
matching eBird's long-published, stable API shape.

`select` is omitted (root response is a bare array, same pattern as
`tile-quote`); row `title` is `{{item.comName}}` (common name), `right` is
`{{item.locName}}` (observation location) — matching the built-in's
`BirdRow`. The built-in also shows a `×{{howMany}}` count badge; that field
is dropped here for the same reason `tile-stocks` drops delta coloring —
keeping this bundle to the two fields confirmed present on essentially
every observation record, since `howMany` is nullable in the source parser
and the `list` view has no conditional "only show if present" primitive.

## Known limitations

- No auto-detected location (see above) — `config.lat` / `config.lon`,
  entered once, do not track the app's weather-location setting if the
  user changes it later.
- No client-side radius clamp — the built-in clamps `radiusKm` to `[1,
  50]` (`Math.min(50, Math.max(1, radiusKm))`); `config.radiusKm` here is
  passed straight through, so an out-of-range value is whatever eBird does
  with it (unverified, since testing requires a key).
- No distance badge, no `×N` count badge — see above.
- `intervalMs` is 900000 (15m), matching the built-in's `REFRESH_MS`.

`net:api.ebird.org` only. Secret: `ebird_key`. Config: `lat`, `lon`,
`radiusKm` (all required — starts unconfigured).

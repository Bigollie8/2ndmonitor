# 0.9.18 — maps back, F11 exact, pet tile, session perf log

Five Discord items, worked in the `worktree-v0.9.18` worktree on 2026-09-06.

## Map basemap (Radar, Aircraft, ISS, Lightning)

- **Verified failure:** `basemaps.cartocdn.com/dark_all` answers uncached tiles with HTTP 200 and an
  "API KEY REQUIRED" watermark PNG (`carto.com/basemaps/apikey`). Tiles still in CARTO's CDN cache
  (`Age` in the hundreds of thousands of seconds) came back as real map, which is why the break
  looked partial. A 200 with an error picture never reaches `img.onerror`, so no retry path helped.
- **Replacement:** Esri World Dark Gray Base (`services.arcgisonline.com/.../Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}`),
  keyless, `Access-Control-Allow-Origin: *`, 256 px tiles, data to z16. Note the **z/y/x** path
  order — locked by `basemap.test.ts`. Stadia (401 without key), OpenFreeMap (vector only),
  Wikimedia (Wikimedia-projects-only policy) and OSM (tile policy forbids app distribution) were
  ruled out.
- **Look:** the Esri canvas is mid-gray, so `MapView` fills `BASEMAP_DIM` over the base tiles
  before overlays (one rect per repaint; idle maps do not repaint). Radar "Universal Blue" and
  aircraft/lightning dots keep their contrast.
- **Attribution:** `BASEMAP_ATTRIBUTION` = "Powered by Esri — Esri, HERE, Garmin, © OpenStreetMap
  contributors, and the GIS user community" (the MapServer's own `copyrightText` plus Esri's
  required "Powered by Esri"); the credit wraps to 85% width on small tiles.
- `MAX_TILE_Z` in slippy.ts moved 19 → 16 to match the provider's data depth. Every map tile caps
  its view zoom at 12 or lower, and `visibleTiles` scales the deepest level past it, so no user-visible
  zoom range changed. `mapConfig.test.ts` now asserts against the constants rather than `19`.
- Not changed: LRU caches, `crossOrigin='anonymous'`, CSP (`img-src https:` already covers the host).

## F11 (round 6)

- The 2026-08-07 report (target 3440,212, settled 3448,213, size exact) predates the round-5
  feedback loop shipped in 0.9.3, so the tester was still on round 4. The offset itself is now
  explained from tao 0.34.8 `platform_impl/windows`: for an undecorated window with shadow,
  `WM_NCCALCSIZE` insets the client rect by `SM_CXSIZEFRAME + SM_CXPADDEDBORDER` (8 px at 96 dpi)
  on left/right/bottom and `round(dpi/96)` (1 px on Windows 11, 0 on Windows 10) on top;
  `set_outer_position` moves the window rect while `inner_position` reads the client origin; and
  `set_inner_size` already adds the frame to the requested client size. That is exactly "+8,+1,
  size right".
- `convergeOnRect` in `state/f11.ts` now pre-measures the frame (outer vs inner origin/size of the
  standing window) and sends a frame-compensated first request, then runs the round-5 feedback
  loop. Under the tao model it lands on pass 1; without a pre-measurement it lands on pass 2; a
  stuck window still gives up after 5 passes with the request bounded by `MAX_CORRECTION`.
- The loop is driver-injected, so `f11.test.ts` drives the real loop against a model of tao's
  geometry (the reporter's exact rects, Windows 10 insets, a frame that changes mid-loop, macOS
  frameless, and the stuck-window failure path). App.tsx only adapts `getCurrentWindow()`.
- The diagnostic card gained a `frame :` line so a future report says whether the offset was the
  shadow frame. Always-on-top and glass re-assert behaviour are untouched.

## Visualizer gallery ring

- The user's screenshot (active MilkDrop card) shows notched corners on the selected card: a 2 px
  border on the active card vs 1 px elsewhere, under `overflow: hidden` with `border-radius: 12`,
  so the clip arc and the border arc differed and the content shifted a pixel on selection.
- Every card now keeps a 1 px border (colour-only change on select/hover) and the selected card
  draws its ring as a click-through overlay inside the clip (`inset 0 0 0 2px accent`, radius 11).
  No layout shift, no seam. Which style gets applied is unchanged.

## Pet tile

- New built-in `pet` tile (`state/pet.ts` pure logic, `components/PetTile.tsx`, category
  Ambient). Not first-party in the `firstParty.ts` sense — it needs no native capability.
- State lives in Tweaks under `pet` and is re-hydrated on every read (`hydratePet`), so a missing
  or corrupt object degrades to a fresh pet. Hunger 0→100 over 8 h, Joy 100→0 over 12 h (×2 while
  hungry, split correctly at the threshold), elapsed time capped at 24 h, never dies. Actions:
  Feed (−35 hunger, +5 joy unless already full), Play (+25 joy, +5 hunger), Pet (+10 joy).
  Mood priority hungry → sad → sleepy (23:00–06:59 local) → happy → content.
- Idle cost: no rAF; a 60 s re-render interval; persistence of ticks every 5 min plus on every
  action; idle motion is transform/opacity CSS keyframes, disabled under `prefers-reduced-motion`.

## Session performance log

- `perf/perfLog.ts`: ring buffer of `PerfSample`s (2 s interval × 3600 = 2 h; ~2 MB typical,
  ~3.5 MB ceiling), min/avg/max/p95 aggregation, top-drawer and surface reducers, JSON (versioned,
  round-trips) and RFC 4180 CSV serialisers. No DOM at module top level.
- `perf/debug.ts` keeps cumulative totals in the hot paths that already exist behind `state.enabled`
  and starts/stops the sampler from `enable()`/`disable()`; disable drops the buffer. No second
  measurement path.
- `PerfDebugHUD` shows a Session log section: sample count, span, GPU avg/max, fps avg, long-task
  totals, heap max, with Copy JSON / Copy CSV / Save JSON / Save CSV / Clear.

## Validation

- `npm test`: **1366 pass, 0 fail** (baseline 1297; +69: F11 loop 8, basemap 5, pet 30, perf log 26).
- `npx tsc -b`: clean. `npm run build`: production frontend built.
- Root script suite: 33 pass, 1 pre-existing failure (six `meter` visualizer entries in
  `bundles/metadata.json`, documented since 0.9.16). Changelog/release-note tests pass with the
  0.9.18 section.
- No Rust changes beyond the version bump. No native F11 run on a three-monitor Windows 11 setup
  was possible in this session; the tao geometry is verified from source and under test, not on
  hardware. The gallery ring and pet tile were not screenshot in the packaged app.

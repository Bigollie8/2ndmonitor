# Slice A — Design

**Date:** 2026-04-29
**Project:** 2ndmonitor (`C:\Users\bigol\Documents\Projects\2ndmonitor\app`)
**Scope:** Four UI-bound features that don't require new external integrations.

## Features

1. Configurable weather location (search by city, persisted)
2. Functional drag/resize in edit mode (real layout editor, not a mockup)
3. Interactive todos in the Notes tile (add/check/delete, persisted)
4. Visualizer controls — sensitivity, smoothing, optional color override

## Out of scope (explicitly)

- Per-profile layouts → deferred to Slice B (real profile system)
- Spotify "Up next" + lyrics, AMD/Intel GPU support, perf-budget — separate specs
- Drag-to-reorder layers panel in edit mode

---

## Cross-cutting change: durable tweaks store

`useTweaks` currently writes to `localStorage`. The user wants new state (todos, layout, weather location) to survive even if the WebView2 storage is wiped. Replace the storage backend with a JSON file in the app's data directory.

**Path:** `<AppData>/2ndmonitor/tweaks.json` (Tauri's `app_data_dir()`).

**API (frontend):** `useTweaks` keeps the same signature (`[T, setTweak]`). Internally:

- On mount, async-load via Tauri command `tweaks_load() -> Option<Json>`. Until load resolves, the hook returns `defaults` so first paint isn't blocked.
- On every `setTweak`, debounce (300ms) and call `tweaks_save(json)`.
- Browser fallback (no Tauri): keep current `localStorage` path so `vite dev` works.

**API (Rust):** Two commands in a new `tweaks.rs` module:

```rust
#[tauri::command]
fn tweaks_load(app: AppHandle) -> Option<serde_json::Value> { /* read file, return parsed JSON or None */ }

#[tauri::command]
fn tweaks_save(app: AppHandle, value: serde_json::Value) -> Result<(), String> { /* write atomically: temp file + rename */ }
```

**Migration:** Inside `useTweaks` on first mount, if `tweaks_load()` returns `None` and `localStorage[hub:tweaks:v1]` exists, parse the localStorage blob, persist it via `tweaks_save()`, then use it as the initial state. After that, the file is canonical (localStorage entry can stay; it's ignored on subsequent boots).

**First-paint flicker:** because `tweaks_load` is async, the hook initially returns `defaults`, then re-renders once the file is read. For visual continuity, do the load synchronously enough that it completes before the first React paint isn't possible — so accept a one-frame flicker (under 50ms). Acceptable: alternative would be blocking the whole render tree on a Tauri call, which is worse UX.

**Why this works for all four features:** layout, weather location, todos, and viz controls are all just additional fields in the same blob — no new persistence machinery per feature.

---

## 1. Layout & drag/resize

### Data model

Add to `TweakState`:

```ts
type TileId = 'discord' | 'spotify' | 'claude' | 'notes' | 'viz' | 'sysmon' | 'clock';
type Rect = { x: number; y: number; w: number; h: number };
layout: Partial<Record<TileId, Rect>>;
```

Coordinates are absolute pixels in the 2560×1440 design canvas. The viewport-fit `scale` in `App.tsx` already handles display scaling, so absolute pixels are stable across screen sizes.

When a tile has no entry in `layout`, fall back to a `DEFAULT_LAYOUT` constant — pre-computed once at module load, mirroring the rectangles produced by today's CSS-grid algorithm in `App.tsx` (rail rows + right column with viz on top, sysmon/clock strip below). This way existing users see no visual change on first run, and there's a single source of truth for "reset layout".

### App.tsx restructure

Replace the two-level CSS grid with absolute-positioned tile wrappers:

```tsx
<div className="canvas">  {/* 2560×1440, scaled */}
  <TopChrome ... />
  {visibleTiles.map(id => (
    <TileFrame
      key={id} id={id}
      rect={layout[id] ?? defaultRect[id]}
      editing={editMode}
      onChange={rect => setTweak('layout', { ...layout, [id]: rect })}
    >
      {renderTile(id)}
    </TileFrame>
  ))}
  <BottomStatus ... />
</div>
```

`TileFrame` is the new abstraction. It owns:
- Position/size from `rect`
- In edit mode: pointer-event handlers for drag and 8-handle resize
- Outside edit mode: passes through `pointer-events: auto` so tile internals (Discord buttons, todo checkboxes, Spotify scrubber) work normally

### Drag/resize behavior

- **Drag** (pointer-down on tile body, not a child interactive element): translate `rect.{x,y}` by pointer delta. Snap to 40px grid by default; hold **Alt** to skip snap.
- **Resize** (pointer-down on a corner/edge handle): translate the corresponding rect edges. Same snap rule. Min size 200×140. Max constrained to canvas (`x+w <= 2560`, etc.).
- **Snap toggle**: the `snap` state in the existing `EditToolbar` controls the default. Alt is the per-drag override.
- **Visual feedback**: while dragging, render the existing `SmartGuides` and `SelectionLabel` already in `edit.tsx`. Smart-guide alignment to other tile edges (within 6px) is a stretch — start with center crosshair + canvas-edge distances (already implemented).

### Edit mode rewrite

`EditModeOverlay` becomes a thin overlay (toolbar + grid + properties panel + layers panel) on top of the live canvas. It does NOT render fake tile rectangles anymore — the real `TileFrame`s detect `editMode` and switch into edit-render mode (selection ring, handles, drag handlers).

`PropertiesPanel`'s `PropNum` inputs become controlled — typing into X/Y/W/H updates `layout[selected]`.

### Reset

Add a "Reset layout" button in Tweaks panel → `setTweak('layout', {})`. Reverts every tile to its default rect.

---

## 2. Weather location

### Frontend

New "Weather" subsection in Tweaks panel:

- Read-only label of current location: `"Knoxville, TN"`.
- Search input (debounced 350ms). Calls Open-Meteo geocoding directly from the renderer:
  `https://geocoding-api.open-meteo.com/v1/search?name=<query>&count=5&language=en&format=json`
- Renders up to 5 results as a list: each shows `name, admin1, country` with the lat/lon visible on hover. Click → commit.
- Commit calls `setTweak('weatherLocation', {label, lat, lon})` AND invokes Tauri command `set_weather_location({lat, lon, label})` to nudge the Rust poller for an immediate refetch.

### Rust

`weather.rs` change:

- Replace the `KNOXVILLE_LAT` / `KNOXVILLE_LON` constants with a `Mutex<WeatherLocation>` held in the `WeatherState` resource passed to the polling loop.
- Default value remains Knoxville for first-launch.
- New command:

```rust
#[tauri::command]
async fn set_weather_location<R: Runtime>(
    app: AppHandle<R>, state: State<'_, WeatherState>,
    lat: f64, lon: f64, label: String,
) -> Result<(), String>
```

Updates the mutex, then triggers a one-shot fetch + emit so the UI updates immediately rather than waiting for the next 30-minute tick.

- The location is also restored from `tweaks.json` on app boot (read once during setup, before the poll loop starts).

---

## 3. Todos

### Data model

Add to `TweakState`:

```ts
todos: Todo[];
type Todo = { id: string; text: string; done: boolean; createdAt: number };
```

Hard cap: 50 items (silently drop the oldest done item when adding past the cap).

### NotesTile rewrite

Replace the static markdown body with:

- **Header row**: `"Todos"` left, count summary right (`"3 / 7"`), small muted color.
- **List**: each row is `[checkbox] [text] [×]`. Checkbox is a 12×12 hit target. Text strikes through + dims when `done`. Hover row → × button visible (otherwise hidden); click deletes.
- **Add row** (always visible at bottom): `+ ` icon + text input with placeholder `"Add a todo…"`. Enter commits a new todo with a fresh id (`crypto.randomUUID()`). Esc clears.
- **Sort**: undone first (newest at top), then done (newest at top), dimmed.

Visual style stays JetBrains Mono for the text body to match the existing aesthetic.

### Edge cases

- Empty list: show muted `"No todos yet — type below to add."`
- Long text: single-line truncate with ellipsis; full text on hover via native `title` attribute.

---

## 4. Visualizer controls

### Tweaks added

```ts
vizSensitivity: number;  // 0.3..2.5, default 1.0
vizSmoothing: number;    // 0..0.95, default 0.0
vizColorOverride: { enabled: boolean; accent: string; accent2: string };
```

Default `vizColorOverride.enabled = false`; default colors initialized from current accent on first toggle.

### Application

`VizHero` and the underlying renderers (`HiFiVizBars`, waveform, radial, particles, ambient) accept three new optional props:

- `sensitivity: number` — multiply `bands[i]` and `level` before clamping. Applied at the start of the per-frame loop in each renderer.
- `smoothing: number` — exponential smoothing on band values: `bands_smoothed[i] = prev[i] * smoothing + bands[i] * (1 - smoothing)`. Each renderer gets a per-instance `smoothedBands` ref.
- `accent`, `accent2` — already props; just pass overridden values when `vizColorOverride.enabled`.

Color override only affects what's inside `VizHero`. Outer accents (Spotify tile, Discord tile, top-chrome glow) keep using the global accent so the rest of the dashboard's theme stays coherent.

### Tweaks panel UI

New "Visualizer" subsection (above the existing Visualizer section, or merged with it — pick whichever flows better in code):

- "Sensitivity" slider, value label on the right (`"1.0×"`).
- "Smoothing" slider, value label (`"0.0"`).
- "Color override" toggle. When on, reveal two color-picker swatches (HTML `<input type="color">` is fine, no need for a custom picker) labeled "Accent" and "Accent 2".

---

## Implementation order

1. **Durable tweaks store** (foundation — every other feature depends on it).
2. **Visualizer controls** (smallest, fastest validation that the tweaks store works).
3. **Todos** (touches one tile, no Rust).
4. **Weather location** (frontend + small Rust change).
5. **Drag/resize** (largest — `App.tsx` restructure + `TileFrame` + edit-mode rewrite).

Each step is independently shippable; if anything goes sideways, prior steps still work.

## Testing approach

- Manual smoke for each feature in `tauri:dev` after wiring (UI feedback is the goal here, not unit tests).
- Tweaks store: kill the app mid-edit, relaunch, verify persistence.
- Layout: drag every tile to a corner, reset, verify return to defaults.
- Weather: search for "Tokyo", verify location label and forecast both update within 5s.
- Viz: drag sensitivity to 0.3 → bars shrink; drag to 2.5 → bars saturate; toggle color override → swatch picker tints viz only.

## Risks

- **WebView2 storage location for `app_data_dir`**: confirm Tauri 2 default is writeable on Windows without elevation. (It is — `%APPDATA%/<bundle-id>`.)
- **TileFrame edit-mode pointer events vs tile-internal interactivity**: tile contents like Discord buttons must NOT swallow drag-starts when in edit mode. Solution: in edit mode, `TileFrame` adds a transparent overlay capturing pointer events; outside edit mode, the overlay isn't rendered.
- **Open-Meteo geocoding rate limits**: free, no auth, but politeness matters — debounce + cache last query in component state.

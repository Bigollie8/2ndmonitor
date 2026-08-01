# Scripted Visualizers (API v1)

Write your own audio visualizer in JavaScript and run it as a tile style. Pick the **Scripted** style on the viz tile (cycle with **V** or use the gallery), then either hit **+ New visualizer** or drop a folder in:

```
%APPDATA%\com.secondmonitor.hub\visualizers\<id>\
├── manifest.json
└── main.js
```

Saves hot-reload within ~2 seconds — edit in the built-in editor (✎ on the tile) or any external editor.

## manifest.json

```json
{
  "id": "my-viz",          // must equal the folder name, [a-z0-9-]{1,64}
  "name": "My Viz",
  "author": "you",          // optional
  "version": "0.1.0",
  "api": 1,                 // frame-payload contract version
  "permissions": []         // must be [] for locally-authored visualizers — see
                            // "Permissions" below for what marketplace bundles may declare
}
```

## main.js

Your code runs inside a sandboxed iframe: **no network, no filesystem, no app APIs** — audio data in, pixels out. The global `viz` is your whole world:

```js
viz.on('frame', ({ ctx, spectrum, waveform, bands, onset, level, dt, size, theme, track, playback }) => {
  // draw!
});

viz.settings.get('speed');        // persisted per-visualizer
viz.settings.set('speed', 2);
viz.canvas;                        // the <canvas>; grab webgl/webgl2 yourself if you
                                   // don't want the default 2D ctx
viz.bins(n);                       // resample the host's 64 spectrum bins to n bins,
                                   // by nearest-neighbour. Use this instead of hand-
                                   // rolling your own resample if you want a different
                                   // bin count than 64 — it's the same formula every
                                   // built-in style uses, so your output matches theirs
                                   // instead of silently drifting.
```

### Frame payload

| field | type | meaning |
|---|---|---|
| `ctx` | `CanvasRenderingContext2D \| null` | 2D context (null if you took a WebGL context first) |
| `spectrum` | `Float32Array(64)` | log-spaced 30 Hz–16 kHz magnitudes, 0..1 |
| `waveform` | `Uint8Array(1024)` | raw time-domain samples, 128 = silence |
| `bands` | `{ bass, mid, treble }` | musical-thirds means, 0..1 |
| `onset` | `{ kick, snare, hat }` | transient envelopes that decay ~150 ms, 0..1 |
| `level` | `number` | overall loudness, 0..1 |
| `dt` | `number` | seconds since previous frame (capped at 0.25) |
| `size` | `{ width, height }` | canvas size in pixels (canvas is auto-resized) |
| `theme` | `{ accent, accent2 }` | current accent colors, hex strings |
| `track` | `{ title, artist } \| null` | now-playing metadata |
| `playback` | `{ playing, position, duration } \| null` | live playback state, position/duration in seconds |

`track` and `playback` are both `null` when nothing is playing.

API v1 is frozen — future fields will be added, never changed or removed.

### Errors

Runtime errors surface as an overlay on the tile (and in the editor) with a line number, throttled to one per second. The visualizer keeps running — a bad frame doesn't kill the script.

## Sandbox guarantees

- iframe `sandbox="allow-scripts"` (opaque origin — no storage, no cookies, no app bridge)
- CSP `default-src 'none'` — `fetch`, XHR, images, external scripts and styles are all blocked
- the only channel in or out is the frame/settings message protocol above

## First-party surfaces on the sandbox runtime

The builtin MilkDrop visualizer renders through the same sandbox iframe as
marketplace bundles, via `SandboxVizSurface`'s `localSource` prop: its code
(butterchurn + preset pack UMDs + glue, see `src/components/milkdrop-code.ts`)
ships inside the app and is passed to the standard `init` path — no
`visualizers_read`, no manifest, and no broker permissions. It talks to its
host chrome over the generic `data` message (`viz.on('data')` / `viz.post`).

Why: butterchurn compiles preset equations with `new Function`. The main
window's CSP pins `script-src 'self'` (a test enforces it), so the only place
that eval may run is the sandbox — which also means a preset `.json`
downloaded from the internet executes in an opaque-origin frame with
`default-src 'none'`, not in the privileged app document.

## Permissions (marketplace bundles only)

Locally-authored visualizers must declare `"permissions": []` — they get audio data in and pixels out, nothing more. Bundles **installed from the marketplace** may declare permissions, which the app enforces through a broker:

- `net:<host>` → `await viz.net.fetch("https://<host>/...")` performs a brokered fetch to exactly that host (https only, size-capped). Any other host is denied.
- `tauri:<command>` → `await viz.tauri.invoke("<command>", args)` runs an app command — but only if the app's build also exposes it on an explicit allowlist (empty by default). Declaring a command in the manifest is necessary but not sufficient.

The broker consults the installed manifest on every call and fails closed. You approve the exact permission list in a dialog before install. See [`server/README.md`](../server/README.md) for the trust model.

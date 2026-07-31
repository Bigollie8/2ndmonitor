import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateManifest } from './manifest';
import { resampleBins, clampBinCount } from './bins';
import { RETIRED_BUILTIN_VIZ_MODES } from '../state/contentRegistry';
import { BUILTIN_VIZ_STYLES } from '../components/viz-styles';
import { validateViewSpec } from '../tiles/viewSpec';

// ─────────────────────────────────────────────────────────────────────────
// What this harness proves, and what it does not.
//
// It proves: a bundle's main.js loads via `new Function('viz', code)`
// without throwing, registers a frame callback, survives repeated frames —
// including a degenerate 0x0 surface and a frame with `track`/`playback`
// both null (the real shape whenever nothing is loaded or playing; see
// sandbox-html.ts's frame branch and frame.ts's `input.playback ?? null`) —
// and, per the manifest's `surface` field, either calls into the 2D context
// (`calls.length > 0`, canvas) or builds at least one element under
// `viz.root` (dom).
//
// It does NOT prove anything is visible or correct. `fakeCtx()` is a Proxy:
// it records `fillRect(NaN, NaN, ...)` or a fully-transparent `fillStyle`
// exactly as happily as it records the intended pixels. `fakeElement()` is
// just as uncritical — `el.style.transform = 'scaleY(NaN)'` records exactly
// as cleanly as a real value. There is no pixel diff here, and there isn't
// meant to be one. Visual fidelity is established only by the human
// side-by-side comparison against the built-in style (Tasks 7-8, Step 3) —
// a green run of this suite is not evidence of that.
//
// A folder is one of two bundle kinds, told apart by which file it carries:
//   - `main.js`   → a scripted visualizer bundle (asserted as above).
//   - `view.json` → a declarative tile bundle. For these the harness proves
//     the manifest and view spec both validate, and — since a wrong
//     `{{path}}` root renders silently empty rather than erroring (see
//     task-10-brief.md) — that every placeholder in `view` names a root the
//     render scope actually provides (`item`/`data`/`config`/`location`/
//     `units`), and never `secret` (which validateViewSpec already rejects
//     inside `view`, but a typo'd root like `{{itme.x}}` would sail through
//     that check and just render blank forever).
// ─────────────────────────────────────────────────────────────────────────

// `import.meta.dirname` needs Node 20.11+; fileURLToPath works everywhere and
// handles Windows drive letters correctly.
const HERE = fileURLToPath(new URL('.', import.meta.url));
const BUNDLES = join(HERE, '..', '..', '..', 'bundles');

/** Records every 2D-context call AND property assignment (`ctx.fillStyle =
 *  …`, `ctx.lineWidth = …`, etc.) so a bundle can be exercised headlessly. */
function fakeCtx() {
  const calls: string[] = [];
  const grad = { addColorStop() {} };
  const target: Record<string, unknown> = {
    createRadialGradient: () => (calls.push('createRadialGradient'), grad),
    createLinearGradient: () => (calls.push('createLinearGradient'), grad),
    measureText: () => ({ width: 10 }),
    getImageData: () => ({ data: new Uint8ClampedArray(4) }),
  };
  return {
    calls,
    ctx: new Proxy(target, {
      get(t, prop: string) {
        if (prop in t) return t[prop];
        return (...args: unknown[]) => { calls.push(`${prop}(${args.length})`); };
      },
      set(t, prop: string, value) {
        calls.push(`set:${prop}`);
        t[prop] = value;
        return true;
      },
    }),
  };
}

/** A bare-bones DOM element for `dom`-surface bundles: a real `style` object
 *  (plain-object property assignment behaves exactly like a live
 *  CSSStyleDeclaration for this harness's purposes — it never reads styles
 *  back, only writes them), `appendChild`/`removeChild` that actually track
 *  children (so a test can assert a bundle populated `viz.root`), and enough
 *  of the rest of the Element surface (`id`, `className`, `textContent`,
 *  `setAttribute`) that a bundle written against real DOM APIs doesn't throw
 *  on first contact with this fake. */
function fakeElement(tag: string) {
  const children: unknown[] = [];
  const el = {
    tagName: tag,
    style: {} as Record<string, unknown>,
    children,
    id: '',
    className: '',
    textContent: '',
    appendChild(child: unknown) { children.push(child); return child; },
    removeChild(child: unknown) {
      const i = children.indexOf(child);
      if (i >= 0) children.splice(i, 1);
      return child;
    },
    setAttribute() {},
    getAttribute() { return null; },
  };
  return el;
}

function frame(opts: {
  size?: { width: number; height: number };
  track?: { title: string; artist: string } | null;
  playback?: { playing: boolean; position: number; duration: number } | null;
} = {}) {
  return {
    spectrum: Float32Array.from({ length: 64 }, (_, i) => 0.2 + (i % 8) / 16),
    waveform: Uint8Array.from({ length: 1024 }, (_, i) => 128 + Math.round(40 * Math.sin(i / 12))),
    bands: { bass: 0.6, mid: 0.4, treble: 0.25 },
    onset: { kick: 0.9, snare: 0.2, hat: 0.1 },
    level: 0.5,
    dt: 0.016,
    size: opts.size ?? { width: 800, height: 600 },
    theme: { accent: '#7c8cdc', accent2: '#dc7c8c' },
    track: opts.track !== undefined ? opts.track : { title: 'Test', artist: 'Tester' },
    playback: opts.playback !== undefined ? opts.playback : { playing: true, position: 42, duration: 213 },
  };
}

/** Runs a bundle's main.js against a minimal `viz` global and returns its
 *  registered frame callbacks plus the fake DOM root it was given. Mirrors
 *  what sandbox-html.ts's shim actually does (see FIX 6 in the
 *  final-fix-report): same input clamp, a cached output buffer per bin count
 *  so repeated `viz.bins(n)` calls alias exactly as they do in the real shim
 *  (a bundle that treated them as independent snapshots would otherwise pass
 *  here and alias in the app), the whole object frozen, a
 *  `canvas.getContext` that returns the fake 2D ctx, and a `root` element for
 *  `dom`-surface bundles.
 *
 *  A `dom`-surface bundle may reach for the real `document` global too (see
 *  neonbars's main.js, which calls `document.createElement` to build its
 *  bars) — sandbox-html.ts runs bundle code inside the sandbox iframe's own
 *  document, so `document` is genuinely reachable there, not something this
 *  harness needs to fake away. This plain Node process has no such global,
 *  so one is installed on `globalThis` for the duration of this call only
 *  and removed again in `finally` — never left dangling for a later test in
 *  this same process to trip over.
 *
 *  `createElementNS` is included alongside `createElement` for the same
 *  reason: circular/tunnel/ribbon (Task 3) build inline SVG the way their
 *  source components (viz-extra.tsx) do, and a real SVG element requires the
 *  namespaced constructor — `document.createElement('svg')` produces an
 *  HTMLUnknownElement that never renders as SVG in an actual browser, so
 *  faking that call away instead of supporting it would validate a shape of
 *  code the real sandbox iframe (a genuine document) doesn't actually need
 *  bundles to write. `fakeElement` is already tag-agnostic (only records
 *  `tagName`), so the SVG namespace argument is simply discarded, matching
 *  how little this harness asserts about tag correctness for `createElement`
 *  either. */
function loadBundle(id: string) {
  const code = readFileSync(join(BUNDLES, id, 'main.js'), 'utf8');
  const cbs: ((f: unknown) => void)[] = [];
  const { ctx: canvasCtx } = fakeCtx();
  const root = fakeElement('div');
  const binCache: Record<number, Float32Array> = {};
  // Fixed source for viz.bins() — mirrors the real shim's `lastSpectrum`,
  // which a bundle can read from its module body (before the first frame)
  // when it's still null; resampleBins' null-source guard covers that case,
  // not this harness (this harness always has a spectrum available).
  const spectrum = frame().spectrum;
  const viz = Object.freeze({
    canvas: { width: 800, height: 600, getContext: () => canvasCtx },
    root,
    on: (name: string, cb: (f: unknown) => void) => { if (name === 'frame') cbs.push(cb); },
    bins: (n: number) => {
      const count = clampBinCount(n);
      if (!binCache[count]) binCache[count] = new Float32Array(count);
      return resampleBins(spectrum, count, binCache[count]);
    },
    settings: Object.freeze({ get: () => undefined, set: () => {} }),
    net: Object.freeze({ fetch: async () => ({}) }),
    tauri: Object.freeze({ invoke: async () => ({}) }),
  });
  const g = globalThis as Record<string, unknown>;
  const hadDocument = Object.prototype.hasOwnProperty.call(g, 'document');
  const prevDocument = g.document;
  g.document = {
    createElement: (tag: string) => fakeElement(tag),
    createElementNS: (_ns: string, tag: string) => fakeElement(tag),
  };
  try {
    new Function('viz', code)(viz);
  } finally {
    if (hadDocument) g.document = prevDocument; else delete g.document;
  }
  return { cbs, root };
}

const ids = existsSync(BUNDLES)
  ? readdirSync(BUNDLES, { withFileTypes: true })
      .filter((d) => d.isDirectory() && d.name !== 'dist')
      .map((d) => d.name)
  : [];

test('bundles: at least one bundle exists', () => {
  assert.ok(ids.length > 0, 'no bundles found — expected bundles/<id>/');
});

// RETIRED_BUILTIN_VIZ_MODES is the sole bridge for every upgrading user's
// saved vizMode — it must be pinned to the actual bundle folders, not just its
// length, or a bundle rename (or a name colliding with a still-live built-in)
// silently strands users on Bars.
test('RETIRED_BUILTIN_VIZ_MODES: every retired id has a matching bundles/<id>/ folder', () => {
  const idSet = new Set(ids);
  for (const retiredId of RETIRED_BUILTIN_VIZ_MODES) {
    assert.ok(idSet.has(retiredId), `bundles/${retiredId}/ does not exist — remap would strand saved selections`);
  }
});

test('RETIRED_BUILTIN_VIZ_MODES: none collide with a live built-in style', () => {
  const builtinIds = new Set(BUILTIN_VIZ_STYLES.map((s) => s.id));
  for (const retiredId of RETIRED_BUILTIN_VIZ_MODES) {
    assert.ok(!builtinIds.has(retiredId), `${retiredId} is both retired and a live built-in — the remap would hijack it`);
  }
});

/** A placeholder's root is the first dot-path segment: `{{data.q}}` → `data`.
 *  Mirrors template.ts's PLACEHOLDER regex (same identifier grammar) but only
 *  needs to capture the leading segment, not resolve the whole path. */
const PLACEHOLDER_ROOT = /\{\{\s*([A-Za-z_][A-Za-z0-9_]*)/g;
const ALLOWED_ROOTS = new Set(['item', 'data', 'config', 'location', 'units']);

/** Deep-walks a validated `view` object collecting every placeholder root
 *  found in any string field. */
function collectPlaceholderRoots(v: unknown, out: Set<string>): void {
  if (typeof v === 'string') {
    for (const m of v.matchAll(PLACEHOLDER_ROOT)) out.add(m[1]!);
  } else if (Array.isArray(v)) {
    for (const item of v) collectPlaceholderRoots(item, out);
  } else if (v !== null && typeof v === 'object') {
    for (const value of Object.values(v)) collectPlaceholderRoots(value, out);
  }
}

for (const id of ids) {
  const isTile = existsSync(join(BUNDLES, id, 'view.json'));

  if (isTile) {
    test(`tile ${id}: manifest is valid and matches its folder name`, () => {
      const raw = JSON.parse(readFileSync(join(BUNDLES, id, 'manifest.json'), 'utf8'));
      const v = validateManifest(raw, { allowPermissions: true });
      assert.equal(v.ok, true, v.ok ? '' : v.error);
      assert.equal(v.ok && v.manifest.id, id);
    });

    test(`tile ${id}: view.json is a valid view spec`, () => {
      const raw = JSON.parse(readFileSync(join(BUNDLES, id, 'view.json'), 'utf8'));
      const v = validateViewSpec(raw);
      assert.equal(v.ok, true, v.ok ? '' : v.error);
    });

    test(`tile ${id}: every {{path}} placeholder in view names an allowed root, never secret`, () => {
      const raw = JSON.parse(readFileSync(join(BUNDLES, id, 'view.json'), 'utf8'));
      const v = validateViewSpec(raw);
      assert.equal(v.ok, true, v.ok ? '' : v.error);
      if (!v.ok) return;
      const roots = new Set<string>();
      collectPlaceholderRoots(v.spec.view, roots);
      assert.ok(roots.size > 0, 'view has no {{path}} placeholders at all — nothing to render');
      for (const root of roots) {
        assert.ok(
          ALLOWED_ROOTS.has(root),
          `placeholder root "${root}" in ${id}'s view is not one of item/data/config/location/units`
            + (root === 'secret' ? ' (secret must never appear in view)' : ''),
        );
      }
    });
    continue;
  }

  // Read once per bundle so the three tests below don't each re-parse and
  // re-validate the manifest just to know which draw assertion applies.
  // validateManifest already normalizes an absent field to 'canvas' — mirror
  // that here rather than trusting the raw JSON directly.
  const manifestRaw = JSON.parse(readFileSync(join(BUNDLES, id, 'manifest.json'), 'utf8'));
  const surface: 'canvas' | 'dom' = manifestRaw.surface === 'dom' ? 'dom' : 'canvas';

  test(`bundle ${id}: manifest is valid and matches its folder name`, () => {
    const v = validateManifest(manifestRaw, { allowPermissions: true });
    assert.equal(v.ok, true, v.ok ? '' : v.error);
    assert.equal(v.ok && v.manifest.id, id);
  });

  test(`bundle ${id}: declares no permissions (migrated styles need none)`, () => {
    assert.deepEqual(manifestRaw.permissions, []);
  });

  test(`bundle ${id}: registers a frame callback and draws without throwing`, () => {
    const { cbs, root } = loadBundle(id);
    assert.equal(cbs.length >= 1, true, 'bundle registered no frame callback');
    if (surface === 'dom') {
      // dom bundles build their elements once (at init, before the first
      // frame) rather than per frame — see neonbars's main.js — so the
      // build already happened inside loadBundle(); this only proves it
      // actually populated the root it was given.
      assert.ok(root.children.length > 0, 'dom bundle built no elements under viz.root');
      for (let i = 0; i < 3; i++) {
        for (const cb of cbs) cb(frame());
      }
    } else {
      const { ctx, calls } = fakeCtx();
      for (let i = 0; i < 3; i++) {
        for (const cb of cbs) cb({ ...frame(), ctx });
      }
      assert.ok(
        calls.some((c) => !c.startsWith('set:')),
        'bundle only assigned context properties and never called a draw method',
      );
    }
  });

  test(`bundle ${id}: survives a degenerate 0x0 surface`, () => {
    const { cbs } = loadBundle(id);
    const { ctx } = fakeCtx();
    for (const cb of cbs) cb({ ...frame({ size: { width: 0, height: 0 } }), ctx });
  });

  test(`bundle ${id}: survives track:null and playback:null (nothing loaded/playing)`, () => {
    const { cbs } = loadBundle(id);
    const { ctx } = fakeCtx();
    for (let i = 0; i < 3; i++) {
      for (const cb of cbs) cb({ ...frame({ track: null, playback: null }), ctx });
    }
  });
}

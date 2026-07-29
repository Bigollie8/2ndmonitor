import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateManifest } from './manifest';
import { resampleBins } from './bins';

// ─────────────────────────────────────────────────────────────────────────
// What this harness proves, and what it does not.
//
// It proves: a bundle's main.js loads via `new Function('viz', code)`
// without throwing, registers a frame callback, survives repeated frames —
// including a degenerate 0x0 surface and a frame with `track`/`playback`
// both null (the real shape whenever nothing is loaded or playing; see
// sandbox-html.ts's frame branch and frame.ts's `input.playback ?? null`) —
// and actually calls into the 2D context (`calls.length > 0`).
//
// It does NOT prove anything is visible or correct. `fakeCtx()` is a Proxy:
// it records `fillRect(NaN, NaN, ...)` or a fully-transparent `fillStyle`
// exactly as happily as it records the intended pixels. There is no pixel
// diff here, and there isn't meant to be one. Visual fidelity is established
// only by the human side-by-side comparison against the built-in style
// (Tasks 7-8, Step 3) — a green run of this suite is not evidence of that.
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
 *  registered frame callbacks. Mirrors what sandbox-html.ts's shim does. */
function loadBundle(id: string) {
  const code = readFileSync(join(BUNDLES, id, 'main.js'), 'utf8');
  const cbs: ((f: unknown) => void)[] = [];
  const viz = {
    canvas: { width: 800, height: 600 },
    on: (name: string, cb: (f: unknown) => void) => { if (name === 'frame') cbs.push(cb); },
    bins: (n: number) => resampleBins(frame().spectrum, n),
    settings: { get: () => undefined, set: () => {} },
    net: { fetch: async () => ({}) },
    tauri: { invoke: async () => ({}) },
  };
  new Function('viz', code)(viz);
  return cbs;
}

const ids = existsSync(BUNDLES)
  ? readdirSync(BUNDLES, { withFileTypes: true })
      .filter((d) => d.isDirectory() && d.name !== 'dist')
      .map((d) => d.name)
  : [];

test('bundles: at least one bundle exists', () => {
  assert.ok(ids.length > 0, 'no bundles found — expected bundles/<id>/');
});

for (const id of ids) {
  test(`bundle ${id}: manifest is valid and matches its folder name`, () => {
    const raw = JSON.parse(readFileSync(join(BUNDLES, id, 'manifest.json'), 'utf8'));
    const v = validateManifest(raw, { allowPermissions: true });
    assert.equal(v.ok, true, v.ok ? '' : v.error);
    assert.equal(v.ok && v.manifest.id, id);
  });

  test(`bundle ${id}: declares no permissions (migrated styles need none)`, () => {
    const raw = JSON.parse(readFileSync(join(BUNDLES, id, 'manifest.json'), 'utf8'));
    assert.deepEqual(raw.permissions, []);
  });

  test(`bundle ${id}: registers a frame callback and draws without throwing`, () => {
    const cbs = loadBundle(id);
    assert.equal(cbs.length >= 1, true, 'bundle registered no frame callback');
    const { ctx, calls } = fakeCtx();
    for (let i = 0; i < 3; i++) {
      for (const cb of cbs) cb({ ...frame(), ctx });
    }
    assert.ok(
      calls.some((c) => !c.startsWith('set:')),
      'bundle only assigned context properties and never called a draw method',
    );
  });

  test(`bundle ${id}: survives a degenerate 0x0 surface`, () => {
    const cbs = loadBundle(id);
    const { ctx } = fakeCtx();
    for (const cb of cbs) cb({ ...frame({ size: { width: 0, height: 0 } }), ctx });
  });

  test(`bundle ${id}: survives track:null and playback:null (nothing loaded/playing)`, () => {
    const cbs = loadBundle(id);
    const { ctx } = fakeCtx();
    for (let i = 0; i < 3; i++) {
      for (const cb of cbs) cb({ ...frame({ track: null, playback: null }), ctx });
    }
  });
}

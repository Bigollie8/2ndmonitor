import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateManifest } from './manifest';
import { resampleBins } from './bins';

// `import.meta.dirname` needs Node 20.11+; fileURLToPath works everywhere and
// handles Windows drive letters correctly.
const HERE = fileURLToPath(new URL('.', import.meta.url));
const BUNDLES = join(HERE, '..', '..', '..', 'bundles');

/** Records every 2D-context call so a bundle can be exercised headlessly. */
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
      set() { return true; },
    }),
  };
}

function frame(size = { width: 800, height: 600 }) {
  return {
    spectrum: Float32Array.from({ length: 64 }, (_, i) => 0.2 + (i % 8) / 16),
    waveform: Uint8Array.from({ length: 1024 }, (_, i) => 128 + Math.round(40 * Math.sin(i / 12))),
    bands: { bass: 0.6, mid: 0.4, treble: 0.25 },
    onset: { kick: 0.9, snare: 0.2, hat: 0.1 },
    level: 0.5,
    dt: 0.016,
    size,
    theme: { accent: '#7c8cdc', accent2: '#dc7c8c' },
    track: { title: 'Test', artist: 'Tester' },
    playback: { playing: true, position: 42 },
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
    assert.ok(calls.length > 0, 'bundle drew nothing');
  });

  test(`bundle ${id}: survives a degenerate 0x0 surface`, () => {
    const cbs = loadBundle(id);
    const { ctx } = fakeCtx();
    for (const cb of cbs) cb({ ...frame({ width: 0, height: 0 }), ctx });
  });
}

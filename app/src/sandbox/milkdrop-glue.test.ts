import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { MILKDROP_GLUE } from './milkdrop-glue';

const __dirname = dirname(fileURLToPath(import.meta.url));
const readApp = (...p: string[]) => readFileSync(join(__dirname, '..', ...p), 'utf8');

test('glue: UMD default-interop for both libraries', () => {
  assert.ok(MILKDROP_GLUE.includes('(window.butterchurn && window.butterchurn.default) || window.butterchurn'));
  assert.ok(MILKDROP_GLUE.includes('(window.butterchurnPresets && window.butterchurnPresets.default) || window.butterchurnPresets'));
});

test('glue: audio levels follow the Web Audio byte convention (128 = silence)', () => {
  assert.ok(MILKDROP_GLUE.includes('fill(128)'), 'silence baseline');
  assert.ok(MILKDROP_GLUE.includes('timeByteArrayL'), 'butterchurn wants three buffers');
  assert.ok(/f\.waveform\.length > 1024 \? f\.waveform\.subarray\(0, 1024\) : f\.waveform/.test(MILKDROP_GLUE),
    'oversized capture buffers are truncated, not overflowed');
});

test('glue: resize goes through setRendererSize, render every frame', () => {
  assert.ok(MILKDROP_GLUE.includes('setRendererSize'));
  assert.ok(MILKDROP_GLUE.includes('visualizer.render({ audioLevels: levels })'));
});

test('glue: every load answers with a seq-matched result, success or failure', () => {
  assert.ok(MILKDROP_GLUE.includes("viz.post({ kind: 'milkdrop:load:result', seq: msg.seq, ok: true })"));
  assert.ok(MILKDROP_GLUE.includes("ok: false, error:"));
  assert.ok(MILKDROP_GLUE.includes("kind !== 'milkdrop:load'"), 'unknown data payloads are ignored');
});

test('glue: announces its preset names on every init', () => {
  assert.ok(MILKDROP_GLUE.includes("viz.post({ kind: 'milkdrop:names', names: Object.keys(presets) })"));
});

test('glue: reuses a window-level visualizer singleton across re-inits, no fresh WebGL context per init', () => {
  // The sandbox canvas is not remounted on a re-init (hot reload, or a second
  // 'ready' racing the first) — a fresh BC.createVisualizer on that same
  // canvas every time would leak the previous run's WebGL context.
  assert.ok(MILKDROP_GLUE.includes('window.__mdViz'), 'visualizer is cached on window, surviving IIFE re-execution');
  assert.ok(/if\s*\(!visualizer\)\s*{\s*visualizer = BC\.createVisualizer/.test(MILKDROP_GLUE),
    'createVisualizer only runs when no cached instance exists yet');
  assert.ok(MILKDROP_GLUE.includes('visualizer.setRendererSize(lastW, lastH)'),
    'a reused visualizer still picks up the current init size');
});

test('milkdrop-code assembles butterchurn + starter pack + glue via ?raw (source scan — module not importable under node)', () => {
  const src = readApp('components', 'milkdrop-code.ts');
  assert.ok(src.includes("butterchurn/lib/butterchurn.min.js?raw"));
  assert.ok(src.includes("./milkdrop-starter-pack.json?raw"), 'full pack replaced by the slimmed starter pack');
  assert.ok(src.includes('window.butterchurnPresets={getPresets:function(){return ('),
    'starter pack JSON is wrapped to match the getPresets() surface the glue reads');
  assert.ok(src.includes('MILKDROP_GLUE'));
  assert.ok(src.includes("join('\\n;\\n')"), 'minified UMDs may lack trailing semicolons/newlines');
});

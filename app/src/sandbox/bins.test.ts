import test from 'node:test';
import assert from 'node:assert/strict';
import { resampleBins, BINS_SHIM_SRC } from './bins';

test('resampleBins: upsample selects the same source bin as makeSpectrumReader', () => {
  // makeSpectrumReader reads liveBands[Math.floor((i / N) * srcLen)].
  const src = Float32Array.from({ length: 64 }, (_, i) => i / 64);
  const out = resampleBins(src, 220);
  assert.equal(out.length, 220);
  for (let i = 0; i < 220; i++) {
    assert.equal(out[i], src[Math.floor((i / 220) * 64)]);
  }
});

test('resampleBins: downsample selects every other bin for n=32', () => {
  const src = Float32Array.from({ length: 64 }, (_, i) => i);
  const out = resampleBins(src, 32);
  assert.equal(out[0], 0);
  assert.equal(out[1], 2);
  assert.equal(out[31], 62);
});

test('resampleBins: reuses the provided out buffer', () => {
  const src = new Float32Array(64).fill(0.5);
  const out = new Float32Array(8);
  assert.equal(resampleBins(src, 8, out), out);
  assert.equal(out[7], 0.5);
});

test('resampleBins: empty source yields zeros, never NaN', () => {
  const out = resampleBins(new Float32Array(0), 4);
  assert.deepEqual([...out], [0, 0, 0, 0]);
});

test('BINS_SHIM_SRC evaluates to a function matching resampleBins', () => {
  const shim = new Function(`${BINS_SHIM_SRC}; return __resample;`)() as
    (src: Float32Array, n: number) => Float32Array;
  const src = Float32Array.from({ length: 64 }, (_, i) => Math.sin(i));
  assert.deepEqual([...shim(src, 140)], [...resampleBins(src, 140)]);
});

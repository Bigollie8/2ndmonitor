import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFrameMessage, clampDt, toVizPlayback } from './frame';

const base = {
  spectrum: new Float32Array(64).fill(0.5),
  waveform: new Uint8Array(1024).fill(128),
  bands: { bass: 0.3, mid: 0.2, treble: 0.1 },
  onset: { kick: 1, snare: 0, hat: 0 },
  level: 0.42,
  dtMs: 16,
  size: { width: 800, height: 600 },
  theme: { accent: '#7c8cdc', accent2: '#dc7c8c' },
  track: null,
  playback: null,
};

test('clampDt: converts ms to seconds', () => {
  assert.equal(clampDt(16), 0.016);
});

test('clampDt: caps a long stall at 0.25s so physics do not explode', () => {
  assert.equal(clampDt(5000), 0.25);
});

test('clampDt: negative or NaN input yields 0', () => {
  assert.equal(clampDt(-5), 0);
  assert.equal(clampDt(Number.NaN), 0);
});

test('buildFrameMessage: carries playback through untouched', () => {
  const msg = buildFrameMessage({ ...base, playback: { playing: true, position: 12.5, duration: 200 } });
  assert.deepEqual(msg.playback, { playing: true, position: 12.5, duration: 200 });
});

test('buildFrameMessage: playback defaults to null, never undefined', () => {
  assert.equal(buildFrameMessage(base).playback, null);
});

test('buildFrameMessage: is a frame message with the dt already in seconds', () => {
  const msg = buildFrameMessage({ ...base, dtMs: 32 });
  assert.equal(msg.type, 'frame');
  assert.equal(msg.dt, 0.032);
  assert.equal(msg.level, 0.42);
  assert.equal(msg.size.width, 800);
});

test('toVizPlayback: null playback stays null', () => {
  assert.equal(toVizPlayback(null, 1000), null);
});

test('toVizPlayback: paused reports the synced position verbatim', () => {
  const pb = { positionAtSync: 30, duration: 200, playing: false, syncedAt: 500 };
  assert.deepEqual(toVizPlayback(pb, 10_000), { playing: false, position: 30, duration: 200 });
});

test('toVizPlayback: playing projects position from elapsed wall time', () => {
  const pb = { positionAtSync: 30, duration: 200, playing: true, syncedAt: 1_000 };
  assert.deepEqual(toVizPlayback(pb, 3_500), { playing: true, position: 32.5, duration: 200 });
});

test('toVizPlayback: projection is clamped to duration', () => {
  const pb = { positionAtSync: 195, duration: 200, playing: true, syncedAt: 0 };
  assert.equal(toVizPlayback(pb, 60_000)?.position, 200);
});

test('toVizPlayback: unknown duration (0) does not clamp to zero', () => {
  const pb = { positionAtSync: 10, duration: 0, playing: true, syncedAt: 0 };
  assert.equal(toVizPlayback(pb, 5_000)?.position, 15);
});

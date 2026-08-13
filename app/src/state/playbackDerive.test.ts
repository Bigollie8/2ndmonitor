import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveNextPlayback, tickSignature } from './playbackDerive';
import type { Playback } from './tauri';

const pb = (over: Partial<Playback> = {}): Playback => ({
  positionAtSync: 100, duration: 300, playing: true, syncedAt: 1000, ...over,
});
const tick = (over: Partial<{ has_session: boolean; playing: boolean; position: number; duration: number }> = {}) => ({
  has_session: true, playing: true, position: 100, duration: 300, ...over,
});

// ── the YouTube flicker (transient zeros) ────────────────────────────────────

test('a transient duration=0 for the same track keeps the known duration', () => {
  const out = deriveNextPlayback(pb(), tick({ duration: 0, position: 104 }), false, 5000);
  assert.ok(out);
  assert.equal(out.duration, 300, 'known duration held, timeline stays visible');
});

test('duration=0 AND position=0 mid-track holds the whole anchor (no phantom seek)', () => {
  const prev = pb({ positionAtSync: 150 });
  const out = deriveNextPlayback(prev, tick({ duration: 0, position: 0 }), false, 5000);
  assert.ok(out);
  assert.equal(out.positionAtSync, 150, 'position not yanked to 0:00');
  assert.equal(out.duration, 300);
});

test('pause/resume with a zeroed poll does not blank the timeline', () => {
  // Play-state change forces a re-anchor; the unreliable zeros must still
  // not survive into it.
  const prev = pb({ playing: true, positionAtSync: 150 });
  const out = deriveNextPlayback(prev, tick({ playing: false, duration: 0, position: 0 }), false, 5000);
  assert.ok(out);
  assert.equal(out.playing, false);
  assert.equal(out.duration, 300, 're-anchor keeps known duration over a zero');
  assert.equal(out.positionAtSync, 150, 're-anchor keeps known position over a zero');
});

test('a genuine track change takes new values verbatim, zeros included', () => {
  const out = deriveNextPlayback(pb(), tick({ duration: 0, position: 0 }), true, 5000);
  assert.ok(out);
  assert.equal(out.duration, 0, 'track change resets — no stale carry-over');
  assert.equal(out.positionAtSync, 0);
});

// ── existing anchor semantics preserved ──────────────────────────────────────

test('no session clears playback', () => {
  assert.equal(deriveNextPlayback(pb(), tick({ has_session: false }), false, 5000), null);
});

test('steady playback holds the anchor by identity', () => {
  const prev = pb({ syncedAt: 1000, positionAtSync: 100 });
  // 2s later GSMTC reports 101.5 — within jitter of interpolated 102.
  const out = deriveNextPlayback(prev, tick({ position: 101.5 }), false, 3000);
  assert.equal(out, prev, 'anchor object unchanged — React bails');
});

test('forward drift beyond 1s re-anchors', () => {
  const prev = pb({ syncedAt: 1000, positionAtSync: 100 });
  const out = deriveNextPlayback(prev, tick({ position: 110 }), false, 3000);
  assert.ok(out && out !== prev);
  assert.equal(out.positionAtSync, 110);
});

test('small backward drift is ignored; >15s backward seek re-anchors', () => {
  const prev = pb({ syncedAt: 1000, positionAtSync: 100 });
  assert.equal(deriveNextPlayback(prev, tick({ position: 97 }), false, 3000), prev);
  const seek = deriveNextPlayback(prev, tick({ position: 20 }), false, 3000);
  assert.ok(seek && seek.positionAtSync === 20);
});

// ── the leak guard: unchanged ticks produce identical signatures ─────────────

test('tickSignature is stable across identical ticks and cheap about art', () => {
  const p = {
    has_session: true, title: 'A', artist: 'B', album: 'C',
    playing: false, position: 42, duration: 300,
    source_app_id: 'msedge', art_data_url: 'x'.repeat(250_000),
  };
  const sig1 = tickSignature(p);
  const sig2 = tickSignature({ ...p, art_data_url: 'x'.repeat(250_000) });
  assert.equal(sig1, sig2, 'identical paused ticks match — setState is skipped');
  assert.ok(sig1.length < 200, 'signature stays tiny regardless of art size');
  assert.notEqual(sig1, tickSignature({ ...p, position: 43 }), 'progress still gets through');
});

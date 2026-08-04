import test from 'node:test';
import assert from 'node:assert/strict';
import { drawHomeDot, HOME_DOT_RADIUS, HOME_DOT_FILL } from './homeDot';

function stubCtx() {
  const calls: string[] = [];
  const ctx = {
    fillStyle: '',
    beginPath() { calls.push('beginPath'); },
    arc(x: number, y: number, r: number) { calls.push(`arc:${x},${y},${r}`); },
    fill() { calls.push(`fill:${ctx.fillStyle}`); },
  };
  return { ctx, calls };
}

test('drawHomeDot projects the anchor and fills a dot at the shared radius', () => {
  const { ctx, calls } = stubCtx();
  const project = (lat: number, lon: number) => ({ x: lat * 2, y: lon * 3 });
  drawHomeDot(ctx as unknown as CanvasRenderingContext2D, project, 10, 5);
  assert.deepEqual(calls, ['beginPath', `arc:20,15,${HOME_DOT_RADIUS}`, `fill:${HOME_DOT_FILL}`]);
});

test('drawHomeDot uses the shared constants the map tiles agreed on', () => {
  assert.equal(HOME_DOT_RADIUS, 3);
  assert.equal(HOME_DOT_FILL, 'rgba(255,255,255,0.6)');
});

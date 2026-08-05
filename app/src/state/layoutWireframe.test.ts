import test from 'node:test';
import assert from 'node:assert/strict';
import { wireframeSvg, wireframeDataUri, tileLabel } from './layoutWireframe';
import type { PublishedLayout } from './layoutPublish';

const layout = (o: Partial<PublishedLayout> = {}): PublishedLayout => ({
  v: 1,
  landscape: [{ type: 'clock', rect: { x: 0, y: 0, w: 0.5, h: 0.5 } }],
  portrait: [],
  theme: { accent: '#7cf5d4', accent2: '#a5b4fc', density: 'comfortable', glass: true, vizMode: 'aurora' },
  ...o,
});

test('a wireframe is an svg sized to the standard preview stage', () => {
  const svg = wireframeSvg(layout());
  assert.ok(svg.startsWith('<svg'));
  assert.ok(svg.includes('width="576"'));
  assert.ok(svg.includes('height="194"'));
});

test('each tile becomes a block', () => {
  const svg = wireframeSvg(layout({
    landscape: [
      { type: 'clock', rect: { x: 0, y: 0, w: 0.5, h: 0.5 } },
      { type: 'weather', rect: { x: 0.5, y: 0, w: 0.5, h: 0.5 } },
    ],
  }));
  assert.equal((svg.match(/<rect /g) ?? []).length, 3, 'background plus two tiles');
});

test('the label drops the bundle: prefix and the tile- noise', () => {
  assert.equal(tileLabel('bundle:tile-quote'), 'quote');
  assert.equal(tileLabel('weatherRadar'), 'weatherRadar');
});

// A tile type is author-controlled text that ends up inside an SVG document.
test('a tile type containing markup cannot break out of the svg', () => {
  const svg = wireframeSvg(layout({
    landscape: [{ type: '</text><script>alert(1)</script>', rect: { x: 0, y: 0, w: 1, h: 1 } }],
  }));
  assert.ok(!svg.includes('<script>'), 'markup must be escaped, not embedded');
  assert.ok(svg.includes('&lt;'), 'and it should appear escaped');
});

test('a tiny tile gets no label rather than one spilling over its neighbours', () => {
  const svg = wireframeSvg(layout({
    landscape: [{ type: 'clock', rect: { x: 0, y: 0, w: 0.02, h: 0.02 } }],
  }));
  assert.equal(svg.includes('<text'), false);
});

test('an empty layout still renders a frame rather than throwing', () => {
  const svg = wireframeSvg(layout({ landscape: [] }));
  assert.ok(svg.includes('<svg'));
});

test('a malformed accent falls back instead of injecting into the document', () => {
  const svg = wireframeSvg(layout({
    theme: { accent: '"><script>x</script>', accent2: '#fff', density: 'd', glass: false, vizMode: 'v' },
  }));
  assert.ok(!svg.includes('<script>'));
  assert.ok(svg.includes('#7cf5d4'), 'falls back to the default accent');
});

test('portrait can be rendered too', () => {
  const svg = wireframeSvg(layout({
    portrait: [{ type: 'clock', rect: { x: 0, y: 0, w: 1, h: 0.3 } }],
  }), 'portrait');
  assert.equal((svg.match(/<rect /g) ?? []).length, 2);
});

test('the data uri is usable as an img src', () => {
  assert.ok(wireframeDataUri(layout()).startsWith('data:image/svg+xml'));
});

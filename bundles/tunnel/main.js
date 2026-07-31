// Waveform Tunnel — 6 layered waveform paths with per-layer blur, riding
// bass/mid/treble. Migrated from viz-extra.tsx's VizWaveformTunnel. Pure
// procedural + spectrum-reactive DOM (inline SVG paths).
//
// Bin count: the original's reader is `makeSpectrumReader(64, ...)`
// literally (viz-extra.tsx:142) — 64 exactly matches the host's own N=64
// makeSpectrumReader (viz-sandbox-surface.tsx). Unlike circular/ambient this
// style therefore carries NO bin-resolution gap at all: f.bands.bass/mid/
// treble here are the exact same averages the original's own reader would
// have produced, and viz.bins(64) resamples identically to what
// reader.out held there.
//
// Cross-frame state: `t += 0.04` every tick (viz-extra.tsx:147), a fixed
// per-tick increment — framerate-dependent as written. Ported with
// k = f.dt*60 (reference ticks this frame): `t += 0.04 * k`, reducing to
// the original's per-tick increment exactly at k=1 (dt=1/60s).
//
// Sensitivity: every term in the amplitude/position formulas derives from
// either f.bands.* or a bin value, both of which already have the user's
// sensitivity applied host-side, per-bin, before this bundle ever sees
// them — and the original never applies its own extra `* sensitivity`
// anywhere in its own body either (it relies entirely on its reader having
// done that once). So there's no separate baseline/level term left
// unscaled here, unlike waveform/particles in Tasks 1-2 — full fidelity on
// this axis.
//
// The paths' strokeWidth (viewBox units) and blur (px) are static per layer
// with no vector-effect="non-scaling-stroke" in the original to preserve —
// checked, it isn't present — so letting them scale with the SVG's own
// preserveAspectRatio="none" stretch (same as the original) is correct.
//
// Stroke color (theme-derived, alternates by layer parity) is cached and
// only rewritten on accent/accent2 change; `d` is rebuilt every frame since
// it's the animating property.
var SVG_NS = 'http://www.w3.org/2000/svg';
var LAYERS = 6;
var SPEC_N = 64;
var POINTS = 80; // i in 0..80 inclusive => 81 samples, matching the original's `for (i=0;i<=80;i++)`

function svgEl(tag) { return document.createElementNS(SVG_NS, tag); }

var container = document.createElement('div');
container.style.position = 'absolute';
container.style.inset = '0';
container.style.background = '#04050a';
viz.root.appendChild(container);

var svg = svgEl('svg');
svg.setAttribute('viewBox', '0 0 100 100');
svg.setAttribute('preserveAspectRatio', 'none');
svg.style.width = '100%';
svg.style.height = '100%';
container.appendChild(svg);

var paths = new Array(LAYERS);
for (var l = 0; l < LAYERS; l++) {
  var p = svgEl('path');
  p.setAttribute('fill', 'none');
  p.setAttribute('stroke-width', String(0.4 + (6 - l) * 0.15));
  p.setAttribute('stroke-opacity', String((1 - l / 6) * 0.9));
  p.style.filter = 'blur(' + (l * 0.6) + 'px)';
  p.setAttribute('d', 'M 0,50 L 100,50');
  svg.appendChild(p);
  paths[l] = p;
}

var lastAccent = null;
var lastAccent2 = null;
var t = 0;

viz.on('frame', function (f) {
  var accent = f.theme.accent;
  var accent2 = f.theme.accent2;
  if (accent !== lastAccent || accent2 !== lastAccent2) {
    for (var j = 0; j < LAYERS; j++) {
      paths[j].setAttribute('stroke', j % 2 === 0 ? accent : accent2);
    }
    lastAccent = accent;
    lastAccent2 = accent2;
  }

  var k = f.dt * 60;
  t += 0.04 * k;

  var bass = f.bands.bass;
  var mid = f.bands.mid;
  var treble = f.bands.treble;
  var bins = viz.bins(SPEC_N);

  for (var layer = 0; layer < LAYERS; layer++) {
    var phase = layer * 0.6;
    var energy = layer < 2 ? bass : layer < 4 ? mid : treble;
    var amp = (30 + layer * 6) * (0.6 + energy * 1.8);
    var pts = [];
    for (var i = 0; i <= POINTS; i++) {
      var x = (i / POINTS) * 100;
      var spec = bins[Math.floor((i / POINTS) * SPEC_N)] || 0;
      var y = 50 + Math.sin(t * 1.5 + i * 0.3 + phase) * amp * 0.4
                 + Math.sin(t * 0.7 + i * 0.1 + phase) * amp * 0.3
                 + (spec - 0.5) * amp * 0.5;
      pts.push(x + ',' + y);
    }
    paths[layer].setAttribute('d', 'M ' + pts.join(' L '));
  }
});

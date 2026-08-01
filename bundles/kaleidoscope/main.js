// Kaleidoscope — 12 rotating, spectrum-scaled diamonds blended with
// 'screen'. Migrated from viz-extra.tsx's VizKaleidoscope.
//
// Bin count: N=12 is both the polygon count and the literal N passed to
// makeSpectrumReader in the original (viz-extra.tsx:459/463) — no
// bin-count trap.
//
// Cross-frame state: `t += 0.01` every tick (viz-extra.tsx:468), a fixed
// per-tick increment — framerate-dependent as written. Ported with
// k = f.dt*60 (reference ticks this frame): `t += 0.01 * k`, reducing to
// the original's per-tick increment exactly at k=1 (dt=1/60s, the
// circular/tunnel pattern from Task 3).
//
// Sensitivity: fully carried by `viz.bins(12)` — the original never
// applies its own extra `* sensitivity` on top of what its reader
// produced.
//
// Each polygon's `filter: blur(${i % 3}px)` is a plain CSS pixel blur on
// the SVG child element, not an SVG stroke/vector-effect concern — ported
// verbatim, same units, same behavior as the original (checked for
// vectorEffect="non-scaling-stroke": not present, and these shapes are
// filled, not stroked, so there's no stroke-width scaling question here
// either).
//
// Fill color (`i % 2 === 0 ? accent : accent2`) is only ever set once per
// render in the original (a JSX prop, not touched inside the rAF tick) —
// so, following the circular/neonbars/ribbon pattern, it's cached here and
// only rewritten when `f.theme.accent`/`accent2` actually change; the
// per-frame `transform`/`opacity` (which truly animate every tick) are
// always rewritten.
var SVG_NS = 'http://www.w3.org/2000/svg';
var N = 12;

function svgEl(tag) { return document.createElementNS(SVG_NS, tag); }

var container = document.createElement('div');
container.style.position = 'absolute';
container.style.inset = '0';
container.style.background = 'radial-gradient(circle at center, #0a0a14 0%, #02030a 80%)';
viz.root.appendChild(container);

var svg = svgEl('svg');
svg.setAttribute('viewBox', '-100 -100 200 200');
svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
svg.style.width = '100%';
svg.style.height = '100%';
container.appendChild(svg);

var polys = new Array(N);
for (var i = 0; i < N; i++) {
  var poly = svgEl('polygon');
  poly.setAttribute('points', '0,-60 20,0 0,60 -20,0');
  poly.setAttribute('opacity', '0.5');
  poly.style.mixBlendMode = 'screen';
  poly.style.filter = 'blur(' + (i % 3) + 'px)';
  svg.appendChild(poly);
  polys[i] = poly;
}

var lastAccent = null;
var lastAccent2 = null;
var t = 0;

viz.on('frame', function (f) {
  var accent = f.theme.accent;
  var accent2 = f.theme.accent2;
  if (accent !== lastAccent || accent2 !== lastAccent2) {
    for (var j = 0; j < N; j++) {
      polys[j].setAttribute('fill', j % 2 === 0 ? accent : accent2);
    }
    lastAccent = accent;
    lastAccent2 = accent2;
  }

  var k = f.dt * 60;
  t += 0.01 * k;

  var bins = viz.bins(N);
  for (var m = 0; m < N; m++) {
    var v = bins[m] || 0;
    polys[m].setAttribute('transform', 'rotate(' + (m * 30 + t * 30) + ') scale(' + (0.5 + v * 0.8) + ')');
    polys[m].setAttribute('opacity', String(0.3 + v * 0.6));
  }
});

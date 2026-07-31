// Circular Pulse — 96 radial spokes + a bass-reactive disc, drawn as inline
// SVG. Migrated from viz-extra.tsx's VizCircularPulse.
//
// Real namespaced SVG elements need document.createElementNS — plain
// document.createElement('svg'/'line'/'circle') produces HTMLUnknownElement
// nodes that never render as SVG in a real browser, only inert tags. The
// sandbox iframe's `document` supports this natively (it's a real document,
// same as the one neonbars' `document.createElement` already relies on).
//
// Bin count: N=96 is both the spoke count and the literal N passed to
// makeSpectrumReader in the original (viz-extra.tsx:84/89) — no bin-count
// trap.
//
// Cross-frame state: the original's bass EMA (`bassSm = bassSm*0.7 +
// bass*0.3`, viz-extra.tsx:95) is a fixed per-tick decay — framerate-
// dependent as written. Ported with f.dt: k = f.dt*60 (reference ticks this
// frame), decay = Math.pow(0.7, k); bassSm = bassSm*decay + bass*(1-decay).
// This is the continuous-time generalization of a per-tick exponential
// decay/EMA and reduces to the original's exact 0.7/0.3 split at k=1
// (dt=1/60s); at k=0 (no elapsed time) decay=1 so bassSm is unchanged,
// which is correct.
//
// Sensitivity: `bass` here is f.bands.bass — the host's own N=64
// makeSpectrumReader already applied the user's sensitivity per-bin before
// averaging, same as the original's own N=96 reader.read() return value
// would have. The only actual difference is bin RESOLUTION (96 vs 64) for
// that average, not a sensitivity gap — same category Task 2's ambient
// bundle already disclosed for its 48-vs-64 case. The 96 spoke
// stroke-width/opacity read straight off `viz.bins(96)`, which resamples
// identically to what the original's own N=96 reader.out would have held.
//
// Line stroke-width/opacity are plain SVG user-space numbers with no
// vector-effect="non-scaling-stroke" in the original to preserve — checked,
// it isn't present — so they scale with the SVG's own viewBox/
// preserveAspectRatio the same way the original does; not a re-introduced
// bug.
//
// Only the theme-derived gradient stops and per-spoke stroke color are
// cached and rewritten solely on accent/accent2 change, following the
// neonbars pattern; stroke-width/opacity and the disc radius are
// per-frame-varying and always rewritten.
var SVG_NS = 'http://www.w3.org/2000/svg';
var N = 96;

function svgEl(tag) { return document.createElementNS(SVG_NS, tag); }

var container = document.createElement('div');
container.style.position = 'absolute';
container.style.inset = '0';
container.style.background = 'radial-gradient(circle at center, #0a0c14 0%, #02030a 100%)';
viz.root.appendChild(container);

var svg = svgEl('svg');
svg.setAttribute('viewBox', '-200 -200 400 400');
svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
svg.style.width = '100%';
svg.style.height = '100%';
container.appendChild(svg);

var defs = svgEl('defs');
svg.appendChild(defs);

var grad = svgEl('radialGradient');
grad.setAttribute('id', 'cp-disc');
grad.setAttribute('cx', '0.5');
grad.setAttribute('cy', '0.5');
defs.appendChild(grad);

var stop0 = svgEl('stop');
stop0.setAttribute('offset', '0%');
stop0.setAttribute('stop-opacity', '0.7');
grad.appendChild(stop0);

var stop60 = svgEl('stop');
stop60.setAttribute('offset', '60%');
stop60.setAttribute('stop-opacity', '0.3');
grad.appendChild(stop60);

var stop100 = svgEl('stop');
stop100.setAttribute('offset', '100%');
stop100.setAttribute('stop-opacity', '0');
grad.appendChild(stop100);

var disc = svgEl('circle');
disc.setAttribute('cx', '0');
disc.setAttribute('cy', '0');
disc.setAttribute('r', '60');
disc.setAttribute('fill', 'url(#cp-disc)');
svg.appendChild(disc);

var lines = new Array(N);
for (var i = 0; i < N; i++) {
  var a = (i / N) * Math.PI * 2;
  var ln = svgEl('line');
  ln.setAttribute('x1', String(Math.cos(a) * 90));
  ln.setAttribute('y1', String(Math.sin(a) * 90));
  ln.setAttribute('x2', String(Math.cos(a) * 170));
  ln.setAttribute('y2', String(Math.sin(a) * 170));
  ln.setAttribute('stroke-linecap', 'round');
  svg.appendChild(ln);
  lines[i] = ln;
}

var lastAccent = null;
var lastAccent2 = null;
var bassSm = 0;

viz.on('frame', function (f) {
  var accent = f.theme.accent;
  var accent2 = f.theme.accent2;
  if (accent !== lastAccent || accent2 !== lastAccent2) {
    stop0.setAttribute('stop-color', accent2);
    stop60.setAttribute('stop-color', accent);
    stop100.setAttribute('stop-color', accent);
    for (var j = 0; j < N; j++) {
      lines[j].setAttribute('stroke', j % 8 === 0 ? accent2 : accent);
    }
    lastAccent = accent;
    lastAccent2 = accent2;
  }

  var k = f.dt * 60;
  var decay = Math.pow(0.7, k);
  bassSm = bassSm * decay + f.bands.bass * (1 - decay);

  var bins = viz.bins(N);
  for (var m = 0; m < N; m++) {
    var v = bins[m] || 0;
    lines[m].setAttribute('stroke-width', String(2 + v * 6));
    lines[m].setAttribute('stroke-opacity', String(0.3 + v * 0.7));
  }
  disc.setAttribute('r', String(60 + bassSm * 80));
});

// Ribbon — a single filled symmetric ribbon shape from a 48-bin spectrum.
// Migrated from viz-extra.tsx's VizRibbon.
//
// Bin count: N=48 is the literal value passed to `makeSpectrumReader(N,
// ...)` in the original (viz-extra.tsx:249/253) — no bin-count trap.
//
// No cross-frame state: the path's `d` attribute is rebuilt from scratch
// every frame straight from this frame's bins, same as the original (no
// smoothing/decay beyond what the host's reader already applied).
//
// Sensitivity/smoothing: fully carried by `viz.bins(48)` — the original
// never applies its own extra `* sensitivity` or smoothing pass.
//
// The gradient fill (accent/accent2/accent stops) depends only on theme,
// not on any per-frame value, so — following the neonbars/splitmirror
// pattern — the three stops are only rewritten when accent/accent2 change.
// The path has no stroke at all (fill only, same as the original), so
// there's no non-scaling-stroke opt-out to check here.
var SVG_NS = 'http://www.w3.org/2000/svg';
var N = 48;

function svgEl(tag) { return document.createElementNS(SVG_NS, tag); }

var container = document.createElement('div');
container.style.position = 'absolute';
container.style.inset = '0';
container.style.background = '#06070a';
viz.root.appendChild(container);

var svg = svgEl('svg');
svg.setAttribute('viewBox', '0 0 100 100');
svg.setAttribute('preserveAspectRatio', 'none');
svg.style.width = '100%';
svg.style.height = '100%';
container.appendChild(svg);

var defs = svgEl('defs');
svg.appendChild(defs);

var grad = svgEl('linearGradient');
grad.setAttribute('id', 'rib-fill');
grad.setAttribute('x1', '0');
grad.setAttribute('y1', '0');
grad.setAttribute('x2', '0');
grad.setAttribute('y2', '1');
defs.appendChild(grad);

var stop0 = svgEl('stop');
stop0.setAttribute('offset', '0%');
stop0.setAttribute('stop-opacity', '0.8');
grad.appendChild(stop0);

var stop50 = svgEl('stop');
stop50.setAttribute('offset', '50%');
stop50.setAttribute('stop-opacity', '0.5');
grad.appendChild(stop50);

var stop100 = svgEl('stop');
stop100.setAttribute('offset', '100%');
stop100.setAttribute('stop-opacity', '0.8');
grad.appendChild(stop100);

var path = svgEl('path');
path.setAttribute('d', '');
path.setAttribute('fill', 'url(#rib-fill)');
svg.appendChild(path);

var lastAccent = null;
var lastAccent2 = null;

viz.on('frame', function (f) {
  var accent = f.theme.accent;
  var accent2 = f.theme.accent2;
  if (accent !== lastAccent || accent2 !== lastAccent2) {
    stop0.setAttribute('stop-color', accent);
    stop50.setAttribute('stop-color', accent2);
    stop100.setAttribute('stop-color', accent);
    lastAccent = accent;
    lastAccent2 = accent2;
  }

  var bins = viz.bins(N);
  var top = [];
  var bot = [];
  for (var i = 0; i < N; i++) {
    var x = (i / (N - 1)) * 100;
    var v = bins[i] || 0;
    top.push(x + ',' + (50 - v * 36));
    bot.push(x + ',' + (50 + v * 36));
  }
  bot.reverse();
  var d = 'M ' + top.join(' L ') + ' L ' + bot.join(' L ') + ' Z';
  path.setAttribute('d', d);
});

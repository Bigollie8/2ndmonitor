// Split Mirror — center line with 80 gradient bars, mirrored top/bottom.
// Migrated from the built-in style of the same name (viz-extra.tsx,
// VizSplitMirror). N=80 is both the bar count and the literal N passed to
// makeSpectrumReader in the original (viz-extra.tsx:44/48) — no bin-count
// trap here, unlike some of this task's other four styles.
//
// The original never reads `accent2` at all — its gradient and center line
// are built entirely from `accent`. This port carries that over rather than
// inventing an accent2 use the source doesn't have.
//
// No cross-frame state: bar height is recomputed straight from this frame's
// bins every tick (the original does the same — nothing is remembered
// between frames), so there's nothing to carry across frames and no `f.dt`
// use.
//
// Sensitivity/smoothing: fully carried by `viz.bins(80)` — the original
// never applies its own extra `* sensitivity` or smoothing pass on top of
// what its reader produced, so there's no unreachable term left behind
// (unlike waveform/particles in Tasks 1-2).
//
// No transformOrigin override on the bars, matching the original: the
// default center origin is what makes bars grow symmetrically up AND down
// from the center line — a bottom-anchored origin (like neonbars/bars) would
// break the "mirror" look.
var N = 80;

var container = document.createElement('div');
container.style.position = 'absolute';
container.style.inset = '0';
container.style.background = '#06070a';
container.style.overflow = 'hidden';
viz.root.appendChild(container);

var line = document.createElement('div');
line.style.position = 'absolute';
line.style.top = '50%';
line.style.left = '0';
line.style.right = '0';
line.style.height = '1px';
container.appendChild(line);

var wrap = document.createElement('div');
wrap.style.position = 'absolute';
wrap.style.inset = '0';
wrap.style.display = 'flex';
wrap.style.alignItems = 'center';
wrap.style.justifyContent = 'center';
container.appendChild(wrap);

var row = document.createElement('div');
row.style.width = '88%';
row.style.height = '80%';
row.style.display = 'flex';
row.style.alignItems = 'center';
row.style.gap = '0.4%';
wrap.appendChild(row);

var bars = new Array(N);
for (var i = 0; i < N; i++) {
  var bar = document.createElement('div');
  bar.style.flex = '1';
  bar.style.height = '100%';
  bar.style.borderRadius = '1px';
  row.appendChild(bar);
  bars[i] = bar;
}

var lastAccent = null;

viz.on('frame', function (f) {
  var accent = f.theme.accent;
  if (accent !== lastAccent) {
    line.style.background = accent + '88';
    line.style.boxShadow = '0 0 8px ' + accent;
    var bg = 'linear-gradient(180deg, transparent, ' + accent + ' 45%, ' + accent + ' 55%, transparent)';
    for (var j = 0; j < N; j++) bars[j].style.background = bg;
    lastAccent = accent;
  }

  var bins = viz.bins(N);
  for (var k = 0; k < N; k++) {
    var v = bins[k] || 0;
    bars[k].style.transform = 'scaleY(' + v + ')';
  }
});

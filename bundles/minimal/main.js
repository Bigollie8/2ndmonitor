// Minimal Dots — three dots that size-pulse to bass/mid/treble. Migrated
// from viz-extra.tsx's VizMinimalDots.
//
// Bin count: N=16 is the literal value passed to `makeSpectrumReader(16,
// ...)` in the original (viz-extra.tsx:566) — there's no local `const N`
// beside it (unlike neonbars/splitmirror), just the bare literal, but it's
// the same value: the three band groups below index up to s[15]. No
// bin-count trap.
//
// No cross-frame state: each dot's scale is recomputed straight from this
// frame's bins every tick — the original does the same (no smoothing/decay
// beyond what the host's reader already applied) — so there's nothing to
// carry across frames and no `f.dt` use.
//
// Sensitivity/smoothing: fully carried by `viz.bins(16)` — the original
// never applies its own extra `* sensitivity` or smoothing pass on top of
// what its reader produced.
//
// Each dot's background/box-shadow color (`i === 1 ? accent2 : accent`) is
// a JSX prop in the original — set once per render, not touched inside the
// rAF tick — so, following the circular/neonbars/ribbon pattern, colors
// are cached here and only rewritten when `f.theme.accent`/`accent2`
// actually change. `transform: 'none'` in the original disables any
// inherited CSS transition on the dot; carried over explicitly even though
// nothing here would otherwise set one, for fidelity.
var container = document.createElement('div');
container.style.position = 'absolute';
container.style.inset = '0';
container.style.background = '#06070a';
container.style.display = 'flex';
container.style.alignItems = 'center';
container.style.justifyContent = 'center';
container.style.gap = '8%';
viz.root.appendChild(container);

var LABELS = ['BASS', 'MID', 'TREBLE'];
var dots = new Array(3);

for (var i = 0; i < 3; i++) {
  var col = document.createElement('div');
  col.style.display = 'flex';
  col.style.flexDirection = 'column';
  col.style.alignItems = 'center';
  col.style.gap = '24px';
  container.appendChild(col);

  var dot = document.createElement('div');
  dot.style.width = '140px';
  dot.style.height = '140px';
  dot.style.borderRadius = '50%';
  dot.style.transition = 'none';
  col.appendChild(dot);
  dots[i] = dot;

  var label = document.createElement('span');
  label.style.fontSize = '12px';
  label.style.fontFamily = '"JetBrains Mono", ui-monospace, monospace';
  label.style.color = 'rgba(255,255,255,0.4)';
  label.style.letterSpacing = '.2em';
  label.textContent = LABELS[i];
  col.appendChild(label);
}

var lastAccent = null;
var lastAccent2 = null;

viz.on('frame', function (f) {
  var accent = f.theme.accent;
  var accent2 = f.theme.accent2;
  if (accent !== lastAccent || accent2 !== lastAccent2) {
    for (var j = 0; j < 3; j++) {
      var color = j === 1 ? accent2 : accent;
      dots[j].style.background = color;
      dots[j].style.boxShadow = '0 0 80px ' + color;
    }
    lastAccent = accent;
    lastAccent2 = accent2;
  }

  var s = viz.bins(16);
  var bands = [
    ((s[0] || 0) + (s[1] || 0) + (s[2] || 0)) / 3,
    ((s[6] || 0) + (s[7] || 0) + (s[8] || 0)) / 3,
    ((s[13] || 0) + (s[14] || 0) + (s[15] || 0)) / 3,
  ];
  for (var k = 0; k < 3; k++) {
    var sc = 0.5 + bands[k] * 1.3;
    dots[k].style.transform = 'scale(' + sc + ')';
  }
});

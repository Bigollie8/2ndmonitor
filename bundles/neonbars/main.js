// Neon Bars — 56 glowing mirrored bars, one <div> each, scaleY'd per bin.
// Migrated from the built-in style of the same name (viz-extra.tsx,
// VizNeonBars) as the first DOM-surface bundle. Unlike a canvas bundle,
// which repaints the whole frame every tick regardless, DOM elements carry
// real per-node style-write cost — so the 56 divs are built once here
// (not inside the frame callback) and only the animating part (`transform:
// scaleY(...)`) is written every frame. The gradient/glow (theme-derived)
// is only rewritten when `f.theme.accent`/`accent2` actually change between
// frames, so a steady-state theme doesn't churn 56 style strings at 60fps
// for a colour that isn't moving — but a theme change still lands on the
// very next frame, same as the original React version re-rendering on a
// prop change.
//
// viz.root is provided empty by the sandbox host for a "dom" surface
// manifest (see app/src/sandbox/sandbox-html.ts) — bars are appended to a
// child container, never styled directly on viz.root itself, so the host's
// own show/hide toggling of #root (driven by an inline style it does not
// control here) is never fought over.
var N = 56;

var container = document.createElement('div');
container.style.position = 'absolute';
container.style.inset = '0';
container.style.background = '#020308';
container.style.display = 'flex';
container.style.alignItems = 'center';
container.style.justifyContent = 'center';
viz.root.appendChild(container);

var row = document.createElement('div');
row.style.width = '92%';
row.style.height = '70%';
row.style.display = 'flex';
row.style.alignItems = 'flex-end';
row.style.gap = '0.4%';
container.appendChild(row);

var bars = new Array(N);
for (var i = 0; i < N; i++) {
  var bar = document.createElement('div');
  bar.style.flex = '1';
  bar.style.height = '100%';
  bar.style.transformOrigin = 'bottom center';
  bar.style.borderRadius = '2px';
  row.appendChild(bar);
  bars[i] = bar;
}

var lastAccent = null;
var lastAccent2 = null;

viz.on('frame', function (f) {
  var accent = f.theme.accent;
  var accent2 = f.theme.accent2;
  if (accent !== lastAccent || accent2 !== lastAccent2) {
    var bg = 'linear-gradient(0deg, ' + accent2 + ', ' + accent + ')';
    var glow = '0 0 16px ' + accent + ', 0 0 32px ' + accent2 + '55';
    for (var j = 0; j < N; j++) {
      bars[j].style.background = bg;
      bars[j].style.boxShadow = glow;
    }
    lastAccent = accent;
    lastAccent2 = accent2;
  }

  var bins = viz.bins(N);
  for (var k = 0; k < N; k++) {
    var v = bins[k] || 0;
    bars[k].style.transform = 'scaleY(' + v + ')';
  }
});

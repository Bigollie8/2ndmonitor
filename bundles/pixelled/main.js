// Pixel LED — a 32x20 retro LED grid with heat-mapped colors. Migrated from
// viz-extra.tsx's VizPixelLED.
//
// Bin count: N=32 is the literal value passed to `makeSpectrumReader(N,
// ...)` in the original (viz-extra.tsx:196/201) — matches the column count,
// no bin-count trap. ROWS=20 is a fixed grid-resolution constant, not a bin
// count — it is never passed to a reader anywhere in the original, so it
// stays a plain literal here too, exactly as in the source.
//
// No cross-frame state: every cell's lit/color/opacity is recomputed fresh
// from this frame's bins each tick — the original does the same; it never
// remembers a previous frame's lit state either (no phosphor decay). So
// there's nothing to carry across frames and no `f.dt` use.
//
// Sensitivity/smoothing: fully carried by `viz.bins(32)` — the original
// never applies its own extra `* sensitivity` or a second smoothing pass on
// top of what its reader produced.
//
// Unlike neonbars/splitmirror/ribbon, a cell's color legitimately depends
// on the per-frame bin value `v` (which row is lit), not on theme alone —
// so there's no steady-theme case to optimize away here: every lit cell's
// background/box-shadow/opacity is written every frame regardless, exactly
// mirroring the original (it also touches every one of the N*ROWS=640
// cells on every tick). `f.theme.accent`/`accent2` are still read fresh
// from `f` each frame, never hoisted or cached.
var N = 32;
var ROWS = 20;

var container = document.createElement('div');
container.style.position = 'absolute';
container.style.inset = '0';
container.style.background = '#020306';
container.style.display = 'flex';
container.style.alignItems = 'center';
container.style.justifyContent = 'center';
viz.root.appendChild(container);

var grid = document.createElement('div');
grid.style.width = '88%';
grid.style.height = '78%';
grid.style.display = 'grid';
grid.style.gridTemplateColumns = 'repeat(' + N + ', 1fr)';
grid.style.gap = '2px';
container.appendChild(grid);

var cells = new Array(N * ROWS);
for (var i = 0; i < N; i++) {
  var col = document.createElement('div');
  col.style.display = 'grid';
  col.style.gridTemplateRows = 'repeat(' + ROWS + ', 1fr)';
  col.style.gap = '2px';
  grid.appendChild(col);
  for (var r = 0; r < ROWS; r++) {
    var cell = document.createElement('div');
    cell.style.borderRadius = '1px';
    col.appendChild(cell);
    cells[i * ROWS + r] = cell;
  }
}

viz.on('frame', function (f) {
  var accent = f.theme.accent;
  var accent2 = f.theme.accent2;
  var bins = viz.bins(N);
  for (var c = 0; c < N; c++) {
    var v = bins[c] || 0;
    var lit = Math.floor(v * ROWS);
    for (var rr = 0; rr < ROWS; rr++) {
      var cell = cells[c * ROWS + rr];
      var isLit = (ROWS - rr) <= lit;
      var heatRow = (ROWS - rr) / ROWS;
      if (isLit) {
        var color = heatRow > 0.85 ? '#ef4444' : heatRow > 0.65 ? accent2 : accent;
        cell.style.background = color;
        cell.style.boxShadow = '0 0 6px ' + color;
        cell.style.opacity = '1';
      } else {
        cell.style.background = 'rgba(255,255,255,0.04)';
        cell.style.boxShadow = 'none';
        cell.style.opacity = '0.6';
      }
    }
  }
});

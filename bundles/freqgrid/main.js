// Frequency Grid — 32x16 bar grid: 16 frequency rows x 32 columns of
// scrolling history. Migrated from viz-extra.tsx's VizFreqGrid.
//
// Bin count: COLS=32 is a HISTORY-column count, not a bin count — it never
// reaches makeSpectrumReader anywhere in the original. The real bin count
// is ROWS=16, the literal argument to makeSpectrumReader in the original
// (viz-extra.tsx:512) — reader.out[r] is read for r in 0..15. So this
// bundle calls `viz.bins(16)`, not `viz.bins(32)` — the exact bin-count
// trap flagged in the task brief (const beside the reader call vs. the
// real argument).
//
// Cross-frame state: the original keeps a COLS-entry ring buffer of
// ROWS-float history rows (`histRef` + `headRef`), advanced by exactly one
// column per rendered frame and never decayed by a per-tick constant — so
// there's no `f.dt` scaling to apply here (nothing here is a continuous
// accumulator or an exponential decay; it's a discrete "push one column of
// this frame's spectrum" step, same shape as the already-ported
// `spectrogram` bundle's scroll-per-frame canvas history, which is
// likewise left un-scaled by dt — see its main.js comment). Ported with a
// plain array of Float32Arrays + a head index, mirroring the original's
// ring exactly (same modulo arithmetic, same newest-first column mapping).
//
// Sensitivity: fully carried by `viz.bins(16)` — the original never
// applies its own extra `* sensitivity` or smoothing pass past what its
// reader produced.
//
// Cell geometry (opacity/transform) is per-frame-varying and always
// rewritten, matching the original's own tick (it touches every one of the
// COLS*ROWS=512 cells each frame regardless). Each cell's background/
// box-shadow color, though, depends only on its row's heat band
// (`r > ROWS*0.7 ? accent2 : accent`) and is a JSX prop in the original —
// set once per render, not touched inside the rAF tick — so, following the
// circular/neonbars/ribbon pattern, colors are cached here and only
// rewritten when `f.theme.accent`/`accent2` actually change.
var COLS = 32;
var ROWS = 16;

var container = document.createElement('div');
container.style.position = 'absolute';
container.style.inset = '0';
container.style.background = '#04050b';
container.style.display = 'flex';
container.style.alignItems = 'center';
container.style.justifyContent = 'center';
viz.root.appendChild(container);

var grid = document.createElement('div');
grid.style.width = '88%';
grid.style.height = '78%';
grid.style.display = 'grid';
grid.style.gridTemplateColumns = 'repeat(' + COLS + ', 1fr)';
grid.style.gap = '4px';
container.appendChild(grid);

var cells = new Array(COLS * ROWS);
for (var c = 0; c < COLS; c++) {
  var col = document.createElement('div');
  col.style.display = 'grid';
  col.style.gridTemplateRows = 'repeat(' + ROWS + ', 1fr)';
  col.style.gap = '4px';
  grid.appendChild(col);
  for (var r = 0; r < ROWS; r++) {
    var cell = document.createElement('div');
    cell.style.borderRadius = '2px';
    col.appendChild(cell);
    cells[c * ROWS + r] = cell;
  }
}

// Pre-allocated history ring: COLS columns, each ROWS floats. `head` points
// at the most-recently-written column.
var hist = new Array(COLS);
for (var hi = 0; hi < COLS; hi++) hist[hi] = new Float32Array(ROWS);
var head = 0;

var lastAccent = null;
var lastAccent2 = null;

viz.on('frame', function (f) {
  var accent = f.theme.accent;
  var accent2 = f.theme.accent2;
  if (accent !== lastAccent || accent2 !== lastAccent2) {
    for (var cc = 0; cc < COLS; cc++) {
      for (var rr = 0; rr < ROWS; rr++) {
        var color = rr > ROWS * 0.7 ? accent2 : accent;
        var cell = cells[cc * ROWS + rr];
        cell.style.background = color;
        cell.style.boxShadow = '0 0 6px ' + color + '66';
      }
    }
    lastAccent = accent;
    lastAccent2 = accent2;
  }

  var bins = viz.bins(ROWS);

  // Advance ring head, then copy current spectrum into the new head row.
  head = (head + 1) % COLS;
  var headRow = hist[head];
  for (var r = 0; r < ROWS; r++) {
    headRow[r] = bins[r] || 0;
  }

  // Render: col 0 = newest, col COLS-1 = oldest. Map col c -> ring index
  // (head - c + COLS) % COLS.
  for (var c = 0; c < COLS; c++) {
    var ringIdx = (head - c + COLS) % COLS;
    var row = hist[ringIdx];
    for (var r2 = 0; r2 < ROWS; r2++) {
      var el = cells[c * ROWS + r2];
      var v = row[r2] || 0;
      el.style.opacity = (v * 0.95).toFixed(2);
      el.style.transform = 'scale(' + (0.3 + v * 0.7) + ')';
    }
  }
});

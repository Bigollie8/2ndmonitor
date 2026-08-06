// Equalizer — the classic segmented LED spectrum: 20 bands, each a stack of
// LED blocks lit from the bottom, with a peak-hold segment that hangs then
// falls. Canvas surface (the default): a segmented look means bands × rows
// cells per frame, which as DOM nodes would be ~500 style writes a tick —
// fillRect is the right tool.
//
// Colours come from the theme like every official bundle: lit cells ramp
// accent → accent2 with height (the classic green→red ramp, but in the
// user's palette); unlit cells are the accent at low alpha so the full grid
// reads as hardware even in silence. The host's shared procedural fallback
// keeps it moving when nothing plays.
//
// Attack is instant, release decays per-frame (0.94^ (dt/0.04) — wall-clock
// scaled the same way the host's own reader is since 0.8.8) so bars snap up
// on hits and bleed down like a real EQ's ballistics instead of tracking the
// raw spectrum both ways.
var BANDS = 20;
var ROWS = 24;
var level = new Float32Array(BANDS); // displayed level, after ballistics
var peak = new Float32Array(BANDS);  // peak-hold row, falls slowly
var hold = new Float32Array(BANDS);  // frames left before the peak starts falling

function hexToRgb(hex) {
  var m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return [167, 139, 250];
  var n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

var lastAccent = null, lastAccent2 = null;
var rowColors = [];   // per-row lit colour, accent → accent2 bottom-to-top
var rowColorsDim = []; // per-row unlit colour

function rebuildPalette(accent, accent2) {
  var a = hexToRgb(accent), b = hexToRgb(accent2);
  rowColors = [];
  rowColorsDim = [];
  for (var r = 0; r < ROWS; r++) {
    var t = ROWS === 1 ? 0 : r / (ROWS - 1);
    var cr = Math.round(a[0] + (b[0] - a[0]) * t);
    var cg = Math.round(a[1] + (b[1] - a[1]) * t);
    var cb = Math.round(a[2] + (b[2] - a[2]) * t);
    rowColors.push('rgb(' + cr + ',' + cg + ',' + cb + ')');
    rowColorsDim.push('rgba(' + cr + ',' + cg + ',' + cb + ',0.10)');
  }
  lastAccent = accent;
  lastAccent2 = accent2;
}

viz.on('frame', function (f) {
  var ctx = f.ctx;
  if (!ctx) return;
  var w = f.size.width;
  var h = f.size.height;
  if (w <= 0 || h <= 0) return;
  if (f.theme.accent !== lastAccent || f.theme.accent2 !== lastAccent2) {
    rebuildPalette(f.theme.accent, f.theme.accent2);
  }

  var bins = viz.bins(BANDS);
  // dt arrives in seconds (clamped by the host); scale the release the same
  // way the host scales its own decays, anchored at the 40ms design step.
  var dtScale = (f.dt > 0 ? f.dt : 0.04) / 0.04;
  var release = Math.pow(0.94, dtScale);
  var peakFall = 0.004 * dtScale;

  for (var i = 0; i < BANDS; i++) {
    var v = bins[i] || 0;
    level[i] = v > level[i] ? v : level[i] * release;
    if (level[i] >= peak[i]) {
      peak[i] = level[i];
      hold[i] = 18; // ~0.7s at the 40ms step before the cap starts falling
    } else if (hold[i] > 0) {
      hold[i] -= dtScale;
    } else {
      peak[i] = Math.max(0, peak[i] - peakFall);
    }
  }

  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#020308';
  ctx.fillRect(0, 0, w, h);

  var padX = w * 0.05;
  var padY = h * 0.08;
  var plotW = w - padX * 2;
  var plotH = h - padY * 2;
  var gapX = plotW * 0.012;
  var gapY = plotH * 0.012;
  var cellW = (plotW - gapX * (BANDS - 1)) / BANDS;
  var cellH = (plotH - gapY * (ROWS - 1)) / ROWS;
  if (cellW <= 0 || cellH <= 0) return;

  for (var b = 0; b < BANDS; b++) {
    var x = padX + b * (cellW + gapX);
    var lit = Math.round(level[b] * ROWS);
    var peakRow = Math.min(ROWS - 1, Math.round(peak[b] * ROWS) - 1);
    for (var r = 0; r < ROWS; r++) {
      var y = padY + plotH - (r + 1) * cellH - r * gapY;
      ctx.fillStyle = r < lit ? rowColors[r] : rowColorsDim[r];
      ctx.fillRect(x, y, cellW, cellH);
    }
    if (peakRow >= 0 && peakRow >= lit) {
      var py = padY + plotH - (peakRow + 1) * cellH - peakRow * gapY;
      ctx.fillStyle = rowColors[peakRow];
      ctx.fillRect(x, py, cellW, cellH);
    }
  }
});

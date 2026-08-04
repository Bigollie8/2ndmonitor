// Terrain - spectrum history as a wireframe range receding into the
// distance. Pure 2D projection, no WebGL: rows are scaled and offset by
// depth. Distinct from freqgrid (flat) and tunnel (radial).
var NB = 48;
var COLS = 24;
var ROWS = 14;
var TICK = 1 / 10;

var rows = [];
for (var r = 0; r < ROWS; r++) rows.push(new Float32Array(COLS));
var acc = 0;

function accRGB(hex) {
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
}
function accA(hex, a) {
  var c = accRGB(hex);
  return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')';
}

viz.on('frame', function (f) {
  var ctx = f.ctx;
  if (!ctx) return;
  var w = f.size.width, h = f.size.height;
  if (w <= 0 || h <= 0) return;
  var accent = f.theme.accent;
  var bins = viz.bins(NB);

  acc += Math.max(0, Math.min(0.1, f.dt || 0.016));
  if (acc >= TICK) {
    acc = acc % TICK;
    var row = rows.pop();
    for (var i = 0; i < COLS; i++) {
      var c = Math.abs(i - (COLS - 1) / 2) / ((COLS - 1) / 2);
      row[i] = bins[Math.floor(c * (NB - 1))] || 0;
    }
    rows.unshift(row);
  }

  ctx.clearRect(0, 0, w, h);

  var cx = w * 0.5;
  var horizon = h * 0.26;
  var depthSpan = h * 0.62;
  var colSpan = w * 0.86;

  for (var k = rows.length - 1; k >= 0; k--) {
    var depth = k / rows.length;
    var y0 = horizon + (1 - depth) * depthSpan;
    var scaleX = 1 - depth * 0.45;
    var amp = h * 0.20 * (1 - depth * 0.55);
    ctx.beginPath();
    for (var j = 0; j < COLS; j++) {
      var x = cx + (j - (COLS - 1) / 2) * (colSpan / COLS) * scaleX;
      var y = y0 - rows[k][j] * amp;
      if (j === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    // Nearest row is the accent; the rest fade toward the horizon.
    ctx.strokeStyle = k === 0 ? accent : accA(accent, Math.max(0.05, 0.55 - depth * 0.5));
    ctx.lineWidth = k === 0 ? 1.7 : 1;
    ctx.stroke();
  }
});

// Ridgeline - Unknown Pleasures as a live spectrum. Each tick pushes a new
// mirrored-spectrum ridge onto the stack and the rest slide down.
//
// Rows advance on a fixed ~12Hz cadence rather than per frame, so the stack
// scrolls at the same speed regardless of the host's frame rate (the perf
// modes cap it differently). Each row is filled with the canvas background
// before stroking so nearer ridges occlude farther ones - that occlusion is
// the whole look.
var NB = 40;
var COLS = 60;
var ROWS = 12;
var TICK = 1 / 12;

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
      // Mirror around the centre: column 0 and COLS-1 are the quietest.
      var c = Math.abs(i - (COLS - 1) / 2) / ((COLS - 1) / 2);
      var bi = Math.floor((1 - c) * (NB - 1));
      row[i] = (bins[bi] || 0) * Math.pow(1 - c, 1.5);
    }
    rows.unshift(row);
  }

  ctx.clearRect(0, 0, w, h);

  var padX = w * 0.07;
  var plotW = Math.max(1, w - padX * 2);
  var top = h * 0.16;
  var step = (h * 0.70) / ROWS;
  var amp = step * 2.6;

  for (var k = rows.length - 1; k >= 0; k--) {
    var y0 = top + k * step;
    var rr = rows[k];
    ctx.beginPath();
    ctx.moveTo(padX, y0);
    for (var j = 0; j < COLS; j++) {
      ctx.lineTo(padX + (j / (COLS - 1)) * plotW, y0 - rr[j] * amp);
    }
    ctx.lineTo(padX + plotW, y0);
    ctx.closePath();
    // Opaque fill = occlusion. Matches the host canvas base colour.
    ctx.fillStyle = '#06070a';
    ctx.fill();
    ctx.strokeStyle = k === 0 ? accent : 'rgba(255,255,255,' + Math.max(0.08, 0.75 - k * 0.055) + ')';
    ctx.lineWidth = k === 0 ? 1.6 : 1.1;
    ctx.stroke();
  }
});

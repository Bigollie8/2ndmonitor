// Beat lab - onset strength scrolling with a threshold line and detected
// beat markers, a brightness (spectral centroid) track underneath, and a
// live BPM readout that flashes on the kick.
//
// Spectral flux is computed HERE, not by the host: it is one subtraction
// against the previous frame's bins (positive differences only - energy
// appearing, not decaying). The host's own `onset` is a smoothed scalar and
// is used only to flash the BPM readout, because the whole point of this
// style is showing the raw curve the detector works from.
//
// Histories advance on a fixed ~30Hz cadence so the scroll speed does not
// change with the host frame rate.
var NB = 48;
var HIST = 120;
var TICK = 1 / 30;
// Flux is unnormalised (sum of positive bin deltas), so the plot needs a
// divisor. 6 keeps typical music in the upper half without clipping.
var FLUX_SCALE = 6;
var THRESHOLD = 0.4;

var prev = new Float32Array(NB);
var fluxHist = new Float32Array(HIST);
var centHist = new Float32Array(HIST);
var acc = 0;
var centroid = 0.3;
var bpm = 120;
var lastBeat = -1;
var elapsed = 0;
var armed = true;

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
  var dt = Math.max(0, Math.min(0.1, f.dt || 0.016));
  elapsed += dt;

  // Spectral flux: positive spectral difference only.
  var flux = 0;
  var cw = 0;
  var cs = 0;
  for (var i = 0; i < NB; i++) {
    var v = bins[i] || 0;
    var d = v - prev[i];
    if (d > 0) flux += d;
    cw += v * (i / NB);
    cs += v;
    prev[i] = v;
  }
  centroid += ((cs > 0 ? cw / cs : 0) - centroid) * Math.min(1, dt * 8);

  var norm = Math.max(0, Math.min(1, flux / FLUX_SCALE));

  // BPM from the interval between threshold crossings. `armed` gives
  // hysteresis so one long transient is not counted as several beats.
  if (norm > THRESHOLD && armed) {
    armed = false;
    if (lastBeat >= 0) {
      var iv = elapsed - lastBeat;
      if (iv > 0.25 && iv < 2) bpm += (60 / iv - bpm) * 0.25;
    }
    lastBeat = elapsed;
  } else if (norm < THRESHOLD * 0.6) {
    armed = true;
  }

  acc += dt;
  if (acc >= TICK) {
    acc = acc % TICK;
    fluxHist.copyWithin(0, 1);
    fluxHist[HIST - 1] = norm;
    centHist.copyWithin(0, 1);
    centHist[HIST - 1] = centroid;
  }

  ctx.clearRect(0, 0, w, h);

  var padX = w * 0.05;
  var plotW = Math.max(1, w - padX * 2);
  var gy = h * 0.14;
  var gh = h * 0.44;

  ctx.font = Math.max(7, h * 0.045) + 'px "JetBrains Mono", ui-monospace, monospace';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = 'rgba(255,255,255,0.40)';
  ctx.fillText('ONSET STRENGTH', padX, gy - h * 0.035);

  ctx.strokeStyle = 'rgba(255,255,255,0.07)';
  ctx.lineWidth = 1;
  ctx.strokeRect(padX, gy, plotW, gh);

  // Beat markers behind the curve.
  for (var m = 1; m < HIST; m++) {
    if (fluxHist[m] > THRESHOLD && fluxHist[m] > fluxHist[m - 1]) {
      ctx.fillStyle = 'rgba(255,255,255,0.16)';
      ctx.fillRect(padX + (m / (HIST - 1)) * plotW, gy, 1, gh);
    }
  }

  ctx.beginPath();
  for (var j = 0; j < HIST; j++) {
    var x = padX + (j / (HIST - 1)) * plotW;
    var y = gy + gh - fluxHist[j] * gh;
    if (j === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.strokeStyle = accent;
  ctx.lineWidth = 1.4;
  ctx.stroke();

  ctx.setLineDash([3, 4]);
  ctx.beginPath();
  ctx.moveTo(padX, gy + gh - THRESHOLD * gh);
  ctx.lineTo(padX + plotW, gy + gh - THRESHOLD * gh);
  ctx.strokeStyle = 'rgba(252,165,165,0.45)';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.setLineDash([]);

  // Brightness track.
  var by = gy + gh + h * 0.14;
  var bh = h * 0.16;
  var bw = plotW * 0.62;
  ctx.fillStyle = 'rgba(255,255,255,0.40)';
  ctx.fillText('BRIGHTNESS', padX, by - h * 0.035);
  ctx.strokeStyle = 'rgba(255,255,255,0.07)';
  ctx.strokeRect(padX, by, bw, bh);
  ctx.beginPath();
  for (var k = 0; k < HIST; k++) {
    var bx = padX + (k / (HIST - 1)) * bw;
    var byy = by + bh - Math.max(0, Math.min(1, centHist[k] * 2.4)) * bh;
    if (k === 0) ctx.moveTo(bx, byy); else ctx.lineTo(bx, byy);
  }
  ctx.strokeStyle = 'rgba(255,255,255,0.55)';
  ctx.lineWidth = 1.2;
  ctx.stroke();

  // BPM readout, flashing on the host's onset.
  var hot = (f.onset || 0) > 0.5;
  ctx.textAlign = 'right';
  ctx.fillStyle = 'rgba(255,255,255,0.40)';
  ctx.fillText('BPM', w - padX, by - h * 0.035);
  ctx.font = '700 ' + Math.max(16, h * 0.13) + 'px "JetBrains Mono", ui-monospace, monospace';
  ctx.fillStyle = hot ? accent : '#ffffff';
  ctx.fillText(String(Math.round(bpm)), w - padX, by + bh);
});

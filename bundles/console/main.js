// Loudness console - L/R meters with peak-hold, a rolling level history, and
// live numbers: peak, RMS, crest factor and correlation. For people who want
// the data rather than the light show.
//
// Deliberately labelled RMS, not LUFS: these are plain RMS windows with no
// K-weighting and no gating, so calling them LUFS would be wrong. True
// loudness metering is a later job.
//
// Reads f.waveformL / f.waveformR (0.8.4). A mono source - including any
// per-app audio source, which is mixed before it reaches the host's ring -
// has left === right, so both meters track together and correlation reads
// 1.00. That is correct for mono, not a fault.
var CENTER = 128;
var SCALE = 1 / 127;
var HIST = 160;
var TICK = 1 / 30;

var hist = new Float32Array(HIST);
var acc = 0;
var holdL = 0, holdR = 0;

function accRGB(hex) {
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
}
function accA(hex, a) {
  var c = accRGB(hex);
  return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')';
}
function db(v) { return 20 * Math.log10(Math.max(v, 1e-6)); }
/** dBFS -> 0..1 over a 60 dB window, matching the meter scale drawn below. */
function norm(d) { return Math.max(0, Math.min(1, (d + 60) / 60)); }

viz.on('frame', function (f) {
  var ctx = f.ctx;
  if (!ctx) return;
  var w = f.size.width, h = f.size.height;
  if (w <= 0 || h <= 0) return;
  var accent = f.theme.accent;
  // Graceful degradation (0.8.4): a host that predates the stereo waveform -
  // or a preview harness that only supplies the mono one - still gets a
  // correct picture rather than a "waiting" placeholder. Feeding the mono
  // channel to BOTH sides is exactly what a mono source looks like: a
  // vertical trace at correlation 1.00, which is the honest reading.
  var L = f.waveformL || f.waveform;
  var R = f.waveformR || f.waveform;
  var dt = Math.max(0.001, Math.min(0.1, f.dt || 0.016));

  ctx.clearRect(0, 0, w, h);

  if (!L || !R || !L.length) {
    ctx.font = '11px "JetBrains Mono", ui-monospace, monospace';
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.textAlign = 'center';
    ctx.fillText('waiting for audio', w / 2, h / 2);
    return;
  }

  var n = Math.min(L.length, R.length);
  var sumL = 0, sumR = 0, sumM = 0, pkL = 0, pkR = 0;
  var dot = 0, nl = 0, nr = 0;
  for (var i = 0; i < n; i++) {
    var l = (L[i] - CENTER) * SCALE;
    var r = (R[i] - CENTER) * SCALE;
    var m = (l + r) * 0.5;
    sumL += l * l; sumR += r * r; sumM += m * m;
    if (Math.abs(l) > pkL) pkL = Math.abs(l);
    if (Math.abs(r) > pkR) pkR = Math.abs(r);
    dot += l * r; nl += l * l; nr += r * r;
  }
  var rmsL = Math.sqrt(sumL / n), rmsR = Math.sqrt(sumR / n), rmsM = Math.sqrt(sumM / n);
  var denom = Math.sqrt(nl * nr);
  var corr = denom > 1e-9 ? dot / denom : 1;
  var peak = Math.max(pkL, pkR);

  // Peak-hold falls slowly so a transient stays readable.
  holdL = Math.max(holdL - dt * 0.35, pkL);
  holdR = Math.max(holdR - dt * 0.35, pkR);

  acc += dt;
  if (acc >= TICK) {
    acc = acc % TICK;
    hist.copyWithin(0, 1);
    hist[HIST - 1] = norm(db(rmsM));
  }

  var pad = Math.max(10, w * 0.03);
  var meterW = 14;
  var top = h * 0.16;
  var mh = h * 0.62;

  ctx.font = '9px "JetBrains Mono", ui-monospace, monospace';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';

  function meter(x, rms, hold, label) {
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    ctx.fillRect(x, top, meterW, mh);
    var v = norm(db(rms)) * mh;
    var grad = ctx.createLinearGradient(0, top + mh, 0, top);
    grad.addColorStop(0, accA(accent, 0.9));
    grad.addColorStop(0.82, accA(accent, 0.9));
    grad.addColorStop(1, '#fca5a5');
    ctx.fillStyle = grad;
    ctx.fillRect(x, top + mh - v, meterW, v);
    var hv = norm(db(hold)) * mh;
    ctx.fillStyle = '#fff';
    ctx.fillRect(x, top + mh - hv - 1, meterW, 2);
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.fillText(label, x + 3, top + mh + 14);
  }
  meter(pad, rmsL, holdL, 'L');
  meter(pad + meterW + 6, rmsR, holdR, 'R');
  ctx.fillStyle = 'rgba(255,255,255,0.4)';
  ctx.fillText('RMS', pad, top - 8);

  // Level history.
  var hx = pad + meterW * 2 + 22;
  var numbersW = Math.min(150, w * 0.32);
  var hw = Math.max(40, w - hx - numbersW - pad);
  ctx.fillStyle = 'rgba(255,255,255,0.4)';
  ctx.fillText('LEVEL · 5s', hx, top - 8);
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.lineWidth = 1;
  ctx.strokeRect(hx, top, hw, mh);
  ctx.beginPath();
  for (var j = 0; j < HIST; j++) {
    var px = hx + (j / (HIST - 1)) * hw;
    var py = top + mh - hist[j] * mh;
    if (j === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.strokeStyle = accent;
  ctx.lineWidth = 1.4;
  ctx.stroke();
  ctx.lineTo(hx + hw, top + mh);
  ctx.lineTo(hx, top + mh);
  ctx.closePath();
  ctx.fillStyle = accA(accent, 0.12);
  ctx.fill();

  // Numbers. Crest factor (peak minus RMS) is the dynamics readout - a
  // heavily compressed master sits near 6 dB, an untouched mix nearer 15.
  var nx = hx + hw + 14;
  var rows = [
    ['PEAK', db(peak).toFixed(1) + ' dB'],
    ['RMS', db(rmsM).toFixed(1) + ' dB'],
    ['CREST', (db(peak) - db(rmsM)).toFixed(1) + ' dB'],
    ['CORR', corr.toFixed(2)],
  ];
  for (var k = 0; k < rows.length; k++) {
    var ry = top + 4 + k * (mh / 4);
    ctx.font = '9px "JetBrains Mono", ui-monospace, monospace';
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.fillText(rows[k][0], nx, ry);
    ctx.font = '700 14px "JetBrains Mono", ui-monospace, monospace';
    ctx.fillStyle = (k === 3 && corr < 0) ? '#fca5a5' : '#fff';
    ctx.fillText(rows[k][1], nx, ry + 17);
  }
});

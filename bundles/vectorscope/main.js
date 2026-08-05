// Vectorscope - the stereo field as engineers see it: a mid/side point cloud
// (tall = mono, wide = spacious) with live correlation and width meters.
//
// Reads f.waveformL / f.waveformR, which the host added in 0.8.4. Bytes are
// 0-255 centred at 128, the Web Audio getByteTimeDomainData convention.
//
// A mono source - which includes ANY per-app audio source, because per-app
// capture is mixed before it reaches the host's ring - has left === right, so
// the cloud collapses to a vertical line and correlation reads 1.00. That is
// the correct display of a mono signal, not a failure.
var CENTER = 128;
var SCALE = 1 / 127;

function accRGB(hex) {
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
}
function accA(hex, a) {
  var c = accRGB(hex);
  return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')';
}

var corrSmooth = 1;
var widthSmooth = 0;

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

  // Fade rather than clear: the cloud reads better with a short persistence,
  // the way a real goniometer's phosphor does.
  ctx.fillStyle = 'rgba(6,7,10,0.28)';
  ctx.fillRect(0, 0, w, h);

  if (!L || !R || !L.length) {
    ctx.font = '11px "JetBrains Mono", ui-monospace, monospace';
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.textAlign = 'center';
    ctx.fillText('waiting for audio', w / 2, h / 2);
    return;
  }

  var n = Math.min(L.length, R.length);
  var meterW = Math.min(120, w * 0.28);
  var plotW = w - meterW;
  var cx = plotW * 0.5;
  var cy = h * 0.5;
  var s = Math.min(plotW, h) * 0.34;

  // Graticule: the two diagonals are the L-only and R-only axes.
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(cx - s, cy + s); ctx.lineTo(cx + s, cy - s); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(cx - s, cy - s); ctx.lineTo(cx + s, cy + s); ctx.stroke();

  var dot = 0, nl = 0, nr = 0, sideSum = 0;
  for (var i = 0; i < n; i++) {
    var l = (L[i] - CENTER) * SCALE;
    var r = (R[i] - CENTER) * SCALE;
    var mid = (l + r) * 0.5;
    var side = (l - r) * 0.5;
    dot += l * r; nl += l * l; nr += r * r;
    sideSum += Math.abs(side);
    // Side on X, mid on Y (inverted so louder is up) - the standard
    // goniometer orientation.
    ctx.fillStyle = accA(accent, 0.22 + Math.min(0.6, Math.abs(side) * 2.4));
    ctx.fillRect(cx + side * s * 2.1, cy - mid * s * 1.5, 1.6, 1.6);
  }

  var denom = Math.sqrt(nl * nr);
  var corr = denom > 1e-9 ? dot / denom : 1;
  var width = Math.min(1, (sideSum / n) * 3);
  corrSmooth += (corr - corrSmooth) * Math.min(1, dt * 6);
  widthSmooth += (width - widthSmooth) * Math.min(1, dt * 6);

  ctx.font = '9px "JetBrains Mono", ui-monospace, monospace';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  ctx.fillText('L', cx - s - 12, cy - s + 4);
  ctx.fillText('R', cx + s + 4, cy - s + 4);

  // Meters.
  var mx = plotW + 12;
  var mw = Math.max(40, meterW - 24);

  ctx.fillStyle = 'rgba(255,255,255,0.4)';
  ctx.fillText('CORR', mx, h * 0.22);
  ctx.fillStyle = 'rgba(255,255,255,0.08)';
  ctx.fillRect(mx, h * 0.25, mw, 5);
  var c01 = (corrSmooth + 1) / 2;
  // Negative correlation means the channels fight each other and the signal
  // partly cancels in mono - worth flagging in red rather than accent.
  ctx.fillStyle = corrSmooth < 0 ? '#fca5a5' : accent;
  ctx.fillRect(mx + c01 * mw - 2, h * 0.25 - 2, 4, 9);
  ctx.fillStyle = 'rgba(255,255,255,0.3)';
  ctx.fillText('-1', mx, h * 0.25 + 18);
  ctx.textAlign = 'right';
  ctx.fillText('+1', mx + mw, h * 0.25 + 18);
  ctx.textAlign = 'left';

  ctx.font = '700 15px "JetBrains Mono", ui-monospace, monospace';
  ctx.fillStyle = '#fff';
  ctx.fillText(corrSmooth.toFixed(2), mx, h * 0.44);

  ctx.font = '9px "JetBrains Mono", ui-monospace, monospace';
  ctx.fillStyle = 'rgba(255,255,255,0.4)';
  ctx.fillText('WIDTH', mx, h * 0.60);
  ctx.fillStyle = 'rgba(255,255,255,0.08)';
  ctx.fillRect(mx, h * 0.63, mw, 5);
  ctx.fillStyle = accA(accent, 0.9);
  ctx.fillRect(mx, h * 0.63, widthSmooth * mw, 5);

  // Say so plainly when the source has no stereo image at all, so a vertical
  // line is not mistaken for a broken visualizer.
  if (widthSmooth < 0.01 && corrSmooth > 0.999) {
    ctx.font = '9px "JetBrains Mono", ui-monospace, monospace';
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.fillText('mono source', mx, h * 0.78);
  }
});

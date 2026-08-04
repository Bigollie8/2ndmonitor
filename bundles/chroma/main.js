// Chroma wheel - the 12 pitch classes as a radial meter, naming the
// strongest. Watch it and you can see chord changes happen.
//
// Chroma fold: the host gives a log-spaced magnitude spectrum, not a
// constant-Q transform, so folding bin i onto pitch class i%12 is an
// APPROXIMATION of pitch content, not true key detection. It tracks chord
// changes and sustained notes well and is wrong on dense percussive
// material. A real constant-Q (ShowCQTBar/Meyda) is the upgrade path; this
// stays honest about being a fold.

var NB = 48;
var NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
var chroma = new Float32Array(12);

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
  var dt = Math.max(0.001, Math.min(0.1, f.dt || 0.016));

  // Fold onto pitch classes, smoothed so the wheel doesn't strobe.
  for (var p = 0; p < 12; p++) {
    var s = 0, n = 0;
    for (var i = p; i < NB; i += 12) { s += bins[i] || 0; n++; }
    var target = n ? s / n : 0;
    chroma[p] += (target - chroma[p]) * Math.min(1, dt * 6);
  }

  ctx.clearRect(0, 0, w, h);

  var cx = w * 0.5, cy = h * 0.5;
  var r1 = Math.min(w, h) * 0.40;
  var r0 = r1 * 0.42;

  var best = 0;
  for (var b = 1; b < 12; b++) if (chroma[b] > chroma[best]) best = b;

  for (var q = 0; q < 12; q++) {
    var a0 = (q / 12) * Math.PI * 2 - Math.PI / 2 + 0.03;
    var a1 = ((q + 1) / 12) * Math.PI * 2 - Math.PI / 2 - 0.03;
    var v = Math.max(0, Math.min(1, chroma[q] * 1.8));
    var rr = r0 + (r1 - r0) * v;
    ctx.beginPath();
    ctx.arc(cx, cy, rr, a0, a1);
    ctx.arc(cx, cy, r0, a1, a0, true);
    ctx.closePath();
    ctx.fillStyle = q === best ? accent : accA(accent, 0.15 + v * 0.35);
    ctx.fill();

    var am = (a0 + a1) / 2;
    ctx.font = Math.max(8, r1 * 0.15) + 'px "JetBrains Mono", ui-monospace, monospace';
    ctx.fillStyle = q === best ? '#fff' : 'rgba(255,255,255,0.40)';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(NOTES[q], cx + Math.cos(am) * (r1 + r1 * 0.16), cy + Math.sin(am) * (r1 + r1 * 0.16));
  }

  // Strongest pitch class in the hub.
  ctx.font = '700 ' + Math.max(14, r0 * 0.85) + 'px "JetBrains Mono", ui-monospace, monospace';
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(NOTES[best], cx, cy);
});

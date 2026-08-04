// Note bars - the chroma fold drawn as three octaves of piano keys, black
// keys dimmed and every C highlighted. Musical cousin of Bars: pitch class
// instead of raw frequency.
//
// Chroma fold: the host gives a log-spaced magnitude spectrum, not a
// constant-Q transform, so folding bin i onto pitch class i%12 is an
// APPROXIMATION of pitch content, not true key detection. It tracks chord
// changes and sustained notes well and is wrong on dense percussive
// material. A real constant-Q (ShowCQTBar/Meyda) is the upgrade path; this
// stays honest about being a fold.

var NB = 48;
var OCTAVES = 3;
var KEYS = OCTAVES * 12;
var BLACK = [1, 3, 6, 8, 10];
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

  for (var p = 0; p < 12; p++) {
    var s = 0, n = 0;
    for (var i = p; i < NB; i += 12) { s += bins[i] || 0; n++; }
    var target = n ? s / n : 0;
    chroma[p] += (target - chroma[p]) * Math.min(1, dt * 7);
  }

  ctx.clearRect(0, 0, w, h);

  var padSide = w * 0.05;
  var padBottom = h * 0.14;
  var plotW = Math.max(0, w - padSide * 2);
  var plotH = Math.max(0, h - h * 0.10 - padBottom);
  var floorY = h - padBottom;
  var bw = plotW / KEYS;

  for (var k = 0; k < KEYS; k++) {
    var pc = k % 12;
    // Octave envelope: the middle octave reads loudest, so three octaves of
    // the same fold don't render as three identical copies.
    var oct = Math.floor(k / 12);
    var env = 1 - Math.abs(oct - (OCTAVES - 1) / 2) / OCTAVES;
    var v = Math.max(0, Math.min(1, chroma[pc] * 1.6 * env));
    var barH = Math.max(2, v * plotH);
    var x = padSide + k * bw;

    var black = BLACK.indexOf(pc) !== -1;
    ctx.fillStyle = pc === 0 ? '#ffffff' : (black ? accA(accent, 0.30 + v * 0.30) : accA(accent, 0.75));
    ctx.fillRect(x + bw * 0.08, floorY - barH, bw * 0.84, barH);
  }

  // Octave labels under every C.
  ctx.font = Math.max(7, h * 0.045) + 'px "JetBrains Mono", ui-monospace, monospace';
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  for (var o = 0; o < OCTAVES; o++) {
    ctx.fillText('C' + (o + 3), padSide + o * 12 * bw, floorY + h * 0.03);
  }
});

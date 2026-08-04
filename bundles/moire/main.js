// Moire - two concentric ring systems drift apart with the bass and
// interfere. Hypnotic and extremely cheap: no history, no allocation, just
// two arc loops per frame.
var NB = 16;
var RINGS = 16;
var t = 0;
var bass = 0;

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
  t += dt;

  // Low-band energy, smoothed - drives both separation and ring spacing.
  var b = ((bins[0] || 0) + (bins[1] || 0) + (bins[2] || 0)) / 3;
  bass += (b - bass) * Math.min(1, dt * 8);

  ctx.clearRect(0, 0, w, h);

  var cy = h * 0.5;
  var sep = Math.min(w * 0.22, w * 0.10 + bass * w * 0.16);
  var cx1 = w * 0.5 + Math.sin(t * 0.7) * sep;
  var cx2 = w * 0.5 - Math.sin(t * 0.7) * sep;
  var spacing = Math.min(w, h) * (0.030 + bass * 0.016);

  ctx.lineWidth = 1;
  for (var r = 1; r <= RINGS; r++) {
    var rad = r * spacing;
    ctx.beginPath();
    ctx.arc(cx1, cy, rad, 0, Math.PI * 2);
    ctx.strokeStyle = accA(accent, 0.32);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx2, cy, rad, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255,255,255,0.17)';
    ctx.stroke();
  }
});

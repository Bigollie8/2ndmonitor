// Silk - one continuous ribbon tracing a bass-driven epicycloid, thickening
// on transients, with a long decay trail. Unlike Ribbon (a full-width band),
// this is a single hand-drawn line.
//
// The trail is a fixed-length ring of points - it never grows, so a tile
// left running for hours costs the same as one just opened.
var NB = 32;
var TRAIL = 90;
var pts = [];
var t = 0;
var kick = 0;

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

  // Onset drives thickness; decay it so the line swells and settles.
  var hit = Math.max(0, Math.min(1, f.onset || 0));
  kick = Math.max(kick - dt * 2.2, hit);

  var lo = (bins[1] || 0);
  var hi = (bins[Math.floor(NB * 0.6)] || 0);
  var base = Math.min(w, h);
  var r1 = base * (0.20 + lo * 0.20);
  var r2 = base * (0.10 + hi * 0.16);
  var a = t * 1.1;

  pts.push({
    x: w * 0.5 + Math.cos(a) * r1 + Math.cos(a * 3.2) * r2,
    y: h * 0.5 + Math.sin(a) * r1 * 0.72 + Math.sin(a * 2.6) * r2 * 0.72,
  });
  if (pts.length > TRAIL) pts.shift();

  // Fade rather than clear - that is the decay.
  ctx.fillStyle = 'rgba(6,7,10,0.16)';
  ctx.fillRect(0, 0, w, h);

  for (var i = 1; i < pts.length; i++) {
    var p0 = pts[i - 1];
    var p1 = pts[i];
    var frac = i / pts.length;
    ctx.beginPath();
    ctx.moveTo(p0.x, p0.y);
    ctx.lineTo(p1.x, p1.y);
    ctx.strokeStyle = i % 5 === 0 ? 'rgba(255,255,255,' + (frac * 0.45) + ')' : accA(accent, frac * 0.85);
    ctx.lineWidth = 1 + frac * 3 + kick * 2;
    ctx.stroke();
  }
});

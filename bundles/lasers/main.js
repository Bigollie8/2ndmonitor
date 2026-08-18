// Lasers - a concert rig: two fans of beams from the bottom corners sweep
// with the mids, beam count rides the spectrum, and kicks slam the fans
// through a fast crossing pass. Haze puddles where beams land.

var sweep = 0;
var slam = 0;

function beam(ctx, x0, y0, ang, len, color, alpha, width) {
  var x1 = x0 + Math.cos(ang) * len, y1 = y0 + Math.sin(ang) * len;
  var grad = ctx.createLinearGradient(x0, y0, x1, y1);
  grad.addColorStop(0, color);
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.strokeStyle = grad;
  ctx.globalAlpha = alpha;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.stroke();
}

viz.on('frame', function (f) {
  var ctx = f.ctx;
  if (!ctx) return;
  var w = f.size.width, h = f.size.height;
  if (w <= 0 || h <= 0) return;
  var dt = f.dt;

  ctx.fillStyle = 'rgba(3,3,8,0.36)';
  ctx.fillRect(0, 0, w, h);

  if (f.onset.kick > 0.55) slam = Math.min(1, slam + f.onset.kick * 0.9);
  slam = Math.max(0, slam - dt * 1.8);
  sweep += dt * (0.5 + f.bands.mid * 2.4 + slam * 5);

  var bins = viz.bins(12);
  var len = Math.hypot(w, h) * 1.1;

  // Left rig (accent) and right rig (accent2), mirrored sweeps.
  for (var side = 0; side < 2; side++) {
    var x0 = side === 0 ? w * 0.04 : w * 0.96;
    var y0 = h * 0.98;
    var color = side === 0 ? f.theme.accent : f.theme.accent2;
    var dir = side === 0 ? 1 : -1;
    var n = 6;
    for (var i = 0; i < n; i++) {
      var e = bins[side * 6 + i];
      if (e < 0.05) continue;
      var base = side === 0 ? -Math.PI * 0.5 - 0.65 : -Math.PI * 0.5 + 0.65;
      var fan = Math.sin(sweep + i * 0.55) * (0.5 + slam * 0.35);
      var ang = base + dir * (i / n) * 1.1 + fan * dir;
      beam(ctx, x0, y0, ang, len, color, 0.16 + e * 0.5, 1 + e * 2.4);
      // Haze puddle where the beam meets the top or side (cheap: a glow dot
      // along the beam at 70% length).
      var hx = x0 + Math.cos(ang) * len * 0.5, hy = y0 + Math.sin(ang) * len * 0.5;
      var g = ctx.createRadialGradient(hx, hy, 0, hx, hy, 34);
      g.addColorStop(0, color);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.globalAlpha = e * 0.10;
      ctx.fillRect(hx - 34, hy - 34, 68, 68);
    }
  }
  ctx.globalAlpha = 1;

  // Stage lip.
  ctx.fillStyle = 'rgba(255,255,255,0.06)';
  ctx.fillRect(0, h * 0.985, w, h * 0.015);
});

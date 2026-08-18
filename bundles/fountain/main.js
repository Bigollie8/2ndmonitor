// Fountain - one water jet per frequency band along the basin. A band's
// energy sets its jet's launch speed, so the spectrum reads as spray
// height; droplets arc under gravity and splash into the basin line.

var drops = [];
var N = 12;

viz.on('frame', function (f) {
  var ctx = f.ctx;
  if (!ctx) return;
  var w = f.size.width, h = f.size.height;
  if (w <= 0 || h <= 0) return;
  var dt = f.dt;
  var basin = h * 0.88;
  var G = h * 1.7;

  ctx.fillStyle = 'rgba(5,8,12,0.30)';
  ctx.fillRect(0, 0, w, h);

  var bins = viz.bins(N);
  for (var j = 0; j < N; j++) {
    var e = bins[j];
    var jx = w * (0.5 + (j - (N - 1) / 2) * 0.062);
    // Nozzle
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    ctx.fillRect(jx - 1.4, basin - 3, 2.8, 3);
    if (e < 0.06) continue;
    var rate = 2 + e * 26;
    for (var s = 0; s < rate * dt * 60; s++) {
      if (Math.random() > 0.5) continue;
      drops.push({
        x: jx, y: basin - 2,
        vx: (Math.random() - 0.5) * w * 0.03,
        vy: -Math.sqrt(2 * G * (e * e) * h * 0.6) * (0.85 + Math.random() * 0.3),
        band: j, life: 1,
      });
    }
  }

  for (var i = drops.length - 1; i >= 0; i--) {
    var d = drops[i];
    d.vy += G * dt;
    d.x += d.vx * dt;
    d.y += d.vy * dt;
    if (d.y >= basin && d.vy > 0) {
      // Splash: short-lived sideways skitter, then gone.
      if (d.life === 1 && Math.abs(d.vy) > h * 0.3) {
        d.life = 0.3;
        d.vy = -Math.abs(d.vy) * 0.18;
        d.vx *= 2.4;
      } else {
        drops.splice(i, 1);
        continue;
      }
    }
    d.life -= dt * 0.3;
    if (d.life <= 0) { drops.splice(i, 1); continue; }
    var up = d.vy < 0;
    ctx.fillStyle = d.band % 2 ? f.theme.accent : f.theme.accent2;
    ctx.globalAlpha = Math.min(1, d.life) * (up ? 0.9 : 0.55);
    ctx.fillRect(d.x, d.y, 1.8, up ? 3.4 : 2);
  }
  ctx.globalAlpha = 1;
  if (drops.length > 900) drops.splice(0, drops.length - 900);

  // Basin water line shimmers with overall level.
  ctx.strokeStyle = 'rgba(255,255,255,' + (0.14 + f.level * 0.2).toFixed(3) + ')';
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(w * 0.08, basin);
  ctx.lineTo(w * 0.92, basin);
  ctx.stroke();
});

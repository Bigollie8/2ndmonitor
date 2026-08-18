// Smoke - three incense columns rising and curling. Mid energy bends the
// columns, bass thickens them, kicks puff a dense knot into each plume.

var wisps = [];
var t = 0;

viz.on('frame', function (f) {
  var ctx = f.ctx;
  if (!ctx) return;
  var w = f.size.width, h = f.size.height;
  if (w <= 0 || h <= 0) return;
  var dt = f.dt;
  t += dt;

  ctx.fillStyle = 'rgba(6,6,9,0.16)';
  ctx.fillRect(0, 0, w, h);

  var sources = [0.28, 0.5, 0.72];
  // Continuous emission plus a kick puff.
  for (var s = 0; s < sources.length; s++) {
    var rate = 1.4 + f.level * 4;
    if (Math.random() < rate * dt) {
      wisps.push({
        x: sources[s] * w, y: h * 0.94, r: 4 + Math.random() * 5 + f.bands.bass * 8,
        vx: 0, life: 1, src: s, seed: Math.random() * 100,
      });
    }
    if (f.onset.kick > 0.6) {
      wisps.push({ x: sources[s] * w, y: h * 0.94, r: 12 + f.onset.kick * 16, vx: 0, life: 1, src: s, seed: Math.random() * 100, hot: true });
    }
  }

  var bend = f.bands.mid;
  for (var i = wisps.length - 1; i >= 0; i--) {
    var p = wisps[i];
    p.life -= dt * 0.24;
    if (p.life <= 0 || p.y < -30) { wisps.splice(i, 1); continue; }
    var age = 1 - p.life;
    // Rise slows with age; curl grows with age and mid energy.
    p.y -= (60 + (1 - age) * 60) * dt;
    p.x += (Math.sin(t * (0.8 + p.seed * 0.01) + p.y * 0.02 + p.src * 2) * (10 + bend * 55) + (p.src - 1) * 6) * dt;
    p.r += dt * (6 + age * 14);

    var g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r);
    var col = p.hot ? f.theme.accent : (p.src === 1 ? f.theme.accent2 : '#c9c4bd');
    g.addColorStop(0, col);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.globalAlpha = p.life * (p.hot ? 0.10 : 0.05);
    ctx.fillRect(p.x - p.r, p.y - p.r, p.r * 2, p.r * 2);
  }
  ctx.globalAlpha = 1;
  if (wisps.length > 260) wisps.splice(0, wisps.length - 260);

  // Incense tips.
  for (var s2 = 0; s2 < sources.length; s2++) {
    ctx.fillStyle = 'rgba(50,40,36,1)';
    ctx.fillRect(sources[s2] * w - 1, h * 0.94, 2, h * 0.05);
    ctx.fillStyle = f.theme.accent;
    ctx.globalAlpha = 0.5 + f.bands.bass * 0.5;
    ctx.beginPath();
    ctx.arc(sources[s2] * w, h * 0.94, 1.8, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }
});

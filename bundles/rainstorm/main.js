// Rainstorm - rain streaks whose density rides the overall level, ground
// ripples where drops land, and a lightning flash on hard kicks with the
// thunder rumble visualised as a brightness tail.

var drops = [];
var ripples = [];
var flash = 0;
var boltPts = null, boltLife = 0;

viz.on('frame', function (f) {
  var ctx = f.ctx;
  if (!ctx) return;
  var w = f.size.width, h = f.size.height;
  if (w <= 0 || h <= 0) return;
  var dt = f.dt;
  var groundY = h * 0.88;

  ctx.fillStyle = 'rgba(7,9,14,0.4)';
  ctx.fillRect(0, 0, w, h);

  // Lightning: a hard kick strikes a fresh bolt; flash decays as thunder.
  if (f.onset.kick > 0.75 && boltLife <= 0) {
    flash = 1;
    boltLife = 0.22;
    boltPts = [];
    var bx = w * (0.2 + Math.random() * 0.6), by = 0;
    while (by < groundY) {
      boltPts.push([bx, by]);
      bx += (Math.random() - 0.5) * w * 0.07;
      by += h * (0.04 + Math.random() * 0.08);
    }
    boltPts.push([bx, groundY]);
  }
  if (flash > 0.01) {
    ctx.fillStyle = 'rgba(180,195,230,' + (flash * 0.16).toFixed(3) + ')';
    ctx.fillRect(0, 0, w, h);
    flash = Math.max(0, flash - dt * 2.2);
  }
  if (boltLife > 0 && boltPts) {
    ctx.strokeStyle = 'rgba(220,230,255,' + Math.min(1, boltLife * 8).toFixed(3) + ')';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    for (var b = 0; b < boltPts.length; b++) {
      if (b === 0) ctx.moveTo(boltPts[b][0], boltPts[b][1]);
      else ctx.lineTo(boltPts[b][0], boltPts[b][1]);
    }
    ctx.stroke();
    boltLife -= dt;
  }

  // Rain: spawn rate follows level; treble adds fine drizzle.
  var spawn = 2 + f.level * 26 + f.bands.treble * 10;
  for (var s = 0; s < spawn * dt * 60; s++) {
    if (Math.random() > 0.8) continue;
    drops.push({ x: Math.random() * (w + 80) - 40, y: -10, v: 460 + Math.random() * 320 + f.level * 260 });
  }
  var slant = w * 0.04 * (0.5 + f.bands.mid);
  ctx.strokeStyle = f.theme.accent2;
  ctx.lineWidth = 1;
  for (var i = drops.length - 1; i >= 0; i--) {
    var d = drops[i];
    d.y += d.v * dt;
    d.x += slant * dt * 3;
    if (d.y >= groundY) {
      ripples.push({ x: d.x, r: 1, life: 1 });
      drops.splice(i, 1);
      continue;
    }
    var len = d.v * 0.028;
    ctx.globalAlpha = 0.32 + (d.v - 460) / 580 * 0.35;
    ctx.beginPath();
    ctx.moveTo(d.x, d.y);
    ctx.lineTo(d.x - slant * 0.09, d.y - len);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  if (drops.length > 600) drops.splice(0, drops.length - 600);

  // Ground: a thin wet line plus expanding elliptical ripples.
  ctx.strokeStyle = 'rgba(255,255,255,0.1)';
  ctx.beginPath();
  ctx.moveTo(0, groundY);
  ctx.lineTo(w, groundY);
  ctx.stroke();
  for (var r = ripples.length - 1; r >= 0; r--) {
    var rp = ripples[r];
    rp.life -= dt * 1.6;
    if (rp.life <= 0) { ripples.splice(r, 1); continue; }
    rp.r += dt * 90;
    ctx.strokeStyle = f.theme.accent;
    ctx.globalAlpha = rp.life * 0.5;
    ctx.beginPath();
    ctx.ellipse(rp.x, groundY, rp.r, rp.r * 0.22, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  if (ripples.length > 120) ripples.splice(0, ripples.length - 120);
});

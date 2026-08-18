// Fireplace - layered flame tongues over glowing logs, embers rising.
// Bass feeds the flame height, kicks throw spark bursts, treble flickers
// the tips. Warm palette independent of the accent theme on purpose: fire
// is orange; the accents tint only the ember glow.

var embers = [];
var flickerSeed = 0;

function warm(t, a) { // t 0..1 from core to tip
  var r = 255, g = Math.round(200 - t * 130), b = Math.round(80 - t * 75);
  return 'rgba(' + r + ',' + Math.max(30, g) + ',' + Math.max(0, b) + ',' + a + ')';
}

viz.on('frame', function (f) {
  var ctx = f.ctx;
  if (!ctx) return;
  var w = f.size.width, h = f.size.height;
  if (w <= 0 || h <= 0) return;
  var dt = f.dt;
  flickerSeed += dt * (3 + f.bands.treble * 14);

  ctx.fillStyle = 'rgba(6,3,2,0.34)';
  ctx.fillRect(0, 0, w, h);

  var baseY = h * 0.86;
  var bass = f.bands.bass;

  // Logs: two dark rounded bars with a bass-breathing under-glow.
  ctx.fillStyle = 'rgba(30,16,10,1)';
  ctx.fillRect(w * 0.28, baseY, w * 0.44, h * 0.045);
  ctx.fillRect(w * 0.34, baseY + h * 0.045, w * 0.32, h * 0.04);
  var glow = ctx.createRadialGradient(w / 2, baseY, 4, w / 2, baseY, w * 0.24);
  glow.addColorStop(0, warm(0, 0.35 + bass * 0.4));
  glow.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, w, h);

  // Flame tongues: 7 columns, each a filled bezier whose height rides its
  // own spectrum slice plus a flicker wobble.
  var bins = viz.bins(7);
  for (var i = 0; i < 7; i++) {
    var cx = w * (0.32 + 0.06 * i);
    var e = bins[i] * 0.7 + bass * 0.5;
    var fl = Math.sin(flickerSeed * (1.1 + i * 0.13) + i * 2.1) * 0.12;
    var tall = Math.max(0.06, e + fl) * h * 0.52;
    var wob = Math.sin(flickerSeed * 1.7 + i) * w * 0.012;
    for (var layer = 0; layer < 3; layer++) {
      var lw = w * (0.030 - layer * 0.008);
      var lh = tall * (1 - layer * 0.26);
      ctx.beginPath();
      ctx.moveTo(cx - lw, baseY);
      ctx.bezierCurveTo(cx - lw, baseY - lh * 0.5, cx + wob - lw * 0.3, baseY - lh * 0.8, cx + wob, baseY - lh);
      ctx.bezierCurveTo(cx + wob + lw * 0.3, baseY - lh * 0.8, cx + lw, baseY - lh * 0.5, cx + lw, baseY);
      ctx.closePath();
      ctx.fillStyle = warm(layer / 3 + 0.15, 0.5 - layer * 0.12);
      ctx.fill();
    }
  }

  // Sparks on kicks; embers rise, wobble, and cool.
  if (f.onset.kick > 0.4) {
    var n = 2 + Math.round(f.onset.kick * 6);
    for (var s = 0; s < n; s++) {
      embers.push({
        x: w * (0.34 + Math.random() * 0.32), y: baseY - Math.random() * 12,
        vy: -(30 + Math.random() * 90) - f.onset.kick * 60,
        vx: (Math.random() - 0.5) * 30, life: 1, r: 1 + Math.random() * 2,
      });
    }
  }
  if (Math.random() < 0.3 + f.level * 0.4) {
    embers.push({ x: w * (0.3 + Math.random() * 0.4), y: baseY, vy: -(20 + Math.random() * 40), vx: (Math.random() - 0.5) * 14, life: 1, r: 0.8 + Math.random() * 1.4 });
  }
  for (var k = embers.length - 1; k >= 0; k--) {
    var em = embers[k];
    em.life -= dt * 0.55;
    if (em.life <= 0 || em.y < -10) { embers.splice(k, 1); continue; }
    em.x += (em.vx + Math.sin(em.y * 0.05 + flickerSeed) * 18) * dt;
    em.y += em.vy * dt;
    ctx.fillStyle = em.life > 0.5 ? warm(0.2, em.life) : f.theme.accent;
    ctx.globalAlpha = Math.min(1, em.life * 1.4);
    ctx.beginPath();
    ctx.arc(em.x, em.y, em.r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  if (embers.length > 220) embers.splice(0, embers.length - 220);
});

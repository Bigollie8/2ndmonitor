// Ink drop - onsets inject blooms of ink that diffuse outward through a
// slowly swirling medium. Kicks drop accent ink, snares drop accent2,
// and the whole bath drifts so old ink marbles instead of just fading.

var blobs = [];
var swirl = 0;

viz.on('frame', function (f) {
  var ctx = f.ctx;
  if (!ctx) return;
  var w = f.size.width, h = f.size.height;
  if (w <= 0 || h <= 0) return;
  var dt = f.dt;
  swirl += dt * (0.2 + f.bands.mid * 0.8);

  // Slow fade = long-lived ink. Deliberately the gentlest fade in the pack.
  ctx.fillStyle = 'rgba(8,8,10,0.045)';
  ctx.fillRect(0, 0, w, h);

  if (f.onset.kick > 0.45) {
    blobs.push({ x: w * (0.25 + Math.random() * 0.5), y: h * (0.25 + Math.random() * 0.5), r: 4, grow: 60 + f.onset.kick * 130, color: f.theme.accent, life: 1 });
  }
  if (f.onset.snare > 0.55) {
    blobs.push({ x: w * Math.random(), y: h * Math.random(), r: 3, grow: 50 + f.onset.snare * 90, color: f.theme.accent2, life: 1 });
  }
  // A quiet trickle so silence still leaves faint marbling.
  if (Math.random() < 0.012 + f.level * 0.03) {
    blobs.push({ x: w * Math.random(), y: h * Math.random(), r: 2, grow: 30, color: 'rgba(255,255,255,0.5)', life: 0.6 });
  }

  for (var i = blobs.length - 1; i >= 0; i--) {
    var b = blobs[i];
    b.life -= dt * 0.5;
    if (b.life <= 0) { blobs.splice(i, 1); continue; }
    b.r += b.grow * dt;
    b.grow *= 1 - dt * 2.2; // diffusion slows as it spreads
    // The medium's swirl carries the blob.
    b.x += Math.sin(swirl + b.y * 0.01) * 18 * dt;
    b.y += Math.cos(swirl * 0.8 + b.x * 0.01) * 14 * dt;

    // An irregular ink edge: several offset arcs rather than one circle.
    ctx.fillStyle = b.color;
    for (var e = 0; e < 5; e++) {
      var ea = (e / 5) * Math.PI * 2 + swirl * 0.6;
      var er = b.r * (0.72 + 0.28 * Math.sin(swirl * 1.7 + e * 2.4 + i));
      ctx.globalAlpha = b.life * 0.032;
      ctx.beginPath();
      ctx.arc(b.x + Math.cos(ea) * b.r * 0.18, b.y + Math.sin(ea) * b.r * 0.18, er, 0, Math.PI * 2);
      ctx.fill();
    }
    // Dense core.
    ctx.globalAlpha = b.life * 0.09;
    ctx.beginPath();
    ctx.arc(b.x, b.y, b.r * 0.35, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  if (blobs.length > 70) blobs.splice(0, blobs.length - 70);
});

// Meteor shower - streaks rain diagonally through a still starfield.
// Treble sets the shower rate, snares spawn bright crossers, and a hard
// kick drops a bolide: a slow, fat fireball with a flare-up at the end.

var stars = null;
var meteors = [];

viz.on('frame', function (f) {
  var ctx = f.ctx;
  if (!ctx) return;
  var w = f.size.width, h = f.size.height;
  if (w <= 0 || h <= 0) return;
  var dt = f.dt;

  ctx.fillStyle = 'rgba(4,5,10,0.32)';
  ctx.fillRect(0, 0, w, h);

  if (!stars) {
    stars = [];
    for (var s = 0; s < 90; s++) stars.push([Math.random(), Math.random(), Math.random()]);
  }
  for (var st = 0; st < stars.length; st++) {
    var tw = 0.25 + 0.45 * Math.abs(Math.sin(performance.now() * 0.0004 * (1 + stars[st][2] * 3) + st));
    ctx.fillStyle = 'rgba(255,255,255,' + (tw * (0.4 + f.bands.treble * 0.5)).toFixed(3) + ')';
    ctx.fillRect(stars[st][0] * w, stars[st][1] * h, 1.4, 1.4);
  }

  // Spawning. Ordinary meteors ride treble; snare = fast bright crosser;
  // kick = bolide.
  if (Math.random() < (0.02 + f.bands.treble * 0.22)) {
    meteors.push({ x: Math.random() * w * 1.2, y: -12, v: 260 + Math.random() * 260, size: 1, life: 1, kind: 0 });
  }
  if (f.onset.snare > 0.6) {
    meteors.push({ x: Math.random() * w, y: -12, v: 620 + Math.random() * 260, size: 1.8, life: 1, kind: 1 });
  }
  if (f.onset.kick > 0.72) {
    meteors.push({ x: w * (0.2 + Math.random() * 0.6), y: -16, v: 150, size: 3.4, life: 1, kind: 2 });
  }

  var ang = Math.PI * 0.62; // down-left slant
  var dx = Math.cos(ang), dy = Math.sin(ang);
  for (var i = meteors.length - 1; i >= 0; i--) {
    var m = meteors[i];
    m.x += dx * m.v * dt;
    m.y += dy * m.v * dt;
    var gone = m.y > h * 0.92 || m.x < -60;
    if (m.kind === 2 && gone && m.life === 1) {
      // Bolide terminal flare: one bright burst ring where it ends.
      m.life = 0.99;
      m.v = 0;
      m.flare = 0.001;
    }
    if (m.flare != null) {
      m.flare += dt * 240;
      ctx.strokeStyle = f.theme.accent;
      ctx.globalAlpha = Math.max(0, 1 - m.flare / 90) * 0.5;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.arc(m.x, Math.min(m.y, h * 0.92), m.flare, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
      if (m.flare > 90) meteors.splice(i, 1);
      continue;
    }
    if (gone) { meteors.splice(i, 1); continue; }
    var len = m.v * 0.09 * m.size;
    var grad = ctx.createLinearGradient(m.x, m.y, m.x - dx * len, m.y - dy * len);
    grad.addColorStop(0, m.kind === 2 ? f.theme.accent : '#fff');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.strokeStyle = grad;
    ctx.lineWidth = m.size;
    ctx.beginPath();
    ctx.moveTo(m.x, m.y);
    ctx.lineTo(m.x - dx * len, m.y - dy * len);
    ctx.stroke();
  }
  if (meteors.length > 90) meteors.splice(0, meteors.length - 90);
});

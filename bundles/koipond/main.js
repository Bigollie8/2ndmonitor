// Koi pond - fish trace lazy noise paths, speeding up with the music's
// level; kicks ring ripples where a fish just turned; lily pads sit in the
// corners. Deliberately the calmest thing in the Scenes shelf.

var fish = null;
var ripples = [];
var t = 0;

function noise(x) { // cheap smooth 1D noise
  return Math.sin(x) * 0.5 + Math.sin(x * 2.17 + 1.3) * 0.3 + Math.sin(x * 4.3 + 2.1) * 0.2;
}

viz.on('frame', function (f) {
  var ctx = f.ctx;
  if (!ctx) return;
  var w = f.size.width, h = f.size.height;
  if (w <= 0 || h <= 0) return;
  var dt = f.dt;
  t += dt;

  ctx.fillStyle = 'rgba(6,12,14,0.30)';
  ctx.fillRect(0, 0, w, h);

  if (!fish) {
    fish = [];
    for (var i = 0; i < 5; i++) {
      fish.push({ seed: i * 17.3 + 3, phase: Math.random() * 100, hue: i % 2, lastTurn: 0 });
    }
  }

  // Lily pads: three still discs with a notch.
  var pads = [[0.12, 0.16, 0.07], [0.86, 0.2, 0.05], [0.8, 0.82, 0.08]];
  for (var p = 0; p < pads.length; p++) {
    ctx.fillStyle = 'rgba(30,60,40,0.85)';
    ctx.beginPath();
    ctx.moveTo(pads[p][0] * w, pads[p][1] * h);
    ctx.arc(pads[p][0] * w, pads[p][1] * h, pads[p][2] * Math.min(w, h) * 2, 0.35, Math.PI * 2 + 0.05);
    ctx.closePath();
    ctx.fill();
  }

  for (var i2 = 0; i2 < fish.length; i2++) {
    var k = fish[i2];
    k.phase += dt * (0.10 + f.level * 0.5);
    var px = (noise(k.phase + k.seed) * 0.5 + 0.5) * w * 0.9 + w * 0.05;
    var py = (noise(k.phase * 1.31 + k.seed * 2.7) * 0.5 + 0.5) * h * 0.9 + h * 0.05;
    var ahead = 0.06;
    var qx = (noise(k.phase + ahead + k.seed) * 0.5 + 0.5) * w * 0.9 + w * 0.05;
    var qy = (noise((k.phase + ahead) * 1.31 + k.seed * 2.7) * 0.5 + 0.5) * h * 0.9 + h * 0.05;
    var ang = Math.atan2(qy - py, qx - px);

    // A kick makes the nearest-in-phase fish flick and ring a ripple.
    if (f.onset.kick > 0.6 && t - k.lastTurn > 1.2 && i2 === Math.floor((t * 7) % fish.length)) {
      k.lastTurn = t;
      ripples.push({ x: px, y: py, r: 6, life: 1 });
    }

    var L = Math.min(w, h) * 0.085;
    var wig = Math.sin(k.phase * 22) * 0.35;
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(ang);
    // Body
    ctx.fillStyle = k.hue ? f.theme.accent : '#e8e4da';
    ctx.beginPath();
    ctx.ellipse(0, 0, L * 0.5, L * 0.2, 0, 0, Math.PI * 2);
    ctx.fill();
    // Patch
    ctx.fillStyle = k.hue ? '#e8e4da' : f.theme.accent2;
    ctx.beginPath();
    ctx.ellipse(-L * 0.12, -L * 0.04, L * 0.16, L * 0.1, 0.4, 0, Math.PI * 2);
    ctx.fill();
    // Tail
    ctx.fillStyle = k.hue ? f.theme.accent : '#e8e4da';
    ctx.globalAlpha = 0.8;
    ctx.beginPath();
    ctx.moveTo(-L * 0.45, 0);
    ctx.quadraticCurveTo(-L * 0.85, wig * L, -L * 0.95, wig * L * 1.6);
    ctx.quadraticCurveTo(-L * 0.75, wig * L * 0.4, -L * 0.45, 0);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  for (var r = ripples.length - 1; r >= 0; r--) {
    var rp = ripples[r];
    rp.life -= dt * 0.8;
    if (rp.life <= 0) { ripples.splice(r, 1); continue; }
    rp.r += dt * 60;
    ctx.strokeStyle = 'rgba(255,255,255,' + (rp.life * 0.3).toFixed(3) + ')';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(rp.x, rp.y, rp.r, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Surface glints riding the treble.
  ctx.fillStyle = 'rgba(255,255,255,' + (0.05 + f.bands.treble * 0.16).toFixed(3) + ')';
  for (var g = 0; g < 10; g++) {
    ctx.fillRect(((g * 251 + t * 17) % w), ((g * 173) % h), 4, 1);
  }
});

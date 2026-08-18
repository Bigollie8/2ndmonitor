// Galaxy - a rotating spiral of stars. Each star belongs to an arm and a
// radius band; mid energy tightens the arm twist, the core flares on
// kicks, and treble makes the outer dust sparkle.

var stars = null;
var rot = 0;
var coreFlash = 0;
var ARMS = 3;

viz.on('frame', function (f) {
  var ctx = f.ctx;
  if (!ctx) return;
  var w = f.size.width, h = f.size.height;
  if (w <= 0 || h <= 0) return;
  var dt = f.dt;

  if (!stars) {
    stars = [];
    for (var s = 0; s < 480; s++) {
      stars.push({
        arm: s % ARMS,
        r: Math.pow(Math.random(), 0.7),           // radius 0..1, denser center
        jitterA: (Math.random() - 0.5) * 0.5,      // angular scatter off the arm
        jitterR: (Math.random() - 0.5) * 0.08,
        size: 0.6 + Math.random() * 1.6,
        tw: Math.random() * Math.PI * 2,
      });
    }
  }

  ctx.fillStyle = 'rgba(3,3,8,0.4)';
  ctx.fillRect(0, 0, w, h);

  rot += dt * (0.12 + f.level * 0.35);
  if (f.onset.kick > 0.5) coreFlash = Math.min(1, coreFlash + f.onset.kick);
  coreFlash = Math.max(0, coreFlash - dt * 2.2);

  var cx = w / 2, cy = h / 2;
  var R = Math.min(w, h) * 0.46;
  var twist = 2.4 + f.bands.mid * 2.2;
  var bins = viz.bins(8);

  for (var i = 0; i < stars.length; i++) {
    var st = stars[i];
    // Differential rotation: inner stars orbit faster, like the real thing.
    var a = st.arm * (Math.PI * 2 / ARMS) + st.r * twist + st.jitterA + rot * (1.6 - st.r);
    var rr = (st.r + st.jitterR) * R;
    var x = cx + Math.cos(a) * rr;
    var y = cy + Math.sin(a) * rr * 0.62; // inclination
    var band = bins[Math.min(7, Math.floor(st.r * 8))];
    var sparkle = st.r > 0.7 ? 0.5 + 0.5 * Math.sin(st.tw + performance.now() * 0.004) * f.bands.treble * 2 : 1;
    ctx.fillStyle = st.r < 0.35 ? '#fff' : (st.arm % 2 ? f.theme.accent : f.theme.accent2);
    ctx.globalAlpha = Math.min(1, (0.25 + band * 0.9) * sparkle);
    ctx.fillRect(x, y, st.size, st.size);
  }
  ctx.globalAlpha = 1;

  // Core: a warm bulge that flares with the kick.
  var coreR = R * (0.1 + coreFlash * 0.05 + f.bands.bass * 0.05);
  var g = ctx.createRadialGradient(cx, cy, 0, cx, cy, coreR * 2.4);
  g.addColorStop(0, 'rgba(255,240,214,' + (0.7 + coreFlash * 0.3).toFixed(3) + ')');
  g.addColorStop(0.35, 'rgba(255,214,170,0.24)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.ellipse(cx, cy, coreR * 2.4, coreR * 1.6, 0, 0, Math.PI * 2);
  ctx.fill();
});

// Double helix - a rotating DNA strand crossing the screen. Each base-pair
// rung is a frequency bin: its length and glow ride that bin's energy.
// Bass stretches the helix pitch; a hard kick briefly unwinds it.

var rot = 0;
var unwind = 0;

viz.on('frame', function (f) {
  var ctx = f.ctx;
  if (!ctx) return;
  var w = f.size.width, h = f.size.height;
  if (w <= 0 || h <= 0) return;
  var dt = f.dt;

  ctx.fillStyle = 'rgba(5,6,11,0.30)';
  ctx.fillRect(0, 0, w, h);

  rot += dt * (0.8 + f.level * 2.2);
  if (f.onset.kick > 0.65) unwind = Math.min(1, unwind + f.onset.kick * 0.8);
  unwind = Math.max(0, unwind - dt * 1.4);

  var N = 26;
  var bins = viz.bins(N);
  var midY = h / 2;
  var amp = h * 0.26;
  var pitch = (2.2 - f.bands.bass * 0.7) * (1 + unwind * 2.2);

  // Backbones drawn as two phased sine curves; rungs connect them.
  var pts1 = [], pts2 = [];
  for (var i = 0; i <= N; i++) {
    var q = i / N;
    var a = q * Math.PI * pitch + rot;
    var x = w * (0.06 + q * 0.88);
    pts1.push([x, midY + Math.sin(a) * amp, Math.cos(a)]);
    pts2.push([x, midY + Math.sin(a + Math.PI) * amp, Math.cos(a + Math.PI)]);
  }

  // Rungs first (under the backbones).
  for (var r = 0; r < N; r++) {
    var e = bins[r];
    var p1 = pts1[r], p2 = pts2[r];
    // Rung shortens as the strands cross (they're at the same y near
    // crossings) - that's geometry, not a special case.
    ctx.strokeStyle = r % 2 ? f.theme.accent : f.theme.accent2;
    ctx.globalAlpha = 0.2 + e * 0.75;
    ctx.lineWidth = 1.2 + e * 3;
    ctx.beginPath();
    ctx.moveTo(p1[0], p1[1]);
    ctx.lineTo(p2[0], p2[1]);
    ctx.stroke();
  }

  // Backbones: depth-shaded (front half brighter).
  for (var s = 0; s < 2; s++) {
    var pts = s === 0 ? pts1 : pts2;
    for (var seg = 0; seg < N; seg++) {
      var front = (pts[seg][2] + 1) / 2;
      ctx.strokeStyle = s === 0 ? f.theme.accent : f.theme.accent2;
      ctx.globalAlpha = 0.25 + front * 0.65;
      ctx.lineWidth = 1.4 + front * 1.8;
      ctx.beginPath();
      ctx.moveTo(pts[seg][0], pts[seg][1]);
      ctx.lineTo(pts[seg + 1][0], pts[seg + 1][1]);
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;
});

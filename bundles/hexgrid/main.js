// Hex grid - a honeycomb lit from the center outward. Ring number maps to
// frequency (bass at the core, treble at the rim), so a drop blooms from
// the middle of the comb. Kicks send a travelling ring wave outward.

var cells = null;
var wave = -1;

viz.on('frame', function (f) {
  var ctx = f.ctx;
  if (!ctx) return;
  var w = f.size.width, h = f.size.height;
  if (w <= 0 || h <= 0) return;
  var dt = f.dt;

  var R = Math.min(w, h) / 16;
  if (!cells || cells.w !== w || cells.h !== h) {
    cells = { w: w, h: h, list: [] };
    var cx = w / 2, cy = h / 2;
    // Axial hex coordinates out to the ring that covers the canvas.
    var maxRing = Math.ceil(Math.max(w, h) / (R * 1.5)) + 1;
    for (var q = -maxRing; q <= maxRing; q++) {
      for (var r = -maxRing; r <= maxRing; r++) {
        var s = -q - r;
        var ring = Math.max(Math.abs(q), Math.abs(r), Math.abs(s));
        if (ring > maxRing) continue;
        var x = cx + R * 1.5 * q;
        var y = cy + R * Math.sqrt(3) * (r + q / 2);
        if (x < -R || x > w + R || y < -R || y > h + R) continue;
        cells.list.push({ x: x, y: y, ring: ring });
      }
    }
    cells.maxRing = maxRing;
  }

  ctx.fillStyle = 'rgba(5,6,9,0.4)';
  ctx.fillRect(0, 0, w, h);

  if (f.onset.kick > 0.55 && wave < 0) wave = 0;
  if (wave >= 0) {
    wave += dt * 9;
    if (wave > cells.maxRing + 3) wave = -1;
  }

  var bins = viz.bins(cells.maxRing + 1);
  for (var i = 0; i < cells.list.length; i++) {
    var c = cells.list[i];
    var e = bins[Math.min(bins.length - 1, c.ring)];
    var lit = e;
    if (wave >= 0) {
      var d = Math.abs(c.ring - wave);
      lit += Math.max(0, 1 - d) * 0.8;
    }
    if (lit < 0.04) continue;
    var rr = R * 0.86 * (0.55 + Math.min(1, lit) * 0.45);
    ctx.beginPath();
    for (var v = 0; v < 6; v++) {
      var a = v / 6 * Math.PI * 2;
      var px = c.x + Math.cos(a) * rr, py = c.y + Math.sin(a) * rr;
      if (v === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath();
    var col = c.ring % 2 ? f.theme.accent : f.theme.accent2;
    ctx.fillStyle = col;
    ctx.globalAlpha = Math.min(1, lit) * 0.4;
    ctx.fill();
    ctx.strokeStyle = col;
    ctx.globalAlpha = Math.min(1, 0.25 + lit * 0.75);
    ctx.lineWidth = 1.2;
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
});

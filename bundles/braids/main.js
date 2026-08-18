// Braids - five waveform strands weave around a shared axis. Each strand
// reads the same waveform at a different phase offset and braids around
// its neighbours; energy tightens the braid and thickens the strands.

var t = 0;

viz.on('frame', function (f) {
  var ctx = f.ctx;
  if (!ctx) return;
  var w = f.size.width, h = f.size.height;
  if (w <= 0 || h <= 0) return;
  t += f.dt * (0.6 + f.level * 1.8);

  ctx.fillStyle = 'rgba(5,6,10,0.24)';
  ctx.fillRect(0, 0, w, h);

  var wf = f.waveform;
  var midY = h / 2;
  var strands = 5;
  var tight = 1.4 + f.bands.mid * 3.2;

  // Draw back strands first: sort by current depth per column is overkill -
  // instead draw in two passes by phase so crossings read as over/under.
  for (var pass = 0; pass < 2; pass++) {
    for (var s = 0; s < strands; s++) {
      var phase = (s / strands) * Math.PI * 2;
      // Depth at mid-screen decides which pass this strand belongs to.
      var midDepth = Math.sin(0.5 * tight * Math.PI * 2 + t + phase);
      if ((pass === 0) !== (midDepth < 0)) continue;

      ctx.beginPath();
      var pts = 90;
      for (var p = 0; p <= pts; p++) {
        var q = p / pts;
        var braid = Math.sin(q * tight * Math.PI * 2 + t + phase);
        var depth = Math.cos(q * tight * Math.PI * 2 + t + phase);
        var wob = wf && wf.length ? (wf[Math.floor(q * (wf.length - 1))] - 128) / 128 : 0;
        var y = midY + braid * h * 0.13 + wob * h * 0.16;
        var x = q * w;
        if (p === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      var colors = [f.theme.accent, f.theme.accent2, '#e8e4da', f.theme.accent, f.theme.accent2];
      ctx.strokeStyle = colors[s];
      ctx.globalAlpha = pass === 0 ? 0.38 : 0.9;
      ctx.lineWidth = (pass === 0 ? 1.6 : 2.6) + f.level * 2.2;
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;
});

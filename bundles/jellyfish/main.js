// Jellyfish - a bell that contracts on the beat and drifts upward on its
// own thrust, tentacles trailing the waveform. Mid energy sets the pulse
// depth; the deep background breathes with the bass.

var phase = 0;
var drift = 0.5; // 0..1 vertical position (1 = bottom)
var thrust = 0;

viz.on('frame', function (f) {
  var ctx = f.ctx;
  if (!ctx) return;
  var w = f.size.width, h = f.size.height;
  if (w <= 0 || h <= 0) return;
  var dt = f.dt;

  // Deep water: vertical gradient breathing with bass.
  var bg = ctx.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0, 'rgba(4,10,18,0.5)');
  bg.addColorStop(1, 'rgba(2,4,10,0.5)');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);

  // The bell contracts on kicks (thrust) and relaxes; the body drifts up
  // with thrust and sinks slowly without it.
  if (f.onset.kick > 0.4) thrust = Math.min(1, thrust + f.onset.kick * 0.8);
  thrust = Math.max(0, thrust - dt * 1.1);
  phase += dt * (0.9 + f.bands.mid * 2.2 + thrust * 2);
  drift += (thrust > 0.15 ? -0.05 : 0.025) * dt;
  drift = Math.max(0.22, Math.min(0.6, drift));

  var cx = w * 0.5 + Math.sin(phase * 0.23) * w * 0.1;
  var cy = h * drift;
  var pulse = Math.sin(phase) * 0.5 + 0.5;
  var bellW = Math.min(w, h) * (0.17 + pulse * 0.035 + f.bands.mid * 0.05);
  var bellH = bellW * (0.72 - pulse * 0.16);

  // Tentacles first (under the bell): 9 strands tracing the waveform.
  var wf = f.waveform;
  ctx.lineWidth = 1.4;
  for (var t = 0; t < 9; t++) {
    var tx = cx + (t - 4) * bellW * 0.2;
    var lenPts = 26;
    ctx.strokeStyle = t % 2 ? f.theme.accent : f.theme.accent2;
    ctx.globalAlpha = 0.4;
    ctx.beginPath();
    ctx.moveTo(tx, cy + bellH * 0.3);
    for (var p = 1; p <= lenPts; p++) {
      var q = p / lenPts;
      var wob = wf && wf.length ? (wf[(t * 97 + p * 31) % wf.length] - 128) / 128 : Math.sin(phase + p);
      ctx.lineTo(
        tx + wob * bellW * 0.45 * q + Math.sin(phase * 1.4 + t + q * 5) * bellW * 0.16 * q,
        cy + bellH * 0.3 + q * h * (0.3 + thrust * 0.06),
      );
    }
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  // Bell: layered translucent domes with a rim glow.
  for (var l = 0; l < 3; l++) {
    var s = 1 - l * 0.22;
    ctx.beginPath();
    ctx.ellipse(cx, cy, bellW * s, bellH * s, 0, Math.PI, 0);
    ctx.closePath();
    ctx.fillStyle = l === 0 ? f.theme.accent : f.theme.accent2;
    ctx.globalAlpha = 0.13 + l * 0.09;
    ctx.fill();
  }
  ctx.globalAlpha = 0.8;
  ctx.strokeStyle = f.theme.accent;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.ellipse(cx, cy, bellW, bellH, 0, Math.PI, 0);
  ctx.stroke();
  ctx.globalAlpha = 1;

  // Plankton motes rising past it, treble-bright.
  ctx.fillStyle = 'rgba(255,255,255,' + (0.15 + f.bands.treble * 0.3).toFixed(3) + ')';
  for (var m = 0; m < 14; m++) {
    var my = (h + 40) * (1 - (((phase * 14 + m * 61) % 100) / 100)) - 20;
    ctx.fillRect((m * 137 % w), my, 1.6, 1.6);
  }
});

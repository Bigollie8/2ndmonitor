// Pulse - an ECG-style sweep. The trace runs left to right at constant
// paper speed like a real monitor; kicks write the QRS spike, snares the
// T-wave, and between beats the baseline carries the actual waveform at
// low gain. The sweep bar erases ahead of itself the way monitors do.

var x = 0;
var lastY = null;
var qrs = 0, twave = 0;
var history = null;

viz.on('frame', function (f) {
  var ctx = f.ctx;
  if (!ctx) return;
  var w = f.size.width, h = f.size.height;
  if (w <= 0 || h <= 0) return;
  var dt = f.dt;
  var midY = h * 0.52;

  if (!history || history.length !== Math.ceil(w)) {
    history = new Float32Array(Math.ceil(w)).fill(midY);
    ctx.fillStyle = 'rgba(4,7,6,1)';
    ctx.fillRect(0, 0, w, h);
  }

  // Grid (drawn faint every frame so the erase bar doesn't eat it).
  ctx.fillStyle = 'rgba(4,7,6,0.18)';
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = 'rgba(120,200,150,0.07)';
  ctx.lineWidth = 1;
  var grid = Math.max(18, h / 12);
  for (var gx = 0; gx < w; gx += grid) { ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, h); ctx.stroke(); }
  for (var gy = 0; gy < h; gy += grid) { ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(w, gy); ctx.stroke(); }

  // Excitations.
  if (f.onset.kick > 0.5) qrs = Math.max(qrs, f.onset.kick);
  if (f.onset.snare > 0.5) twave = Math.max(twave, f.onset.snare * 0.7);

  var speed = w * 0.28; // constant paper speed
  var steps = Math.max(1, Math.round(speed * dt));
  var wf = f.waveform;
  for (var s = 0; s < steps; s++) {
    var y = midY;
    // Baseline: real waveform at low gain.
    if (wf && wf.length) y += ((wf[(x * 3) % wf.length] - 128) / 128) * h * 0.05;
    // QRS: sharp down-up-down over ~14 px.
    if (qrs > 0.02) {
      var ph = (1 - qrs) * 16;
      var spike = ph < 3 ? -0.3 : ph < 7 ? 1 : ph < 10 ? -0.45 : 0;
      y -= spike * h * 0.3 * Math.min(1, qrs * 1.6);
      qrs -= 0.065;
    } else if (twave > 0.02) {
      y -= Math.sin((1 - twave / 0.7) * Math.PI) * h * 0.09 * twave;
      twave -= 0.02;
    }
    history[x] = y;
    x = (x + 1) % history.length;
  }

  // Erase bar ahead of the pen.
  var gapW = w * 0.06;
  ctx.fillStyle = 'rgba(4,7,6,0.92)';
  ctx.fillRect(x, 0, gapW, h);
  if (x + gapW > w) ctx.fillRect(0, 0, (x + gapW) - w, h);

  // Trace.
  ctx.strokeStyle = f.theme.accent;
  ctx.lineWidth = 2;
  ctx.beginPath();
  var started = false;
  for (var px = 0; px < history.length; px++) {
    // Skip the erased gap so the line doesn't bridge it.
    var inGap = (px - x + history.length) % history.length < gapW;
    if (inGap) { started = false; continue; }
    if (!started) { ctx.moveTo(px, history[px]); started = true; }
    else ctx.lineTo(px, history[px]);
  }
  ctx.stroke();

  // Pen head glow.
  var headX = (x - 1 + history.length) % history.length;
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.arc(headX, history[headX], 2.4, 0, Math.PI * 2);
  ctx.fill();

  // Level readout, monitor-corner style.
  ctx.font = '10px "JetBrains Mono", ui-monospace, monospace';
  ctx.fillStyle = f.theme.accent;
  ctx.textAlign = 'right';
  ctx.fillText('LVL ' + Math.round(f.level * 100), w - 10, 16);
});

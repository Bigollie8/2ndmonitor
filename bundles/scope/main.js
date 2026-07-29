// Oscilloscope — CRT phosphor scope, trace driven by audio.
// Migrated from the built-in style of the same name.
//
// Note: the original creates its spectrum reader with makeSpectrumReader(128,
// ...) and the trace reads reader.out[specIdx] for specIdx up to 127. The
// task table listed no bins K for this style ("—"), but it clearly indexes
// the full reader — bins K is 128.
//
// The task table's "phosphor trail buffer" state doesn't need any JS state
// to hoist: the low-alpha fillRect painted over the SAME persistent canvas
// every frame is what produces the CRT fade, exactly as it did in the
// original where the canvas element persisted across rAF ticks. The host
// owns that same persistence here, so no extra buffer is needed — only the
// free-running clock `t`.
//
// The original destructures only `accent` (no accent2) — this style never
// uses a second color.

let t = 0;

viz.on('frame', (f) => {
  const ctx = f.ctx;
  if (!ctx) return;
  const w = f.size.width;
  const h = f.size.height;
  if (w <= 0 || h <= 0) return;
  const accent = f.theme.accent;
  const bins = viz.bins(128);

  t += 0.06;
  ctx.fillStyle = 'rgba(2, 8, 4, 0.18)';
  ctx.fillRect(0, 0, w, h);
  // Grid
  ctx.strokeStyle = 'rgba(120, 220, 140, 0.06)';
  ctx.lineWidth = 1;
  for (let x = 0; x < w; x += w / 20) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
  }
  for (let y = 0; y < h; y += h / 10) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
  }
  // Trace — y combines spectrum-driven amplitude with a slow-moving carrier
  // so it still feels CRT-scope-y rather than just a bar chart.
  const overall = (f.bands.bass + f.bands.mid + f.bands.treble) / 3;
  const amp = h * (0.18 + overall * 0.28);
  ctx.strokeStyle = accent;
  ctx.shadowBlur = 12;
  ctx.shadowColor = accent;
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let x = 0; x < w; x += 2) {
    const u = x / w;
    const specIdx = Math.min(127, Math.floor(u * 128));
    const sp = (bins[specIdx] ?? 0) - 0.5;
    const y = h / 2
      + sp * amp * 1.4
      + Math.sin(u * Math.PI * 8 + t) * h * 0.05
      + Math.sin(u * Math.PI * 24 + t * 2.3) * h * 0.025;
    if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.stroke();
  ctx.shadowBlur = 0;
});

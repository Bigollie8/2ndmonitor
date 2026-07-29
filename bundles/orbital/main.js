// Orbital — stacked rotating rings with frequency markers + comet.
// Migrated from the built-in style of the same name.
//
// Note: the original creates a 64-bin spectrum reader and indexes it with
// `(i * (r + 1)) % 64` (the ring marker count N=32 is unrelated — it's just
// how many markers are drawn per ring, not the reader size). So bins K here
// is 64, not the 32 markers-per-ring the task table suggested.
function hex2(n) {
  return Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
}

let t = 0;

viz.on('frame', (f) => {
  const ctx = f.ctx;
  if (!ctx) return;
  const w = f.size.width;
  const h = f.size.height;
  if (w <= 0 || h <= 0) return;
  const cx = w / 2;
  const cy = h / 2;
  const bass = f.bands.bass;
  const kick = f.onset.kick;
  const accent = f.theme.accent;
  const accent2 = f.theme.accent2;
  const bins = viz.bins(64);

  t += 0.04;
  const baseR = Math.min(w, h) * 0.18;
  ctx.fillStyle = 'rgba(6,7,10,0.18)';
  ctx.fillRect(0, 0, w, h);

  // Center sun
  const sunR = baseR * 0.5 * (1 + bass * 0.4 + kick * 0.3);
  const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, sunR);
  grad.addColorStop(0, accent + 'ff');
  grad.addColorStop(0.5, accent + '88');
  grad.addColorStop(1, accent + '00');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(cx, cy, sunR, 0, Math.PI * 2);
  ctx.fill();

  // 4 rings, each with frequency markers
  const RINGS = 4;
  for (let r = 0; r < RINGS; r++) {
    const radius = baseR * (1.4 + r * 0.55);
    const speed = (r % 2 === 0 ? 1 : -1) * (0.2 + r * 0.1);
    const N = 32;
    // Ring outline
    ctx.strokeStyle = accent2 + '22';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.stroke();
    // Markers
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2 + t * speed;
      const v = bins[(i * (r + 1)) % 64] ?? 0;
      const len = 4 + v * 28 * (1 + r * 0.2);
      const x1 = cx + Math.cos(a) * radius;
      const y1 = cy + Math.sin(a) * radius;
      const x2 = cx + Math.cos(a) * (radius + len);
      const y2 = cy + Math.sin(a) * (radius + len);
      const c = r % 2 === 0 ? accent : accent2;
      ctx.strokeStyle = c + hex2(v * 230);
      ctx.lineWidth = 1.5 + v * 2;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    }
    // Comet on this ring
    const cometA = t * speed * 1.5;
    const cx_ = cx + Math.cos(cometA) * radius;
    const cy_ = cy + Math.sin(cometA) * radius;
    const cR = 4 + bass * 4;
    ctx.fillStyle = accent2;
    ctx.shadowColor = accent2;
    ctx.shadowBlur = 16;
    ctx.beginPath();
    ctx.arc(cx_, cy_, cR, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
  }
});

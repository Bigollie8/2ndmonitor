// Liquid — fluid metaballs / lava lamp, bass merges blobs.
// Migrated from the built-in style of the same name.
//
// Note: the original creates a 64-bin spectrum reader but never reads
// reader.out[] anywhere in this style — only reader.bands.bass/mid. So this
// bundle never calls viz.bins() either; it would be dead weight.
function hex2(n) {
  return Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
}

const blobs = Array.from({ length: 7 }, () => ({
  x: Math.random(), y: Math.random(),
  vx: (Math.random() - 0.5) * 0.001,
  vy: (Math.random() - 0.5) * 0.001,
  r: 60 + Math.random() * 80,
}));

let t = 0;

viz.on('frame', (f) => {
  const ctx = f.ctx;
  if (!ctx) return;
  const w = f.size.width;
  const h = f.size.height;
  if (w <= 0 || h <= 0) return;
  const bass = f.bands.bass;
  const mid = f.bands.mid;
  const accent = f.theme.accent;
  const accent2 = f.theme.accent2;

  t += 0.04;
  // Background
  const bgGrad = ctx.createLinearGradient(0, 0, 0, h);
  bgGrad.addColorStop(0, '#020308');
  bgGrad.addColorStop(1, '#080a14');
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, w, h);

  // Update blobs
  for (const b of blobs) {
    b.x += b.vx + Math.sin(t * 0.3 + b.r) * 0.0008;
    b.y += b.vy + Math.cos(t * 0.4 + b.r) * 0.0008;
    if (b.x < 0 || b.x > 1) b.vx *= -1;
    if (b.y < 0 || b.y > 1) b.vy *= -1;
  }

  // Render with cumulative gradients (fake metaballs)
  ctx.globalCompositeOperation = 'screen';
  for (const b of blobs) {
    const r = b.r * (1 + bass * 0.6);
    const px = b.x * w, py = b.y * h;
    const grad = ctx.createRadialGradient(px, py, 0, px, py, r);
    const col = b.r > 100 ? accent : accent2;
    grad.addColorStop(0, col + 'cc');
    grad.addColorStop(0.5, col + '55');
    grad.addColorStop(1, col + '00');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(px, py, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalCompositeOperation = 'source-over';

  // Highlight ripples
  ctx.globalCompositeOperation = 'screen';
  for (let i = 0; i < 3; i++) {
    const ripT = (t + i * 1.5) % 3;
    const ripR = ripT * Math.min(w, h) * 0.5;
    const a = (1 - ripT / 3) * mid * 0.5;
    ctx.strokeStyle = accent + hex2(a * 255);
    ctx.lineWidth = 1 + a * 3;
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, ripR, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.globalCompositeOperation = 'source-over';
});

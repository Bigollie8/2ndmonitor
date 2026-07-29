// Starfield — bass-warped 3D starfield with a kick-pulse depth flash.
// Migrated from the built-in style of the same name.
const N = 220;
const stars = [];
for (let i = 0; i < N; i++) {
  stars.push({
    x: (Math.random() - 0.5) * 2,
    y: (Math.random() - 0.5) * 2,
    z: Math.random() * 1 + 0.001,
    hue: Math.random(),
  });
}

function hex2(n) {
  return Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
}

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

  // Trail
  ctx.fillStyle = `rgba(6,7,10,${0.18 + kick * 0.2})`;
  ctx.fillRect(0, 0, w, h);

  // Kick flash
  if (kick > 0.5) {
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, w / 2);
    grad.addColorStop(0, `${accent}${hex2(kick * 100)}`);
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
  }

  const speed = 0.005 + bass * 0.04;
  for (const s of stars) {
    s.z -= speed;
    if (s.z <= 0) {
      s.x = (Math.random() - 0.5) * 2;
      s.y = (Math.random() - 0.5) * 2;
      s.z = 1;
    }
    const px = (s.x / s.z) * (w / 2) + cx;
    const py = (s.y / s.z) * (h / 2) + cy;
    const size = (1 - s.z) * 3;
    const alpha = (1 - s.z) * 0.9;
    const c = s.hue > 0.5 ? accent : accent2;
    ctx.fillStyle = c + hex2(alpha * 255);
    ctx.fillRect(px - size / 2, py - size / 2, size, size);
    if (s.z < 0.4) {
      ctx.strokeStyle = c + hex2(alpha * 80);
      ctx.lineWidth = size * 0.6;
      const tx = (s.x / (s.z + speed * 4)) * (w / 2) + cx;
      const ty = (s.y / (s.z + speed * 4)) * (h / 2) + cy;
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(tx, ty);
      ctx.stroke();
    }
  }
});

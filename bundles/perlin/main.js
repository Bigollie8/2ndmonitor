// Perlin flow — flow field of glowing particles steered by bass.
// Migrated from the built-in style of the same name.
//
// Note: the original creates a 64-bin spectrum reader but never reads
// reader.out[] anywhere in this style — only reader.bands.bass. So this
// bundle never calls viz.bins() either; it would be dead weight.
function hex2(n) {
  return Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
}

// pseudo perlin
const noise = (x, y, t) =>
  Math.sin(x * 0.6 + Math.cos(y * 0.5 + t * 0.4)) * Math.cos(y * 0.7 + Math.sin(x * 0.4 + t * 0.3));

const N = 140;
const parts = [];
for (let i = 0; i < N; i++) {
  parts.push({
    x: Math.random(), y: Math.random(),
    age: Math.random() * 100,
    hue: Math.random(),
  });
}

let t = 0;

viz.on('frame', (f) => {
  const ctx = f.ctx;
  if (!ctx) return;
  const w = f.size.width;
  const h = f.size.height;
  if (w <= 0 || h <= 0) return;
  const bass = f.bands.bass;
  const accent = f.theme.accent;
  const accent2 = f.theme.accent2;

  t += 0.04;
  ctx.fillStyle = 'rgba(6,7,10,0.06)';
  ctx.fillRect(0, 0, w, h);
  ctx.globalCompositeOperation = 'lighter';
  for (const p of parts) {
    const angle = noise(p.x * 5, p.y * 5, t) * Math.PI * 2;
    const speed = 0.003 + bass * 0.012;
    p.x += Math.cos(angle) * speed;
    p.y += Math.sin(angle) * speed;
    p.age += 1;
    if (p.x < 0 || p.x > 1 || p.y < 0 || p.y > 1 || p.age > 200) {
      p.x = Math.random();
      p.y = Math.random();
      p.age = 0;
      p.hue = Math.random();
    }
    const c = p.hue > 0.5 ? accent : accent2;
    const a = Math.min(1, (1 - Math.abs(p.age - 100) / 100));
    ctx.fillStyle = c + hex2(a * 200);
    const size = 2 + bass * 4;
    ctx.beginPath();
    ctx.arc(p.x * w, p.y * h, size, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalCompositeOperation = 'source-over';
});

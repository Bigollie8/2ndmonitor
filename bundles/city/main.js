// Neon city — skyline silhouette w/ neon windows lighting on freq.
// Migrated from the built-in style of the same name.
//
// Note: the original spectrum reader is created with makeSpectrumReader(24,
// ...) and buildings are assigned freqIdx = i % 24, so bins K is 24 — not
// the 32 the task table suggested.
function hex2(n) {
  return Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
}

// Buildings depend on both canvas dimensions (bh derives from h), which
// aren't known until the first frame. Regenerate whenever either changes
// — mirrors the original's ResizeObserver, which fires on width OR height
// changes, not just width.
let buildings = [];
let lastGenW = -1;
let lastGenH = -1;

function genBuildings(w, h) {
  const list = [];
  let x = 0;
  let i = 0;
  while (x < w + 40) {
    const bw = 32 + Math.random() * 60;
    const bh = h * (0.25 + Math.random() * 0.55);
    list.push({ x, w: bw, h: bh, freqIdx: i % 24, depth: Math.random() < 0.3 ? 1 : 0 });
    x += bw + 4;
    i++;
  }
  return list;
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
  const bins = viz.bins(24);

  if (w !== lastGenW || h !== lastGenH) {
    buildings = genBuildings(w, h);
    lastGenW = w;
    lastGenH = h;
  }

  t += 0.04;
  // Sky
  const sky = ctx.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, '#0a0612');
  sky.addColorStop(0.5, '#1a0822');
  sky.addColorStop(1, accent + '22');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h);

  // Moon
  const moonX = w * 0.78, moonY = h * 0.22;
  const moonR = 28 + bass * 8;
  const grad = ctx.createRadialGradient(moonX, moonY, 0, moonX, moonY, moonR * 2.5);
  grad.addColorStop(0, accent2 + 'ff');
  grad.addColorStop(0.4, accent2 + '40');
  grad.addColorStop(1, accent2 + '00');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(moonX, moonY, moonR * 2.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = accent2;
  ctx.beginPath();
  ctx.arc(moonX, moonY, moonR, 0, Math.PI * 2);
  ctx.fill();

  // Background buildings
  ctx.fillStyle = '#000';
  for (const b of buildings) {
    if (b.depth === 1) {
      ctx.fillRect(b.x, h - b.h * 0.7, b.w, b.h * 0.7);
    }
  }
  // Foreground buildings
  for (const b of buildings) {
    if (b.depth === 0) {
      const v = bins[b.freqIdx] || 0;
      const liftY = h - b.h - v * 12;
      // Building body
      ctx.fillStyle = '#000';
      ctx.fillRect(b.x, liftY, b.w, h - liftY);
      // Edge glow
      ctx.fillStyle = accent + hex2(v * 200);
      ctx.fillRect(b.x, liftY - 1, b.w, 2);
      // Windows lit by freq
      const cols = Math.max(2, Math.floor(b.w / 10));
      const rows = Math.max(3, Math.floor(b.h / 14));
      for (let cx = 0; cx < cols; cx++) {
        for (let cy = 0; cy < rows; cy++) {
          const seed = (b.x + cx * 13 + cy * 7) | 0;
          const onChance = Math.sin(seed) * 0.5 + 0.5;
          const litByMusic = v > onChance * 0.6;
          if (litByMusic || onChance > 0.85) {
            const wx = b.x + 4 + cx * (b.w - 8) / cols;
            const wy = liftY + 6 + cy * (b.h - 12) / rows;
            ctx.fillStyle = litByMusic
              ? accent + 'ff'
              : `rgba(255,220,160,${0.4 + Math.sin(t + seed) * 0.2})`;
            ctx.fillRect(wx, wy, 3, 4);
          }
        }
      }
    }
  }
  // Ground reflection haze
  const hgrad = ctx.createLinearGradient(0, h * 0.85, 0, h);
  hgrad.addColorStop(0, accent + '00');
  hgrad.addColorStop(1, accent + '33');
  ctx.fillStyle = hgrad;
  ctx.fillRect(0, h * 0.85, w, h * 0.15);
});

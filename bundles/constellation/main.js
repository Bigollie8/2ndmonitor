// Constellation — particles draw lines when near, bass = magnetism.
// Migrated from the built-in style of the same name.
//
// Note: the original creates a 64-bin spectrum reader but never reads
// reader.out[] anywhere in this style — only reader.bands.bass/mid and
// reader.onset.kick/snare. So this bundle never calls viz.bins() either; it
// would be dead weight.
function hex2(n) {
  return Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
}

// Each particle has its own home + drift, so the cloud stays alive even
// in silence. Spring force keeps them near home, kicks displace them.
const parts = Array.from({ length: 70 }, () => {
  const x = Math.random();
  const y = Math.random();
  return {
    x, y,
    homeX: x, homeY: y,
    // Slow autonomous drift of the home position — bounces off a small
    // inner margin so homes never reach the corners.
    vhomeX: (Math.random() - 0.5) * 0.0014,
    vhomeY: (Math.random() - 0.5) * 0.0014,
    vx: (Math.random() - 0.5) * 0.004,
    vy: (Math.random() - 0.5) * 0.004,
    r: 1 + Math.random() * 2,
  };
});

let t = 0;

viz.on('frame', (f) => {
  const ctx = f.ctx;
  if (!ctx) return;
  const w = f.size.width;
  const h = f.size.height;
  if (w <= 0 || h <= 0) return;
  const bass = f.bands.bass;
  const mid = f.bands.mid;
  const kick = f.onset.kick;
  const snare = f.onset.snare;
  const accent = f.theme.accent;
  const accent2 = f.theme.accent2;

  t += 0.04;
  ctx.fillStyle = '#020308';
  ctx.fillRect(0, 0, w, h);

  // Outward shockwave on kicks — falls off with distance from center,
  // so inner particles get knocked harder than edge ones. This is the
  // *only* center-related force; there's no constant attraction, which
  // means the cloud never collapses inward.
  const kickStrength = kick * 0.012;
  const springK = 0.012;  // gentle pull-back-to-home
  const drag = 0.94;

  for (const p of parts) {
    // Drift the home position so the field keeps moving when silent.
    p.homeX += p.vhomeX;
    p.homeY += p.vhomeY;
    if (p.homeX < 0.08) { p.homeX = 0.08; p.vhomeX = -p.vhomeX; }
    else if (p.homeX > 0.92) { p.homeX = 0.92; p.vhomeX = -p.vhomeX; }
    if (p.homeY < 0.08) { p.homeY = 0.08; p.vhomeY = -p.vhomeY; }
    else if (p.homeY > 0.92) { p.homeY = 0.92; p.vhomeY = -p.vhomeY; }

    // Spring toward (drifting) home
    p.vx += (p.homeX - p.x) * springK;
    p.vy += (p.homeY - p.y) * springK;

    // Outward kick from center on bass spikes
    const dx = p.x - 0.5;
    const dy = p.y - 0.5;
    const dist = Math.sqrt(dx * dx + dy * dy) + 0.0001;
    const inv = 1 / dist;
    const falloff = 1 / (1 + dist * 5);
    p.vx += (dx * inv) * kickStrength * falloff;
    p.vy += (dy * inv) * kickStrength * falloff;

    // Snare jitter — small lateral hits add chaos to the dance
    if (snare > 0.3) {
      p.vx += (Math.random() - 0.5) * snare * 0.008;
      p.vy += (Math.random() - 0.5) * snare * 0.008;
    }

    p.vx *= drag;
    p.vy *= drag;

    p.x += p.vx;
    p.y += p.vy;

    // Soft bounds — flip velocity at edges
    if (p.x < 0.02) { p.x = 0.02; p.vx = Math.abs(p.vx); }
    else if (p.x > 0.98) { p.x = 0.98; p.vx = -Math.abs(p.vx); }
    if (p.y < 0.02) { p.y = 0.02; p.vy = Math.abs(p.vy); }
    else if (p.y > 0.98) { p.y = 0.98; p.vy = -Math.abs(p.vy); }
  }

  // Connect nearby — threshold widens with mid energy so the web
  // "fills in" during loud passages.
  const threshold = 0.18 + mid * 0.12;
  ctx.lineWidth = 1;
  for (let i = 0; i < parts.length; i++) {
    for (let j = i + 1; j < parts.length; j++) {
      const a = parts[i], b = parts[j];
      const ddx = a.x - b.x, ddy = a.y - b.y;
      const d = Math.sqrt(ddx * ddx + ddy * ddy);
      if (d < threshold) {
        const alpha = (1 - d / threshold) * 0.7;
        ctx.strokeStyle = accent + hex2(alpha * 200);
        ctx.beginPath();
        ctx.moveTo(a.x * w, a.y * h);
        ctx.lineTo(b.x * w, b.y * h);
        ctx.stroke();
      }
    }
  }

  // Particles
  for (const p of parts) {
    const px = p.x * w, py = p.y * h;
    ctx.fillStyle = accent2;
    ctx.shadowColor = accent2;
    ctx.shadowBlur = 8 + bass * 12;
    ctx.beginPath();
    ctx.arc(px, py, p.r * (1 + bass * 0.6 + kick * 0.4), 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
  }
});

// Aurora — soft veils flowing across the screen, treble-driven brightness.
// Migrated from the built-in style of the same name.
//
// Note: the task table listed aurora as driving off bands/onset only (no
// bins K). That's wrong — the VEILS spectral-bend term below reads
// reader.out[binIdx] with binIdx up to 63, so the original spectrum reader
// is 64 bins and this bundle needs viz.bins(64) too.
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
  const bass = f.bands.bass;
  const mid = f.bands.mid;
  const treble = f.bands.treble;
  const kick = f.onset.kick;
  const accent = f.theme.accent;
  const accent2 = f.theme.accent2;
  const bins = viz.bins(64);

  t += 0.04;
  // Sky base
  const sky = ctx.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, '#020308');
  sky.addColorStop(0.7, '#06070a');
  sky.addColorStop(1, '#0c0d12');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h);

  // Stars
  for (let i = 0; i < 60; i++) {
    const sx = (i * 73) % w;
    const sy = ((i * 37) % (h * 0.6));
    const s = (Math.sin(t * 2 + i) + 1) * 0.5;
    ctx.fillStyle = `rgba(255,255,255,${0.15 + s * 0.4})`;
    ctx.fillRect(sx, sy, 1, 1);
  }

  // Aurora veils — 3 layers, each tied to a frequency band so the
  // *shape* of the curtain bends with the music, not just brightness.
  ctx.globalCompositeOperation = 'screen';
  const VEILS = [
    // High curtain — treble drives ripple amplitude; bin 50–63 spans 4–16kHz
    { color: accent,  speed: 0.2,  freq: 0.6,  amp: 0.3,  opacity: 0.55 + treble * 0.35, energy: treble, binStart: 50, binEnd: 63 },
    // Mid curtain — vocals/snare body
    { color: accent2, speed: 0.13, freq: 0.4,  amp: 0.45, opacity: 0.45 + mid * 0.3,    energy: mid,    binStart: 22, binEnd: 42 },
    // Low curtain — bass + kicks bulge the whole veil upward
    { color: accent,  speed: 0.08, freq: 0.25, amp: 0.55, opacity: 0.3  + bass * 0.4,   energy: bass,   binStart: 0,  binEnd: 22 },
  ];
  const points = 80;
  for (const v of VEILS) {
    // Audio mod: this veil's own band level inflates the wave amplitude,
    // and a kick lifts the baseline upward briefly.
    const ampMod = 1 + v.energy * 2.2 + kick * 0.4;
    const baseLift = v.energy * h * 0.18 + kick * h * 0.08;
    ctx.beginPath();
    const baseY = h * 0.45;
    ctx.moveTo(0, h);
    for (let i = 0; i <= points; i++) {
      const x = (i / points) * w;
      // Time-driven shape (the original sin/cos pattern)
      const wav = Math.sin(i * v.freq + t * v.speed * 5) * 0.5
                + Math.cos(i * v.freq * 0.4 + t * v.speed * 3) * 0.5;
      // Spectral bend: sample the band's bin range across x so the
      // curtain has localized peaks where loud frequencies are.
      const binSpan = v.binEnd - v.binStart;
      const binIdx = v.binStart + Math.floor((i / points) * binSpan);
      const specV = bins[binIdx] ?? 0;
      const specBend = (specV - 0.3) * h * 0.18; // negative = pushes up
      const y = baseY + wav * h * v.amp * ampMod - h * 0.1 - baseLift - specBend;
      ctx.lineTo(x, y);
    }
    ctx.lineTo(w, h);
    ctx.closePath();
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, v.color + '00');
    grad.addColorStop(0.4, v.color + hex2(v.opacity * 60));
    grad.addColorStop(0.7, v.color + hex2(v.opacity * 200));
    grad.addColorStop(1, v.color + '00');
    ctx.fillStyle = grad;
    ctx.fill();
  }
  ctx.globalCompositeOperation = 'source-over';

  // Mountain silhouette at bottom
  ctx.fillStyle = '#000';
  ctx.beginPath();
  ctx.moveTo(0, h);
  for (let x = 0; x <= w; x += 12) {
    const y = h * 0.85 + Math.sin(x * 0.012) * 14 + Math.cos(x * 0.006) * 22;
    ctx.lineTo(x, y);
  }
  ctx.lineTo(w, h);
  ctx.closePath();
  ctx.fill();
});

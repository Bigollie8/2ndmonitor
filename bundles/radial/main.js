// Radial — a slowly-rotating ring of spectrum-driven spokes, mirrored
// around the circle. Migrated from the built-in style of the same name
// (HiFiVizRadial).
//
// Note: the original never calls makeSpectrumReader — it reads
// `spectrumRef.current.bands` directly and indexes it via `bands.length`
// (the host's raw live spectrum, always 64 — SPECTRUM_BANDS, see
// sandbox/bins.ts). The local `const N = 96` is the number of spokes drawn
// around the circle (a marker count), NOT the spectrum reader size — the
// exact trap task-1-brief.md warns about ("usually a particle, star or
// marker count"). Bins K is 64, not 96.
//
// The original's SVG used `viewBox="-50 -50 100 100"` with the SVG default
// `preserveAspectRatio="xMidYMid meet"` — uniform scale to fit, centered,
// letterboxed on the shorter axis. Reproduced here with
// `scale = Math.min(w, h) / 100`, centered at (w/2, h/2).
//
// Not reproduced: like every other style in this trio, the original ran its
// own additional per-spoke smoothing (`smoothedRef`) on top of the coarser
// per-band smoothing the host's frame-pump reader already applies with the
// user's real sensitivity/smoothing settings — a bundle only ever sees that
// already-smoothed 64-bin output, not the raw value or the smoothing
// coefficient, so it can't re-run an independent per-spoke EMA. Same
// documented simplification as waveform.

const SPOKES = 96;
const SRC_N = 64;
const HALF = SPOKES / 2;

let t = 0;

viz.on('frame', (f) => {
  const ctx = f.ctx;
  if (!ctx) return;
  const w = f.size.width;
  const h = f.size.height;
  if (w <= 0 || h <= 0) return;
  const accent = f.theme.accent;
  const accent2 = f.theme.accent2;
  const bins = viz.bins(SRC_N);

  t += 0.03;
  ctx.clearRect(0, 0, w, h);

  const cx = w / 2;
  const cy = h / 2;
  const scale = Math.min(w, h) / 100;
  const rot = (t * 8 * Math.PI) / 180;

  // Center glow + ring.
  const r14 = 14 * scale;
  const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r14);
  grad.addColorStop(0, accent + '33');
  grad.addColorStop(1, accent + '00');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(cx, cy, r14, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = accent + '40';
  ctx.lineWidth = 0.4 * scale;
  ctx.beginPath();
  ctx.arc(cx, cy, 13 * scale, 0, Math.PI * 2);
  ctx.stroke();

  ctx.lineCap = 'round';
  for (let i = 0; i < SPOKES; i++) {
    // Mirror the spectrum around the circle: first half is bands, second
    // half mirrors it back.
    const idx = i < HALF ? i : SPOKES - 1 - i;
    const bandIdx = Math.floor((idx / HALF) * (SRC_N - 1));
    const raw = (bins[bandIdx] ?? 0) * 1.1 + 0.08;
    const v = Math.max(0.1, Math.min(1, raw));

    const ang = (i / SPOKES) * Math.PI * 2 + rot;
    const r1 = 14 * scale;
    const r2 = (14 + v * 22) * scale;
    const cosA = Math.cos(ang);
    const sinA = Math.sin(ang);
    const x1 = cx + cosA * r1;
    const y1 = cy + sinA * r1;
    const x2 = cx + cosA * r2;
    const y2 = cy + sinA * r2;

    ctx.strokeStyle = i % 2 === 0 ? accent : accent2;
    ctx.globalAlpha = 0.4 + v * 0.6;
    ctx.lineWidth = 0.8 * scale;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
});

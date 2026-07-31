// Particles — spring-and-drag particle field that scatters outward on bass
// spikes, drifting homes keep the scene alive between beats. Migrated from
// the built-in style of the same name (HiFiVizParticles).
//
// Note: the original never calls makeSpectrumReader — it reads
// `spectrumRef.current.bands` directly and sums the first
// `Math.min(8, bands.length)` raw entries. `bands.length` is the host's raw
// live spectrum, always 64 (SPECTRUM_BANDS — see sandbox/bins.ts), so that's
// 8 out of 64. The local `const N = 140` next to it is the particle count —
// unrelated to bin count, the exact trap task-1-brief.md warns about ("a
// particle, star or marker count"). Bins K is therefore 64 (viz.bins(64)
// below), with only the first 8 entries actually summed.
//
// Not reproduced (sensitivity): the original computes
//   bassRaw = (lowAvg * 0.7 + level * 0.6) * 1.6 + 0.08
//   scaled  = bassRaw * sensitivity
// — sensitivity multiplies the WHOLE combined expression at once: the
// spectral average, the level term, the *1.6 gain, and the +0.08 baseline
// together. `viz.bins()` only pre-applies sensitivity per-bin, host-side,
// before this bundle ever sees a value — so here sensitivity only reaches
// `lowAvg` (via the already-scaled bins), never `level`, the *1.6 factor, or
// the +0.08 baseline. There is no raw sensitivity value reachable from a
// bundle to reapply to the rest.
//
// Not reproduced (smoothing): the original ran its OWN second EMA
// (`bassSmoothed`, driven by the same raw `smoothing` prop) on top of the
// per-bin smoothing every migrated style already gets for free from the
// host's frame-pump reader. A bundle has no way to read the raw `smoothing`
// coefficient — only the already per-bin-smoothed 64-bin output — so it
// can't re-run that second EMA with the correct coefficient. This bundle
// uses the combined `bassRaw` directly (clamped to the original's 1.5
// ceiling); same documented simplification as waveform/radial's own
// smoothing gap.
//
// Not reproduced (non-live fallback): like every other migrated style, the
// non-live procedural fallback comes from the host's shared shape (baked
// into viz.bins()/f.level), not this style's original bespoke
// `(Math.sin(t)*0.5+0.5)*0.5+0.3` shape — inherent to the sandbox
// architecture, documented once in bars/main.js.
//
// Not reproduced (DPR): the original explicitly multiplied particle radius
// by `getVizDpr()` because its own canvas backing store was sized to
// devicePixelRatio (`canvas.width = rect.width * dpr`) while `p.r` itself
// was chosen at CSS-pixel scale — the two needed reconciling. The sandbox
// here sizes the canvas straight to `f.size` (CSS pixels, no DPR multiply —
// see sandbox-html.ts's `applySize`), so there is no DPR factor left to
// multiply by. `p.r` is used unscaled below, exactly as every migrated
// canvas bundle already omits DPR (none of them reference it) — not a gap
// specific to this style.
//
// Frame timing: the original mutates particle physics (spring force, drag,
// outward kick, home drift) on every rAF tick with fixed per-tick constants
// — itself framerate-dependent (faster motion at 144Hz than 60Hz). Rather
// than copy that dependency, every additive/multiplicative step below is
// scaled by `k = f.dt * 60` (reference: one original tick == 1/60s, so k is
// "how many reference ticks" this frame represents), using `Math.pow` for
// the multiplicative decay terms (velocity drag, the bass spike-reference
// EMA) so the effective time-constant of each decay stays correct at any
// frame rate instead of compounding wrongly. At dt = 1/60 (k = 1) every line
// below reduces exactly to the original's per-tick recurrence.

const N = 140;
const pts = [];
for (let i = 0; i < N; i++) {
  const x = Math.random();
  const y = Math.random();
  pts.push({
    x, y,
    homeX: x, homeY: y, // each particle springs back to its (drifting) home
    vhomeX: (Math.random() - 0.5) * 0.0010,
    vhomeY: (Math.random() - 0.5) * 0.0010,
    vx: 0, vy: 0,
    r: 0.5 + Math.random() * 1.8,
    hue: Math.random(),
  });
}

let bassReference = 0; // slow-tracking baseline; spike = bass - reference

viz.on('frame', (f) => {
  const ctx = f.ctx;
  if (!ctx) return;
  const w = f.size.width;
  const h = f.size.height;
  if (w <= 0 || h <= 0) return;
  const accent = f.theme.accent;
  const accent2 = f.theme.accent2;
  const bins = viz.bins(64);
  const level = f.level;
  const k = f.dt * 60;

  ctx.clearRect(0, 0, w, h);

  // Bass = energy across the lowest 8 (of 64) bins, mixed with overall level
  // for snappier reaction on transient kicks.
  let sum = 0;
  const lowN = Math.min(8, bins.length);
  for (let i = 0; i < lowN; i++) sum += bins[i] ?? 0;
  const lowAvg = sum / lowN;
  const bassRaw = (lowAvg * 0.7 + level * 0.6) * 1.6 + 0.08;
  const bass = Math.min(1.5, bassRaw);

  // Spike detection: bass exceeding the slow-tracked reference is "the beat".
  const refDecay = Math.pow(0.92, k);
  bassReference = bassReference * refDecay + bass * (1 - refDecay);
  const spike = Math.max(0, bass - bassReference);

  ctx.fillStyle = accent2 + '11';
  ctx.fillRect(0, 0, w, h);

  const kickStrength = spike * 0.012;
  const springK = 0.018;
  const dragDecay = Math.pow(0.86, k);

  for (const p of pts) {
    // Drift the home position so the scene stays alive between beats.
    // Bounce off a 5% inner margin so homes never reach the corners.
    p.homeX += p.vhomeX * k;
    p.homeY += p.vhomeY * k;
    if (p.homeX < 0.05) { p.homeX = 0.05; p.vhomeX = -p.vhomeX; }
    else if (p.homeX > 0.95) { p.homeX = 0.95; p.vhomeX = -p.vhomeX; }
    if (p.homeY < 0.05) { p.homeY = 0.05; p.vhomeY = -p.vhomeY; }
    else if (p.homeY > 0.95) { p.homeY = 0.95; p.vhomeY = -p.vhomeY; }

    // Spring force toward (drifting) home.
    p.vx += (p.homeX - p.x) * springK * k;
    p.vy += (p.homeY - p.y) * springK * k;

    // Outward kick from center on bass spikes, falling off with distance.
    const dx = p.x - 0.5;
    const dy = p.y - 0.5;
    const dist = Math.sqrt(dx * dx + dy * dy) + 0.0001;
    const inv = 1 / dist;
    const falloff = 1 / (1 + dist * 5);
    p.vx += (dx * inv) * kickStrength * falloff * k;
    p.vy += (dy * inv) * kickStrength * falloff * k;

    p.vx *= dragDecay;
    p.vy *= dragDecay;

    p.x += p.vx * k;
    p.y += p.vy * k;

    const px = p.x * w, py = p.y * h;
    const r = p.r * (0.3 + bass * 2.8);
    const grad = ctx.createRadialGradient(px, py, 0, px, py, r * 4);
    grad.addColorStop(0, p.hue > 0.5 ? accent : accent2);
    grad.addColorStop(1, 'transparent');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(px, py, r * 4, 0, Math.PI * 2);
    ctx.fill();
  }
});

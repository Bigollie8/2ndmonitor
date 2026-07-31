// Bars — 64-band vertical bar chart with decaying peak-hold markers.
// Migrated from the built-in style of the same name (HiFiVizBars).
//
// Note: the original never calls makeSpectrumReader — it inlines the exact
// same per-bin EMA loop over `const count = 64`, reading
// `spectrumRef.current.bands[i]` directly for i in 0..63. The host's raw
// live spectrum is itself 64 bands (SPECTRUM_BANDS, see sandbox/bins.ts), so
// that inlined loop is equivalent to reading a 64-entry reader output
// directly. Bins K is therefore 64 — and it's the one style in this trio
// where the bar count and the correct K happen to coincide, so there's no
// trap here the way there is for waveform/radial.
//
// The host's own frame-pump reader (sandbox-html.ts) already applies
// sensitivity/smoothing with the identical formula this component used to
// inline, and clamps to the same [0.04, 1] range — so `viz.bins(N)` below is
// already what the original's `smoothedRef`/clamp loop produced. This bundle
// does not re-apply either.
//
// Not reproduced: the original's non-live fallback was its own bespoke
// sine/noise/beat shape distinct in detail from the host's shared procedural
// fallback (used when spectrumRef isn't live) — every canvas bundle in this
// project inherits the host's shared fallback shape instead of each style's
// original bespoke one; this is inherent to the sandbox architecture, not
// specific to this style.

const N = 64;
// Peak-hold markers: each decays 0.008/frame unless the current bar height
// exceeds it, exactly like the original's peaksRef.
const peaks = new Float32Array(N);

viz.on('frame', (f) => {
  const ctx = f.ctx;
  if (!ctx) return;
  const w = f.size.width;
  const h = f.size.height;
  if (w <= 0 || h <= 0) return;
  const accent = f.theme.accent;
  const accent2 = f.theme.accent2;
  const bins = viz.bins(N);

  ctx.clearRect(0, 0, w, h);

  // Match the DOM version's layout: 8% top / 4% side / 12% bottom padding,
  // 0.4% gap between bars.
  const padTop = h * 0.08;
  const padBottom = h * 0.12;
  const padSide = w * 0.04;
  const plotW = Math.max(0, w - padSide * 2);
  const plotH = Math.max(0, h - padTop - padBottom);
  const floorY = padTop + plotH;
  const gap = plotW * 0.004;
  const barW = Math.max(0.5, (plotW - gap * (N - 1)) / N);

  for (let i = 0; i < N; i++) {
    const v = Math.max(0.04, Math.min(1, bins[i] ?? 0));
    if (v > peaks[i]) peaks[i] = v;
    else peaks[i] = Math.max(v, peaks[i] - 0.008);

    const x = padSide + i * (barW + gap);
    const barH = v * plotH;
    const topY = floorY - barH;

    const grad = ctx.createLinearGradient(0, topY, 0, floorY);
    grad.addColorStop(0, accent);
    grad.addColorStop(1, accent2);
    ctx.fillStyle = grad;
    ctx.shadowColor = accent;
    ctx.shadowBlur = 6;
    ctx.fillRect(x, topY, barW, barH);
    ctx.shadowBlur = 0;

    // Peak-hold line.
    const peakY = floorY - peaks[i] * plotH;
    ctx.fillStyle = accent;
    ctx.globalAlpha = 0.85;
    ctx.fillRect(x, peakY - 1, barW, 2);
    ctx.globalAlpha = 1;
  }
});

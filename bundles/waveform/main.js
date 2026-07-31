// Waveform — a filled ribbon-line polyline biased toward the energetic
// (low/mid) end of the spectrum. Migrated from the built-in style of the
// same name (HiFiVizWaveform).
//
// Note: the original never calls makeSpectrumReader either — it reads
// `spectrumRef.current.bands` directly and maps `bands.length` (the host's
// raw live spectrum, always 64 — SPECTRUM_BANDS, see sandbox/bins.ts) into a
// biased index. The local `const N = 200` next to it is the number of x
// samples along the polyline (a resolution/marker count), NOT the spectrum
// reader size — exactly the trap task-1-brief.md warns about. Bins K is 64.
//
// Not reproduced (smoothing): the original additionally ran its own
// per-x-point EMA (`smoothedRef`, 200 independent smoothing states) driven
// by the raw `smoothing` prop, on top of the coarser per-band smoothing
// every other migrated style already gets for free from the host's
// frame-pump reader (sandbox-html.ts's `makeSpectrumReader(64, ...)`, run
// with the user's actual sensitivity/smoothing settings). A bundle has no
// way to read that raw `smoothing` value or run its own independent EMA per
// x-sample — it only ever sees the already-smoothed 64-bin output — so this
// bundle relies solely on that host-level smoothing, same as every other
// migrated bundle in this project. The visual effect is a marginally less
// silky line at high `smoothing` settings; the shape and frequency response
// are unaffected.
//
// Not reproduced (sensitivity): the original computes
// `vRaw = (bandV * 0.55 + level * 0.45 + 0.06) * sensitivity` — sensitivity
// scales the WHOLE blended term, including the `level` contribution and the
// 0.06 baseline. `viz.bins()` only pre-applies sensitivity to `bandV` (the
// host bakes it into the N=64 reader before resampling); there is no raw
// `sensitivity` value reachable from inside a bundle to also apply it to
// `level` or the baseline here. So below, `level * 0.45 + 0.06` does not
// respond to the sensitivity slider the way it does in the original —
// same category of gap as the smoothing note above, not a shortcut.
const POINTS = 200;
const SRC_N = 64;
const MAX_BAND = Math.floor(SRC_N * 0.7); // = 44, matches the original's cutoff

let t = 0;

viz.on('frame', (f) => {
  const ctx = f.ctx;
  if (!ctx) return;
  const w = f.size.width;
  const h = f.size.height;
  if (w <= 0 || h <= 0) return;
  const accent = f.theme.accent;
  const accent2 = f.theme.accent2;
  const level = f.level;
  const bins = viz.bins(SRC_N);

  t += 0.05;
  ctx.clearRect(0, 0, w, h);

  const pts = new Array(POINTS);
  for (let i = 0; i < POINTS; i++) {
    const x = (i / (POINTS - 1)) * w;
    const tNorm = i / (POINTS - 1);
    const biased = Math.pow(tNorm, 1.6);
    const bandIdx = Math.min(MAX_BAND, Math.floor(biased * MAX_BAND));
    const bandV = bins[bandIdx] ?? 0;
    const v = bandV * 0.55 + level * 0.45 + 0.06;
    const phase = Math.sin(i * 0.4 + t * 1.3);
    const y = (h / 2) + phase * v * (h * 0.35);
    pts[i] = [x, y];
  }

  const grad = ctx.createLinearGradient(0, 0, w, 0);
  grad.addColorStop(0, accent2);
  grad.addColorStop(1, accent);

  // Soft blurred backdrop stroke (matches the original's
  // opacity="0.3" filter="blur(2px)" second polyline).
  //
  // Both original polylines use vectorEffect="non-scaling-stroke" with a
  // fixed strokeWidth ("4" / "1.6") — that attribute exists specifically to
  // keep the stroke a constant on-screen thickness regardless of the SVG's
  // viewBox scale or the container's size. So the canvas equivalent is a
  // literal, unscaled `ctx.lineWidth`, not one multiplied by `h` (which
  // would make the line visibly too thick on a tall panel and too thin on a
  // small one — exactly what non-scaling-stroke opts out of).
  ctx.strokeStyle = grad;
  ctx.globalAlpha = 0.3;
  ctx.filter = 'blur(2px)';
  ctx.lineWidth = 4;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
  ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.filter = 'none';

  // Crisp foreground line.
  ctx.strokeStyle = grad;
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
  ctx.stroke();
});

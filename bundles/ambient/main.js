// Ambient — four soft radial-gradient blobs that slowly drift, bass inflates
// them and mid nudges saturation. Migrated from the built-in style of the
// same name (HiFiVizAmbient).
//
// Note: the original calls `makeSpectrumReader(48, spectrumRef, sensitivity,
// smoothing)` and only ever reads `reader.bands.bass` / `reader.bands.mid` —
// it never touches `reader.out[]` (the per-bin array). Bins K is therefore
// literally 48, read directly off that makeSpectrumReader call (no marker-
// count trap here — unlike bars/waveform/radial/particles, there's no local
// `const N` standing in for something else). BUT since the style only ever
// consumes the bass/mid aggregate, this bundle follows the same precedent as
// liquid/constellation (also aggregate-only styles): it never calls
// viz.bins() — that would be dead weight — and instead reads `f.bands.bass`
// / `f.bands.mid` straight from the frame payload, which the host computes
// with the identical formula (musical-thirds split, per-bin sensitivity +
// smoothing, [0.04,1] clamp — see makeSpectrumReader in viz.tsx) at its own
// N=64 frame-pump reader instead of a redundant N=48 one. The only gap this
// leaves is bin *resolution* (64 vs. 48) for the same proportional
// frequency-range averages — not a sensitivity or smoothing gap. Unlike
// particles/waveform/radial, ambient's sensitivity AND smoothing are both
// FULLY reproduced here: `f.bands.bass`/`f.bands.mid` already have both
// baked in per-bin, before the average, exactly as the original's own N=48
// reader would have.
//
// Not reproduced (drift shape): the original doesn't animate this in JS at
// all — the wander is a CSS `@keyframes amb-drift` (0% translate(0,0), 50%
// translate(3%,-2%), 100% translate(-2%,3%), `22s ease-in-out infinite
// alternate`) on the gradient div, with the browser's compositor driving the
// easing and looping. A canvas bundle has no CSS animation engine, so this
// is reimplemented as an explicit phase accumulator advanced by `f.dt`
// (state genuinely carried frame-to-frame, unlike the direct-from-bands
// scale/saturate/blur below). The eased ping-pong (0->1->0) uses a smoothstep
// (`t*t*(3-2*t)`) as an approximation of CSS's `ease-in-out` cubic-bezier —
// close in shape but not bit-identical. Blob screen positions/radii are also
// expressed as straight percentages of the canvas, not of the original's
// oversized (`inset:-10%`, i.e. 120%-sized) wrapper div, which shifts each
// blob's true center by a couple of percent — a minor, disclosed
// approximation, not a scaling bug (no vector-effect / non-scaling-stroke
// equivalent applies to radial gradients, so scaling blob size with the
// canvas here is correct, unlike a stroke width would be).
//
// Not reproduced (transition smoothing): the original's `scale`/`filter`
// writes hit the DOM through a CSS `transition: transform 120ms ease-out,
// filter 200ms ease-out`, which the compositor smooths on its own. This
// bundle reproduces that with its own dt-based exponential lag toward the
// target scale/saturation/blur, using the same two time constants
// (120ms/200ms) — an approximation of the browser's cubic-bezier easing via
// a simple lag filter, not a pixel-identical transition curve.

let phase = 0; // 0..1 through the current drift leg
let dir = 1; // 1 = forward (0%->100%), -1 = backward (100%->0%)
let smScale = 1; // matches bass=0 -> scale=1
let smSat = 1.2; // matches mid=0 -> sat=1.2
let smBlur = 6; // matches bass=0 -> blur=6

function lag(current, target, dt, tauSec) {
  if (tauSec <= 0) return target;
  const a = 1 - Math.exp(-dt / tauSec);
  return current + (target - current) * a;
}

viz.on('frame', (f) => {
  const ctx = f.ctx;
  if (!ctx) return;
  const w = f.size.width;
  const h = f.size.height;
  if (w <= 0 || h <= 0) return;
  const accent = f.theme.accent;
  const accent2 = f.theme.accent2;
  const bass = f.bands.bass;
  const mid = f.bands.mid;
  const dt = f.dt;

  // Drift phase — 22s each direction, smoothstep-eased, ping-ponging.
  phase += dir * (dt / 22);
  if (phase > 1) { phase = 1; dir = -1; }
  else if (phase < 0) { phase = 0; dir = 1; }
  const e = phase * phase * (3 - 2 * phase);
  let dxPct, dyPct;
  if (e <= 0.5) {
    const u = e / 0.5;
    dxPct = 3 * u;
    dyPct = -2 * u;
  } else {
    const u = (e - 0.5) / 0.5;
    dxPct = 3 + u * (-2 - 3);
    dyPct = -2 + u * (3 - -2);
  }

  const targetScale = 1 + bass * 0.18;
  const targetSat = 1.2 + mid * 0.6;
  const targetBlur = 2 + (1 - bass) * 4;
  smScale = lag(smScale, targetScale, dt, 0.12);
  smSat = lag(smSat, targetSat, dt, 0.2);
  smBlur = lag(smBlur, targetBlur, dt, 0.2);

  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#06080d';
  ctx.fillRect(0, 0, w, h);

  const cx = w / 2;
  const cy = h / 2;
  const dxPx = (dxPct / 100) * w;
  const dyPx = (dyPct / 100) * h;

  ctx.save();
  ctx.filter = `blur(${smBlur}px) saturate(${smSat})`;
  ctx.translate(cx + dxPx, cy + dyPx);
  ctx.scale(smScale, smScale);
  ctx.translate(-cx, -cy);

  function blob(xPct, yPct, rxPct, ryPct, color, fadeAt) {
    const bx = w * xPct;
    const by = h * yPct;
    const rx = w * rxPct;
    const ry = h * ryPct;
    const r1 = Math.max(rx, ry);
    if (r1 <= 0) return;
    const grad = ctx.createRadialGradient(bx, by, 0, bx, by, r1);
    grad.addColorStop(0, color);
    grad.addColorStop(Math.min(1, fadeAt), 'transparent');
    ctx.save();
    ctx.translate(bx, by);
    ctx.scale(rx / r1, ry / r1);
    ctx.translate(-bx, -by);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(bx, by, r1, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // ellipse 50% 40% at 25% 35%, transparent 65%
  blob(0.25, 0.35, 0.25, 0.20, accent + '77', 0.65);
  // ellipse 45% 55% at 75% 60%, transparent 65%
  blob(0.75, 0.60, 0.225, 0.275, accent2 + '77', 0.65);
  // ellipse 35% 30% at 50% 85%, transparent 70%
  blob(0.50, 0.85, 0.175, 0.15, accent + '55', 0.70);
  // ellipse 60% 45% at 15% 80%, transparent 70%
  blob(0.15, 0.80, 0.30, 0.225, accent2 + '33', 0.70);

  ctx.restore();
});

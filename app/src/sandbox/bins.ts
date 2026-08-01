// ─────────────────────────────────────────────────────────────────────────────
// Nearest-neighbour spectrum resampling — the ONE definition of the mapping.
//
// The Rust capture emits exactly SPECTRUM_BANDS = 64 log-spaced bands, and
// makeSpectrumReader (viz.tsx) resamples them with
// `liveBands[Math.floor((i / N) * srcLen)]`, applying sensitivity and per-bin
// smoothing to its N outputs. The sandbox frame pump runs that reader at N=64,
// so a bundle resampling 64 → its own N with this same formula gets output
// identical to a built-in style reading N bins directly: the same source bin is
// selected either way, and per-bin EMA commutes with nearest-neighbour
// selection. Change this formula and every migrated style silently drifts.
// ─────────────────────────────────────────────────────────────────────────────

export function resampleBins(
  src: Float32Array | number[] | null | undefined,
  n: number,
  out?: Float32Array,
): Float32Array {
  const dst = out && out.length === n ? out : new Float32Array(n);
  const len = src ? src.length : 0;
  if (len === 0) {
    dst.fill(0);
    return dst;
  }
  for (let i = 0; i < n; i++) {
    dst[i] = src![Math.floor((i / n) * len)] ?? 0;
  }
  return dst;
}

/** The one definition of `viz.bins(n)`'s input clamp — bundle authors can pass
 *  anything (negative, NaN, a string from a corrupt settings value, 1e10), and
 *  this is what keeps the sandbox shim from allocating something absurd or
 *  indexing with NaN. Exported (not just inlined in BINS_SHIM_SRC) so it has
 *  exactly one definition and a direct test, instead of living only inside a
 *  string that's injected into the iframe. */
export function clampBinCount(n: unknown): number {
  return Math.max(1, Math.min(4096, (n as number) | 0));
}

/** The same clamp as an ES5 source string, injected into the sandbox runtime
 *  alongside BINS_SHIM_SRC. Kept beside `clampBinCount` so `bins.test.ts` can
 *  assert they agree, the same pattern as BINS_SHIM_SRC/resampleBins above. */
export const CLAMP_SHIM_SRC = String.raw`
function __clampBinCount(n) {
  return Math.max(1, Math.min(4096, n | 0));
}
`;

/** The same algorithm as an ES5 source string, injected into the sandbox shim.
 *  Kept beside `resampleBins` so `bins.test.ts` can assert they agree. */
export const BINS_SHIM_SRC = String.raw`
function __resample(src, n, out) {
  var dst = (out && out.length === n) ? out : new Float32Array(n);
  var len = src ? src.length : 0;
  if (!len) { dst.fill(0); return dst; }
  for (var i = 0; i < n; i++) {
    var v = src[Math.floor((i / n) * len)];
    dst[i] = v === undefined ? 0 : v;
  }
  return dst;
}
`;

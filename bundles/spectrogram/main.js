// Spectrogram — scrolling waterfall heatmap.
// Migrated from the built-in style of the same name.
//
// Note: the original's local `const N = 64;` is both the spectrum reader
// size AND the column height (`colH = c.height / N`) — reader.out[i] is read
// for the full range 0..63. So bins K is 64, matching the task table's
// implicit expectation despite the table showing "—".
//
// The task table's "scrolling column buffer" state doesn't need any JS
// state to hoist either: the getImageData/putImageData scroll-left trick
// reads and rewrites the SAME persistent canvas every frame, exactly as the
// original did across rAF ticks on its own canvas element. No extra buffer.
//
// a1/a2 (the two theme colors as {r,g,b}) are recomputed every frame from
// f.theme rather than cached once — cheap, and correct if the theme changes
// while this keeps running (the original only recomputed them when the
// effect re-ran on an accent/accent2 prop change).
function hexToRgb(hex) {
  const h = hex.replace('#', '');
  const num = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return { r: (num >> 16) & 255, g: (num >> 8) & 255, b: num & 255 };
}

const N = 64;

viz.on('frame', (f) => {
  const ctx = f.ctx;
  if (!ctx) return;
  const w = f.size.width;
  const h = f.size.height;
  if (w <= 0 || h <= 0) return;
  const accent = f.theme.accent;
  const accent2 = f.theme.accent2;
  const bins = viz.bins(N);
  const a1 = hexToRgb(accent);
  const a2 = hexToRgb(accent2);

  // Scroll left
  const img = ctx.getImageData(2, 0, w - 2, h);
  ctx.putImageData(img, 0, 0);
  // Draw new column on right
  const colH = h / N;
  for (let i = 0; i < N; i++) {
    const v = bins[i] ?? 0;
    const heat = Math.min(1, v * 1.4);
    let r;
    let g;
    let b;
    if (heat < 0.5) {
      const k = heat * 2;
      r = Math.round(20 + a1.r * k * 0.6);
      g = Math.round(20 + a1.g * k * 0.6);
      b = Math.round(40 + a1.b * k * 0.6);
    } else {
      const k = (heat - 0.5) * 2;
      r = Math.round(a1.r * (1 - k) + a2.r * k * 1.2);
      g = Math.round(a1.g * (1 - k) + a2.g * k * 1.2);
      b = Math.round(a1.b * (1 - k) + a2.b * k * 1.2);
    }
    ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
    ctx.fillRect(w - 2, h - (i + 1) * colH, 2, colH + 1);
  }
});

// Starter files for "New visualizer". The code doubles as living API docs —
// it exercises spectrum, bands, onset, theme, and dt.

export function newVizManifest(id: string): string {
  return JSON.stringify(
    { id, name: 'My Visualizer', version: '0.1.0', api: 1, permissions: [] },
    null,
    2,
  );
}

export const NEW_VIZ_CODE = `// Second-Monitor Hub scripted visualizer (API v1).
//
// viz.on('frame', cb)  — cb runs every animation frame with:
//   ctx       CanvasRenderingContext2D (or use viz.canvas.getContext('webgl2') yourself)
//   spectrum  Float32Array(64), 0..1, log-spaced 30Hz-16kHz
//   waveform  Uint8Array(1024), raw time-domain, 128 = silence
//   bands     { bass, mid, treble }          0..1
//   onset     { kick, snare, hat }           transient envelopes, 0..1
//   level     overall loudness 0..1
//   dt        seconds since last frame
//   size      { width, height } of the canvas in device pixels
//   theme     { accent, accent2 } current accent colors (hex strings)
//   track     { title, artist } or null
//
// viz.settings.get(key) / viz.settings.set(key, value) — persisted per-visualizer.

viz.on('frame', ({ ctx, spectrum, bands, onset, size, theme }) => {
  if (!ctx) return;
  const { width: w, height: h } = size;

  // Trails: translucent black instead of clearRect.
  ctx.fillStyle = 'rgba(0,0,0,0.22)';
  ctx.fillRect(0, 0, w, h);

  // Spectrum bars.
  const n = spectrum.length;
  const bw = w / n;
  for (let i = 0; i < n; i++) {
    const v = spectrum[i];
    ctx.fillStyle = i % 2 ? theme.accent : theme.accent2;
    ctx.fillRect(i * bw, h - v * h * 0.9, bw * 0.8, v * h * 0.9);
  }

  // Kick flash ring.
  if (onset.kick > 0.05) {
    ctx.strokeStyle = theme.accent;
    ctx.lineWidth = 2 + onset.kick * 10;
    ctx.globalAlpha = onset.kick;
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, (0.2 + bands.bass * 0.3) * Math.min(w, h), 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
});
`;

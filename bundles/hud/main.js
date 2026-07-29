// Aircraft HUD — fictional heads-up display, frequency bins drive instruments.
// Migrated from the built-in style of the same name.
//
// Note: the original creates its spectrum reader with makeSpectrumReader(32,
// ...) and the bottom "SPEC.LOCK" strip reads reader.out[i] for i in 0..31
// (its own local `const N = 32`). So bins K is 32, matching the task table.

function drawTape(ctx, accent, x, y, val, label, right) {
  const tapeH = 200, tapeW = 50;
  const tx = right ? x - tapeW : x;
  ctx.strokeStyle = accent + '88';
  ctx.strokeRect(tx, y - tapeH / 2, tapeW, tapeH);
  ctx.fillStyle = accent + '22';
  ctx.fillRect(tx, y - tapeH / 2, tapeW, tapeH);
  ctx.fillStyle = accent;
  ctx.font = 'bold 14px JetBrains Mono, monospace';
  ctx.fillText(String(val), tx + 4, y + 4);
  ctx.font = '9px JetBrains Mono, monospace';
  ctx.fillText(label, tx + 4, y + 18);
  // ticks
  for (let i = -5; i <= 5; i++) {
    const ty = y + i * 18;
    if (ty < y - tapeH / 2 || ty > y + tapeH / 2) continue;
    ctx.strokeStyle = accent + (i === 0 ? 'ff' : '44');
    ctx.beginPath();
    ctx.moveTo(right ? tx : tx + tapeW, ty);
    ctx.lineTo(right ? tx + 6 : tx + tapeW - 6, ty);
    ctx.stroke();
  }
}

// The only accumulator this style keeps is a free-running clock: heading and
// pitch-ladder offset are both derived from it each frame, not stored
// separately.
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
  const bins = viz.bins(32);

  t += 0.04;
  const cx = w / 2, cy = h / 2;
  ctx.fillStyle = '#02050a';
  ctx.fillRect(0, 0, w, h);

  ctx.strokeStyle = accent;
  ctx.fillStyle = accent;
  ctx.lineWidth = 1;
  ctx.font = '11px JetBrains Mono, monospace';

  // Center reticle
  ctx.strokeStyle = accent + 'cc';
  ctx.beginPath();
  ctx.arc(cx, cy, 30, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath(); ctx.moveTo(cx - 50, cy); ctx.lineTo(cx - 35, cy); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(cx + 35, cy); ctx.lineTo(cx + 50, cy); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(cx, cy - 50); ctx.lineTo(cx, cy - 35); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(cx, cy + 35); ctx.lineTo(cx, cy + 50); ctx.stroke();

  // Pitch ladder (horizon lines)
  const pitchOffset = Math.sin(t * 0.5) * mid * 40;
  ctx.strokeStyle = accent + '66';
  ctx.beginPath();
  ctx.moveTo(cx - 200, cy + pitchOffset); ctx.lineTo(cx - 60, cy + pitchOffset);
  ctx.moveTo(cx + 60, cy + pitchOffset); ctx.lineTo(cx + 200, cy + pitchOffset);
  ctx.stroke();
  for (let p = -3; p <= 3; p++) {
    if (p === 0) continue;
    const py = cy + pitchOffset + p * 30;
    const len = Math.abs(p) === 1 ? 80 : 40;
    ctx.strokeStyle = accent + '44';
    ctx.beginPath();
    ctx.moveTo(cx - 130, py); ctx.lineTo(cx - 130 + len, py);
    ctx.moveTo(cx + 130 - len, py); ctx.lineTo(cx + 130, py);
    ctx.stroke();
    ctx.fillStyle = accent;
    ctx.fillText(String(p * 10).padStart(2, '0'), cx - 160, py + 4);
  }

  // Left tape (altitude = bass)
  const altitude = Math.floor(8000 + bass * 4000);
  drawTape(ctx, accent, 30, cy, altitude, 'ALT', false);

  // Right tape (speed = treble)
  const speed = Math.floor(280 + treble * 200);
  drawTape(ctx, accent, w - 30, cy, speed, 'KTS', true);

  // Top compass
  const heading = (t * 8) % 360;
  ctx.strokeStyle = accent + '88';
  ctx.beginPath();
  ctx.moveTo(cx - 120, 28); ctx.lineTo(cx + 120, 28);
  ctx.stroke();
  for (let h_ = 0; h_ < 360; h_ += 10) {
    const offset = ((h_ - heading + 540) % 360) - 180;
    if (Math.abs(offset) > 60) continue;
    const x = cx + offset * 2;
    const major = h_ % 30 === 0;
    ctx.strokeStyle = accent + 'cc';
    ctx.beginPath();
    ctx.moveTo(x, 28); ctx.lineTo(x, major ? 18 : 23);
    ctx.stroke();
    if (major) {
      ctx.fillStyle = accent;
      ctx.fillText(String(h_ / 10).padStart(2, '0'), x - 5, 14);
    }
  }
  // Heading arrow
  ctx.fillStyle = accent;
  ctx.beginPath();
  ctx.moveTo(cx, 32);
  ctx.lineTo(cx - 6, 40);
  ctx.lineTo(cx + 6, 40);
  ctx.closePath();
  ctx.fill();

  // Spectrum strip at bottom (status)
  const sx = 60, sw = w - 120, sy = h - 50, sh = 30;
  ctx.strokeStyle = accent + '44';
  ctx.strokeRect(sx, sy, sw, sh);
  const N = 32;
  const bw = sw / N;
  for (let i = 0; i < N; i++) {
    const v = bins[i] || 0;
    ctx.fillStyle = accent + 'aa';
    ctx.fillRect(sx + i * bw + 1, sy + sh - v * sh, bw - 2, v * sh);
  }
  ctx.fillStyle = accent;
  ctx.fillText('SPEC.LOCK', sx, sy - 6);

  // Corner labels
  ctx.fillStyle = accent;
  ctx.fillText('▲ HUB.001', 16, 16);
  ctx.fillText(`AUX ${(bass * 100).toFixed(0).padStart(3, '0')}`, w - 90, 16);
  ctx.fillText(`T+${t.toFixed(2)}`, w - 90, h - 12);
  // Lock indicator on kick
  if (kick > 0.3) {
    ctx.strokeStyle = accent2;
    ctx.lineWidth = 2;
    ctx.strokeRect(cx - 36, cy - 36, 72, 72);
  }
});

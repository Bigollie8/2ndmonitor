// Cassette — animated tape deck, reels rotate w/ bass, VU meters.
// Migrated from the built-in style of the same name.
//
// Note: the original creates its spectrum reader with makeSpectrumReader(64,
// ...) — the task table listed no bins K for this style, but the label's
// volume-bar row DOES read reader.out[i], just only for i in 0..31
// (barCount=32, half of the 64-entry reader). So bins K here is 64 — matching
// the reader's own size — and only the first 32 entries get drawn, exactly
// as the original only ever looked at half of what it built.
//
// f.track and f.playback are both nullable — null whenever nothing is loaded
// or playing (and that's what the smoke suite sends). The original read them
// through refs (`trackRef.current?.title ?? 'NOW PLAYING'`,
// `playbackRef.current?.duration ?? 0`); ported here as plain null-checks
// since the sandbox delivers fresh track/playback on every frame already.

function fmtTime(seconds) {
  if (!isFinite(seconds) || seconds <= 0) return '—';
  const total = Math.floor(seconds);
  return `${Math.floor(total / 60)}:${(total % 60).toString().padStart(2, '0')}`;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y); ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r); ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h); ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r); ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

function drawReel(ctx, cx, cy, r, rot, color) {
  // Outer hub
  ctx.fillStyle = '#1a1f28';
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
  // Tape spool
  ctx.fillStyle = '#0a0c12';
  ctx.beginPath(); ctx.arc(cx, cy, r * 0.82, 0, Math.PI * 2); ctx.fill();
  // Spokes
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(rot);
  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  for (let i = 0; i < 3; i++) {
    ctx.rotate((Math.PI * 2) / 3);
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(r * 0.7, 0); ctx.stroke();
  }
  ctx.restore();
  // Center
  ctx.fillStyle = color;
  ctx.beginPath(); ctx.arc(cx, cy, 5, 0, Math.PI * 2); ctx.fill();
}

function drawVU(ctx, x, y, w, h, level, color, label) {
  ctx.fillStyle = '#000';
  ctx.fillRect(x, y, w, h);
  const segments = 24;
  const lit = Math.floor(level * segments * 4);
  for (let i = 0; i < segments; i++) {
    const isHot = i > segments * 0.75;
    const c = isHot ? '#fb7185' : (i > segments * 0.55 ? color : color + 'aa');
    ctx.fillStyle = i < lit ? c : '#0a0c10';
    ctx.fillRect(x + i * (w / segments) + 1, y + 1, w / segments - 2, h - 2);
  }
  ctx.fillStyle = color;
  ctx.font = '9px JetBrains Mono, monospace';
  ctx.fillText(label, x - 12, y + 11);
}

let reel = 0;

viz.on('frame', (f) => {
  const ctx = f.ctx;
  if (!ctx) return;
  const w = f.size.width;
  const h = f.size.height;
  if (w <= 0 || h <= 0) return;
  const bass = f.bands.bass;
  const mid = f.bands.mid;
  const treble = f.bands.treble;
  const accent = f.theme.accent;
  const accent2 = f.theme.accent2;
  const bins = viz.bins(64);
  reel += 0.04 + bass * 0.08;

  // Background — wood grain
  const bgGrad = ctx.createLinearGradient(0, 0, 0, h);
  bgGrad.addColorStop(0, '#2a1a08');
  bgGrad.addColorStop(1, '#1a0e02');
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, w, h);
  for (let y = 0; y < h; y += 4) {
    ctx.fillStyle = `rgba(0,0,0,${0.05 + Math.sin(y * 0.5) * 0.04})`;
    ctx.fillRect(0, y, w, 1);
  }

  // Cassette body — fit to the canvas while keeping a real-cassette
  // aspect ratio of ~10:6. Pick the limiting dimension and let the body
  // claim ~92% of it; the other dimension follows from the ratio.
  const ASPECT = 10 / 6;
  const maxW = w * 0.94;
  const maxH = h * 0.86;
  let bw, bh;
  if (maxW / ASPECT <= maxH) { bw = maxW; bh = bw / ASPECT; }
  else                       { bh = maxH; bw = bh * ASPECT; }
  const bx = (w - bw) / 2, by = (h - bh) / 2;
  // u = scale unit: 1u ≈ 1% of body width — every fixed-pixel constant
  // below was tuned at the old 600px-wide body, hence /600.
  const u = bw / 100;
  ctx.fillStyle = '#08090d';
  roundRect(ctx, bx, by, bw, bh, u * 1.6); ctx.fill();
  // Inner label area
  const labelPadX = u * 5;
  const labelPadY = u * 3;
  const labelH = bh * 0.42;
  ctx.fillStyle = accent + '22';
  roundRect(ctx, bx + labelPadX, by + labelPadY, bw - labelPadX * 2, labelH, u * 0.8); ctx.fill();
  const titleSize = Math.max(12, u * 2.6);
  const subSize = Math.max(10, u * 2);
  ctx.fillStyle = accent;
  ctx.font = `bold ${titleSize}px JetBrains Mono, monospace`;
  // Headline: "SIDE A · <track length>" — falls back to bare "SIDE A"
  // (no trailing separator) when no duration is reported, e.g. before GSMTC
  // syncs, or whenever nothing is playing (f.playback is null).
  const dur = f.playback ? f.playback.duration : 0;
  const lengthLabel = dur > 0 ? fmtTime(dur) : '';
  const headline = lengthLabel ? `SIDE A · ${lengthLabel}` : 'SIDE A';
  ctx.fillText(headline, bx + labelPadX + u * 2, by + labelPadY + titleSize + u);
  ctx.font = `${subSize}px JetBrains Mono, monospace`;
  ctx.fillStyle = accent + 'aa';
  // Subline: track title in caps (cassette label aesthetic), or 'NOW PLAYING'
  // when f.track is null. Truncate visually with ellipsis when the canvas
  // can't fit the full string.
  const rawTitle = (f.track ? f.track.title : 'NOW PLAYING').toUpperCase();
  const subMaxW = bw - labelPadX * 2 - u * 4;
  let subText = rawTitle;
  if (ctx.measureText(rawTitle).width > subMaxW) {
    // Trim until it fits with an ellipsis appended.
    let end = rawTitle.length;
    while (end > 1 && ctx.measureText(rawTitle.slice(0, end) + '…').width > subMaxW) end--;
    subText = rawTitle.slice(0, end) + '…';
  }
  ctx.fillText(subText, bx + labelPadX + u * 2, by + labelPadY + titleSize + subSize + u * 2.5);
  // Volume bars in label — span the full label width
  const barCount = 32;
  const barAreaX = bx + labelPadX + u * 2;
  const barAreaW = bw - labelPadX * 2 - u * 4;
  const barW = Math.max(2, barAreaW / barCount * 0.55);
  const barGap = barAreaW / barCount;
  const barBaseY = by + labelPadY + labelH - u * 2;
  for (let i = 0; i < barCount; i++) {
    const v = bins[i] || 0;
    const x = barAreaX + i * barGap;
    const barH = v * (labelH * 0.4);
    ctx.fillStyle = accent + 'dd';
    ctx.fillRect(x, barBaseY - barH, barW, barH);
  }

  // Two reels — scaled to body size, sitting in the lower window of the body
  const reelR = Math.min(bw * 0.085, bh * 0.18);
  const reelOffset = bw * 0.16;
  const reelY = by + bh - bh * 0.27;
  drawReel(ctx, bx + reelOffset, reelY, reelR, reel, accent2);
  drawReel(ctx, bx + bw - reelOffset, reelY, reelR, -reel, accent2);

  // Tape between reels
  ctx.strokeStyle = '#2a2018';
  ctx.lineWidth = Math.max(2, u * 0.6);
  ctx.beginPath();
  ctx.moveTo(bx + reelOffset + reelR, reelY);
  ctx.lineTo(bx + bw - reelOffset - reelR, reelY);
  ctx.stroke();

  // Bottom — VU meters L/R, sitting just under the body
  const meterY = Math.min(by + bh + u, h - u * 4);
  const meterH = Math.max(10, u * 2.5);
  const meterPad = u * 5;
  const meterGap = u * 2;
  const meterW = (bw - meterPad * 2 - meterGap) / 2;
  drawVU(ctx, bx + meterPad, meterY, meterW, meterH, mid, accent, 'L');
  drawVU(ctx, bx + meterPad + meterW + meterGap, meterY, meterW, meterH, treble, accent, 'R');
});

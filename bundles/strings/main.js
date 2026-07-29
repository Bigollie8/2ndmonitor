// Strings — physically-modeled vibrating strings, pluck on onsets.
// Migrated from the built-in style of the same name.
//
// Note: the task table listed strings as driving off bands/onset only (no
// bins K). That's wrong — each string continuously excites off its own
// spectrum bin (reader.out[s.idx]). The original reader size is N=32
// (makeSpectrumReader(N, ...) where N=32), so bins K is 32.
function hex2(n) {
  return Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
}

const STRINGS = 7;
const N = 32;

// Each string is tied to one freq band & one onset, so kicks pluck the
// bass strings, snares pluck the mid strings, hats pluck the high strings.
// Old code only plucked on kick (strings 0–2) and snare (strings 3+) — and
// with snare onsets rarely firing, the top half of the fretboard sat dead.
const strings = [];
for (let i = 0; i < STRINGS; i++) {
  strings.push({
    amp: 0,
    vel: 0,
    phase: 0,
    freq: 4 + i * 1.5,
    idx: Math.floor(i * (N / STRINGS)),
    // 0–1 = bass/kick, 2–4 = mid/snare, 5–6 = treble/hat
    onset: (i < 2 ? 'kick' : i < 5 ? 'snare' : 'hat'),
  });
}
let lastOnset = { kick: 0, snare: 0, hat: 0 };

viz.on('frame', (f) => {
  const ctx = f.ctx;
  if (!ctx) return;
  const w = f.size.width;
  const h = f.size.height;
  if (w <= 0 || h <= 0) return;
  const kick = f.onset.kick;
  const snare = f.onset.snare;
  const hat = f.onset.hat;
  const accent = f.theme.accent;
  const accent2 = f.theme.accent2;
  const bins = viz.bins(N);

  // Background
  const grad = ctx.createLinearGradient(0, 0, w, h);
  grad.addColorStop(0, '#06070a');
  grad.addColorStop(1, '#0a0c14');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  // Pluck strings on onset edges (rising past a low threshold). Edge-
  // detect against the prior frame's value so a sustained kick doesn't
  // pluck every frame — only the *transition* from quiet to loud counts.
  const triggers = {
    kick:  kick  > 0.18 && lastOnset.kick  < 0.08,
    snare: snare > 0.18 && lastOnset.snare < 0.08,
    hat:   hat   > 0.18 && lastOnset.hat   < 0.08,
  };
  for (let i = 0; i < STRINGS; i++) {
    if (triggers[strings[i].onset]) {
      const strength = strings[i].onset === 'kick' ? kick
                     : strings[i].onset === 'snare' ? snare
                     : hat;
      strings[i].vel += 0.4 + strength * 0.8 + Math.random() * 0.3;
    }
  }
  lastOnset = { kick, snare, hat };

  // Update + draw strings
  const margin = 60;
  const space = (h - margin * 2) / (STRINGS - 1);
  for (let i = 0; i < STRINGS; i++) {
    const s = strings[i];
    // Physics
    s.amp += s.vel * 0.2;
    s.vel -= s.amp * 0.05;
    s.amp *= 0.96;
    s.vel *= 0.97;
    s.phase += s.freq * 0.4;
    // Continuous excitation from this string's own spectrum bin —
    // subtract the silence floor (~0.04) so quiet passages stay quiet
    // instead of pumping every string with constant low-level energy.
    const spec = Math.max(0, (bins[s.idx] || 0) - 0.05);
    s.amp += spec * 0.07;

    const y = margin + i * space;
    const segments = 80;
    ctx.beginPath();
    ctx.moveTo(40, y);
    for (let x = 0; x <= segments; x++) {
      const px = 40 + (x / segments) * (w - 80);
      const env = Math.sin((x / segments) * Math.PI);
      const py = y + Math.sin(x * 0.4 + s.phase) * s.amp * env * 30;
      ctx.lineTo(px, py);
    }
    const intensity = Math.min(1, Math.abs(s.amp) * 4);
    // Color tracks the string's onset family — bass=accent, mid/treble=accent2
    const col = s.onset === 'kick' ? accent : accent2;
    ctx.strokeStyle = col + hex2(120 + intensity * 135);
    ctx.lineWidth = 1 + intensity * 2.5;
    ctx.shadowColor = col;
    ctx.shadowBlur = 4 + intensity * 12;
    ctx.stroke();
    ctx.shadowBlur = 0;
  }

  // Frets / nuts
  ctx.strokeStyle = 'rgba(255,255,255,0.1)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(40, margin - 10);
  ctx.lineTo(40, h - margin + 10);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(w - 40, margin - 10);
  ctx.lineTo(w - 40, h - margin + 10);
  ctx.stroke();
});

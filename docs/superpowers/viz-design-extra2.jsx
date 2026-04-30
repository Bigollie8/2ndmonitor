// Premium / detailed visualizers — more elaborate, more specific
// Each takes { accent, accent2 }

function useFakeSpectrum2(n = 64) {
  const specRef = React.useRef(new Float32Array(n));
  const bassRef = React.useRef(0);
  const midRef = React.useRef(0);
  const trebleRef = React.useRef(0);
  const onsetRef = React.useRef({ kick: 0, snare: 0, hat: 0 });
  const tRef = React.useRef(0);
  React.useEffect(() => {
    let raf = 0;
    let beatPhase = 0;
    const tick = () => {
      tRef.current += 0.04;
      const t = tRef.current;
      beatPhase += 0.04;
      // 120 bpm = 2 beats/sec, beat every 0.5s. dt=0.04 → ~12.5 ticks/beat
      const beatT = (beatPhase % 0.5) / 0.5;
      const kick = beatT < 0.08 ? Math.exp(-beatT * 30) : 0;
      const snare = (beatPhase % 0.5) > 0.25 && (beatPhase % 0.5) < 0.27 ? 1 : 0;
      const hat = (beatPhase * 4) % 1 < 0.04 ? 0.6 : 0;
      onsetRef.current = { kick, snare, hat };

      let bass = 0, mid = 0, treble = 0;
      for (let i = 0; i < n; i++) {
        const x = i / n;
        const env = Math.pow(1 - x, 1.2) * 0.55 + 0.18;
        const a = Math.sin(t * 1.6 + i * 0.18) * 0.18;
        const b = Math.sin(t * 0.7 + i * 0.05) * 0.12;
        const c = Math.sin(t * 4.2 + i * 1.1) * 0.06;
        const noise = (Math.sin(i * 1.7 + t) * 0.5 + Math.cos(i * 0.9 + t * 2) * 0.5) * 0.08;
        // Add bass on kick
        const kickBoost = i < 8 ? kick * 0.6 : 0;
        const snareBoost = i > 12 && i < 28 ? snare * 0.4 : 0;
        const hatBoost = i > 40 ? hat * 0.3 : 0;
        const v = Math.max(0.02, Math.min(1, env + a + b + c + noise + kickBoost + snareBoost + hatBoost));
        specRef.current[i] = v;
        if (i < 8) bass += v;
        else if (i < 32) mid += v;
        else treble += v;
      }
      bassRef.current = bassRef.current * 0.7 + (bass / 8) * 0.3;
      midRef.current = midRef.current * 0.7 + (mid / 24) * 0.3;
      trebleRef.current = trebleRef.current * 0.7 + (treble / 32) * 0.3;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  return { specRef, bassRef, midRef, trebleRef, onsetRef, tRef };
}

// ─────────────────────────────────────────────────────────────────
// 1. STARFIELD — bass-warped 3D starfield, kick-pulse depth flash
// ─────────────────────────────────────────────────────────────────
function VizStarfield({ accent, accent2 }) {
  const canvasRef = React.useRef(null);
  const { bassRef, onsetRef, tRef } = useFakeSpectrum2(32);
  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let raf = 0;
    const dpr = window.devicePixelRatio || 1;
    const resize = () => {
      const r = canvas.parentElement.getBoundingClientRect();
      canvas.width = r.width * dpr; canvas.height = r.height * dpr;
      canvas.style.width = r.width + 'px'; canvas.style.height = r.height + 'px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize); ro.observe(canvas.parentElement);

    const N = 360;
    const stars = Array.from({ length: N }, () => ({
      x: (Math.random() - 0.5) * 2, y: (Math.random() - 0.5) * 2, z: Math.random() * 1 + 0.001,
      hue: Math.random(),
    }));

    const draw = () => {
      const w = canvas.width / dpr, h = canvas.height / dpr;
      const cx = w / 2, cy = h / 2;
      const bass = bassRef.current;
      const kick = onsetRef.current.kick;
      // Trail
      ctx.fillStyle = `rgba(6,7,10,${0.18 + kick * 0.2})`;
      ctx.fillRect(0, 0, w, h);
      // Kick flash
      if (kick > 0.5) {
        const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, w / 2);
        grad.addColorStop(0, `${accent}${Math.round(kick * 100).toString(16).padStart(2, '0')}`);
        grad.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, w, h);
      }
      const speed = 0.005 + bass * 0.04;
      for (const s of stars) {
        s.z -= speed;
        if (s.z <= 0) { s.x = (Math.random() - 0.5) * 2; s.y = (Math.random() - 0.5) * 2; s.z = 1; }
        const px = (s.x / s.z) * (w / 2) + cx;
        const py = (s.y / s.z) * (h / 2) + cy;
        const size = (1 - s.z) * 3;
        const alpha = (1 - s.z) * 0.9;
        const c = s.hue > 0.5 ? accent : accent2;
        ctx.fillStyle = c + Math.round(alpha * 255).toString(16).padStart(2, '0');
        ctx.fillRect(px - size / 2, py - size / 2, size, size);
        // Trail line for fast stars
        if (s.z < 0.4) {
          ctx.strokeStyle = c + Math.round(alpha * 80).toString(16).padStart(2, '0');
          ctx.lineWidth = size * 0.6;
          const tx = (s.x / (s.z + speed * 4)) * (w / 2) + cx;
          const ty = (s.y / (s.z + speed * 4)) * (h / 2) + cy;
          ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(tx, ty); ctx.stroke();
        }
      }
      raf = requestAnimationFrame(draw);
    };
    draw();
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, [accent, accent2]);
  return <canvas ref={canvasRef} style={{ position: 'absolute', inset: 0, display: 'block' }} />;
}

// ─────────────────────────────────────────────────────────────────
// 2. PERLIN FLOW — flow field of glowing particles steered by bass
// ─────────────────────────────────────────────────────────────────
function VizPerlinFlow({ accent, accent2 }) {
  const canvasRef = React.useRef(null);
  const { bassRef, midRef, tRef } = useFakeSpectrum2(32);
  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let raf = 0;
    const dpr = window.devicePixelRatio || 1;
    const resize = () => {
      const r = canvas.parentElement.getBoundingClientRect();
      canvas.width = r.width * dpr; canvas.height = r.height * dpr;
      canvas.style.width = r.width + 'px'; canvas.style.height = r.height + 'px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize); ro.observe(canvas.parentElement);

    // pseudo perlin
    const noise = (x, y, t) =>
      Math.sin(x * 0.6 + Math.cos(y * 0.5 + t * 0.4)) * Math.cos(y * 0.7 + Math.sin(x * 0.4 + t * 0.3));

    const N = 220;
    const parts = Array.from({ length: N }, () => ({
      x: Math.random(), y: Math.random(), age: Math.random() * 100, hue: Math.random(),
    }));

    const draw = () => {
      const w = canvas.width / dpr, h = canvas.height / dpr;
      const t = tRef.current;
      const bass = bassRef.current;
      ctx.fillStyle = 'rgba(6,7,10,0.06)';
      ctx.fillRect(0, 0, w, h);
      ctx.globalCompositeOperation = 'lighter';
      for (const p of parts) {
        const angle = noise(p.x * 5, p.y * 5, t) * Math.PI * 2;
        const speed = 0.003 + bass * 0.012;
        p.x += Math.cos(angle) * speed;
        p.y += Math.sin(angle) * speed;
        p.age += 1;
        if (p.x < 0 || p.x > 1 || p.y < 0 || p.y > 1 || p.age > 200) {
          p.x = Math.random(); p.y = Math.random(); p.age = 0; p.hue = Math.random();
        }
        const c = p.hue > 0.5 ? accent : accent2;
        const a = Math.min(1, (1 - Math.abs(p.age - 100) / 100));
        ctx.fillStyle = c + Math.round(a * 200).toString(16).padStart(2, '0');
        const size = 2 + bass * 4;
        ctx.beginPath();
        ctx.arc(p.x * w, p.y * h, size, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalCompositeOperation = 'source-over';
      raf = requestAnimationFrame(draw);
    };
    draw();
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, [accent, accent2]);
  return <canvas ref={canvasRef} style={{ position: 'absolute', inset: 0, display: 'block' }} />;
}

// ─────────────────────────────────────────────────────────────────
// 3. ORBITAL — stacked rotating rings with frequency markers + comet
// ─────────────────────────────────────────────────────────────────
function VizOrbital({ accent, accent2 }) {
  const canvasRef = React.useRef(null);
  const { specRef, bassRef, tRef, onsetRef } = useFakeSpectrum2(64);
  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let raf = 0;
    const dpr = window.devicePixelRatio || 1;
    const resize = () => {
      const r = canvas.parentElement.getBoundingClientRect();
      canvas.width = r.width * dpr; canvas.height = r.height * dpr;
      canvas.style.width = r.width + 'px'; canvas.style.height = r.height + 'px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize); ro.observe(canvas.parentElement);

    const draw = () => {
      const w = canvas.width / dpr, h = canvas.height / dpr;
      const cx = w / 2, cy = h / 2;
      const t = tRef.current;
      const bass = bassRef.current;
      const kick = onsetRef.current.kick;
      const baseR = Math.min(w, h) * 0.18;
      ctx.fillStyle = 'rgba(6,7,10,0.18)';
      ctx.fillRect(0, 0, w, h);

      // Center sun
      const sunR = baseR * 0.5 * (1 + bass * 0.4 + kick * 0.3);
      const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, sunR);
      grad.addColorStop(0, accent + 'ff');
      grad.addColorStop(0.5, accent + '88');
      grad.addColorStop(1, accent + '00');
      ctx.fillStyle = grad;
      ctx.beginPath(); ctx.arc(cx, cy, sunR, 0, Math.PI * 2); ctx.fill();

      // 4 rings, each with frequency markers
      const RINGS = 4;
      for (let r = 0; r < RINGS; r++) {
        const radius = baseR * (1.4 + r * 0.55);
        const speed = (r % 2 === 0 ? 1 : -1) * (0.2 + r * 0.1);
        const N = 32;
        // Ring outline
        ctx.strokeStyle = accent2 + '22';
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(cx, cy, radius, 0, Math.PI * 2); ctx.stroke();
        // Markers
        for (let i = 0; i < N; i++) {
          const a = (i / N) * Math.PI * 2 + t * speed;
          const v = specRef.current[(i * (r + 1)) % 64];
          const len = 4 + v * 28 * (1 + r * 0.2);
          const x1 = cx + Math.cos(a) * radius;
          const y1 = cy + Math.sin(a) * radius;
          const x2 = cx + Math.cos(a) * (radius + len);
          const y2 = cy + Math.sin(a) * (radius + len);
          const c = r % 2 === 0 ? accent : accent2;
          ctx.strokeStyle = c + Math.round(v * 230).toString(16).padStart(2, '0');
          ctx.lineWidth = 1.5 + v * 2;
          ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
        }
        // Comet on this ring
        const cometA = t * speed * 1.5;
        const cx_ = cx + Math.cos(cometA) * radius;
        const cy_ = cy + Math.sin(cometA) * radius;
        const cR = 4 + bass * 4;
        ctx.fillStyle = accent2;
        ctx.shadowColor = accent2;
        ctx.shadowBlur = 16;
        ctx.beginPath(); ctx.arc(cx_, cy_, cR, 0, Math.PI * 2); ctx.fill();
        ctx.shadowBlur = 0;
      }
      raf = requestAnimationFrame(draw);
    };
    draw();
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, [accent, accent2]);
  return <canvas ref={canvasRef} style={{ position: 'absolute', inset: 0, display: 'block' }} />;
}

// ─────────────────────────────────────────────────────────────────
// 4. AURORA — soft veils flowing across the screen, treble-driven brightness
// ─────────────────────────────────────────────────────────────────
function VizAurora({ accent, accent2 }) {
  const canvasRef = React.useRef(null);
  const { bassRef, midRef, trebleRef, tRef } = useFakeSpectrum2(32);
  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let raf = 0;
    const dpr = window.devicePixelRatio || 1;
    const resize = () => {
      const r = canvas.parentElement.getBoundingClientRect();
      canvas.width = r.width * dpr; canvas.height = r.height * dpr;
      canvas.style.width = r.width + 'px'; canvas.style.height = r.height + 'px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize); ro.observe(canvas.parentElement);

    const draw = () => {
      const w = canvas.width / dpr, h = canvas.height / dpr;
      const t = tRef.current;
      const bass = bassRef.current;
      const mid = midRef.current;
      const treble = trebleRef.current;
      // Sky base
      const sky = ctx.createLinearGradient(0, 0, 0, h);
      sky.addColorStop(0, '#020308');
      sky.addColorStop(0.7, '#06070a');
      sky.addColorStop(1, '#0c0d12');
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, w, h);

      // Stars
      for (let i = 0; i < 60; i++) {
        const sx = (i * 73) % w;
        const sy = ((i * 37) % (h * 0.6));
        const s = (Math.sin(t * 2 + i) + 1) * 0.5;
        ctx.fillStyle = `rgba(255,255,255,${0.15 + s * 0.4})`;
        ctx.fillRect(sx, sy, 1, 1);
      }

      // Aurora veils — 3 layers
      ctx.globalCompositeOperation = 'screen';
      const VEILS = [
        { color: accent, speed: 0.2, freq: 0.6, amp: 0.3, opacity: 0.55 + treble * 0.35 },
        { color: accent2, speed: 0.13, freq: 0.4, amp: 0.45, opacity: 0.45 + mid * 0.3 },
        { color: accent, speed: 0.08, freq: 0.25, amp: 0.55, opacity: 0.3 + bass * 0.4 },
      ];
      for (const v of VEILS) {
        ctx.beginPath();
        const baseY = h * 0.45;
        const points = 80;
        ctx.moveTo(0, h);
        for (let i = 0; i <= points; i++) {
          const x = (i / points) * w;
          const wav = Math.sin(i * v.freq + t * v.speed * 5) * 0.5 + Math.cos(i * v.freq * 0.4 + t * v.speed * 3) * 0.5;
          const y = baseY + wav * h * v.amp - h * 0.1;
          ctx.lineTo(x, y);
        }
        ctx.lineTo(w, h); ctx.closePath();
        const grad = ctx.createLinearGradient(0, 0, 0, h);
        grad.addColorStop(0, v.color + '00');
        grad.addColorStop(0.4, v.color + Math.round(v.opacity * 60).toString(16).padStart(2, '0'));
        grad.addColorStop(0.7, v.color + Math.round(v.opacity * 200).toString(16).padStart(2, '0'));
        grad.addColorStop(1, v.color + '00');
        ctx.fillStyle = grad;
        ctx.fill();
      }
      ctx.globalCompositeOperation = 'source-over';

      // Mountain silhouette at bottom
      ctx.fillStyle = '#000';
      ctx.beginPath();
      ctx.moveTo(0, h);
      for (let x = 0; x <= w; x += 12) {
        const y = h * 0.85 + Math.sin(x * 0.012) * 14 + Math.cos(x * 0.006) * 22;
        ctx.lineTo(x, y);
      }
      ctx.lineTo(w, h); ctx.closePath(); ctx.fill();

      raf = requestAnimationFrame(draw);
    };
    draw();
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, [accent, accent2]);
  return <canvas ref={canvasRef} style={{ position: 'absolute', inset: 0, display: 'block' }} />;
}

// ─────────────────────────────────────────────────────────────────
// 5. CITY EQUALIZER — skyline silhouette w/ neon windows lighting on freq
// ─────────────────────────────────────────────────────────────────
function VizCityEqualizer({ accent, accent2 }) {
  const canvasRef = React.useRef(null);
  const { specRef, bassRef, tRef } = useFakeSpectrum2(64);
  const buildingsRef = React.useRef(null);
  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let raf = 0;
    const dpr = window.devicePixelRatio || 1;
    const resize = () => {
      const r = canvas.parentElement.getBoundingClientRect();
      canvas.width = r.width * dpr; canvas.height = r.height * dpr;
      canvas.style.width = r.width + 'px'; canvas.style.height = r.height + 'px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      // Generate buildings
      const w = r.width, h = r.height;
      const buildings = [];
      let x = 0;
      let i = 0;
      while (x < w + 40) {
        const bw = 32 + Math.random() * 60;
        const bh = h * (0.25 + Math.random() * 0.55);
        buildings.push({ x, w: bw, h: bh, freqIdx: i % 64, depth: Math.random() < 0.3 ? 1 : 0 });
        x += bw + 4;
        i++;
      }
      buildingsRef.current = buildings;
    };
    resize();
    const ro = new ResizeObserver(resize); ro.observe(canvas.parentElement);

    const draw = () => {
      const w = canvas.width / dpr, h = canvas.height / dpr;
      const t = tRef.current;
      const bass = bassRef.current;
      // Sky
      const sky = ctx.createLinearGradient(0, 0, 0, h);
      sky.addColorStop(0, '#0a0612');
      sky.addColorStop(0.5, '#1a0822');
      sky.addColorStop(1, accent + '22');
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, w, h);

      // Moon
      const moonX = w * 0.78, moonY = h * 0.22;
      const moonR = 28 + bass * 8;
      const grad = ctx.createRadialGradient(moonX, moonY, 0, moonX, moonY, moonR * 2.5);
      grad.addColorStop(0, accent2 + 'ff');
      grad.addColorStop(0.4, accent2 + '40');
      grad.addColorStop(1, accent2 + '00');
      ctx.fillStyle = grad;
      ctx.beginPath(); ctx.arc(moonX, moonY, moonR * 2.5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = accent2;
      ctx.beginPath(); ctx.arc(moonX, moonY, moonR, 0, Math.PI * 2); ctx.fill();

      // Buildings - back layer
      const buildings = buildingsRef.current || [];
      // Background buildings
      ctx.fillStyle = '#000';
      for (const b of buildings) {
        if (b.depth === 1) {
          ctx.fillRect(b.x, h - b.h * 0.7, b.w, b.h * 0.7);
        }
      }
      // Foreground buildings
      for (const b of buildings) {
        if (b.depth === 0) {
          const v = specRef.current[b.freqIdx] || 0;
          const liftY = h - b.h - v * 12;
          // Building body
          ctx.fillStyle = '#000';
          ctx.fillRect(b.x, liftY, b.w, h - liftY);
          // Edge glow
          ctx.fillStyle = accent + Math.round(v * 200).toString(16).padStart(2, '0');
          ctx.fillRect(b.x, liftY - 1, b.w, 2);
          // Windows lit by freq
          const cols = Math.max(2, Math.floor(b.w / 10));
          const rows = Math.max(3, Math.floor(b.h / 14));
          for (let cx = 0; cx < cols; cx++) {
            for (let cy = 0; cy < rows; cy++) {
              const seed = (b.x + cx * 13 + cy * 7) | 0;
              const onChance = Math.sin(seed) * 0.5 + 0.5;
              const litByMusic = v > onChance * 0.6;
              if (litByMusic || onChance > 0.85) {
                const wx = b.x + 4 + cx * (b.w - 8) / cols;
                const wy = liftY + 6 + cy * (b.h - 12) / rows;
                ctx.fillStyle = litByMusic
                  ? accent + 'ff'
                  : `rgba(255,220,160,${0.4 + Math.sin(t + seed) * 0.2})`;
                ctx.fillRect(wx, wy, 3, 4);
              }
            }
          }
        }
      }
      // Ground reflection haze
      const hgrad = ctx.createLinearGradient(0, h * 0.85, 0, h);
      hgrad.addColorStop(0, accent + '00');
      hgrad.addColorStop(1, accent + '33');
      ctx.fillStyle = hgrad;
      ctx.fillRect(0, h * 0.85, w, h * 0.15);

      raf = requestAnimationFrame(draw);
    };
    draw();
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, [accent, accent2]);
  return <canvas ref={canvasRef} style={{ position: 'absolute', inset: 0, display: 'block' }} />;
}

// ─────────────────────────────────────────────────────────────────
// 6. STRINGS — physically-modeled vibrating strings, pluck on onsets
// ─────────────────────────────────────────────────────────────────
function VizStrings({ accent, accent2 }) {
  const canvasRef = React.useRef(null);
  const { specRef, onsetRef, tRef } = useFakeSpectrum2(32);
  const stringsRef = React.useRef(null);
  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let raf = 0;
    const dpr = window.devicePixelRatio || 1;
    const resize = () => {
      const r = canvas.parentElement.getBoundingClientRect();
      canvas.width = r.width * dpr; canvas.height = r.height * dpr;
      canvas.style.width = r.width + 'px'; canvas.style.height = r.height + 'px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize); ro.observe(canvas.parentElement);

    const STRINGS = 7;
    if (!stringsRef.current) {
      stringsRef.current = Array.from({ length: STRINGS }, (_, i) => ({
        amp: 0, vel: 0, phase: 0, freq: 4 + i * 1.5, idx: Math.floor(i * (32 / STRINGS)),
      }));
    }
    let lastKick = 0;

    const draw = () => {
      const w = canvas.width / dpr, h = canvas.height / dpr;
      const t = tRef.current;
      const kick = onsetRef.current.kick;
      const snare = onsetRef.current.snare;
      // Background
      const grad = ctx.createLinearGradient(0, 0, w, h);
      grad.addColorStop(0, '#06070a');
      grad.addColorStop(1, '#0a0c14');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);

      // Pluck strings on onsets
      if (kick > 0.4 && lastKick < 0.1) {
        for (let i = 0; i < 3; i++) stringsRef.current[i].vel += 0.5 + Math.random() * 0.5;
      }
      if (snare > 0.3) {
        for (let i = 3; i < STRINGS; i++) stringsRef.current[i].vel += 0.4;
      }
      lastKick = kick;

      // Update + draw strings
      const margin = 60;
      const space = (h - margin * 2) / (STRINGS - 1);
      for (let i = 0; i < STRINGS; i++) {
        const s = stringsRef.current[i];
        // Physics
        s.amp += s.vel * 0.2;
        s.vel -= s.amp * 0.05;
        s.amp *= 0.96;
        s.vel *= 0.97;
        s.phase += s.freq * 0.4;
        // Continuous excitation from spectrum
        const spec = specRef.current[s.idx] || 0;
        s.amp += spec * 0.03;

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
        const col = i < 3 ? accent : accent2;
        ctx.strokeStyle = col + Math.round(120 + intensity * 135).toString(16).padStart(2, '0');
        ctx.lineWidth = 1 + intensity * 2.5;
        ctx.shadowColor = col;
        ctx.shadowBlur = 4 + intensity * 12;
        ctx.stroke();
        ctx.shadowBlur = 0;
      }

      // Frets / nuts
      ctx.strokeStyle = 'rgba(255,255,255,0.1)';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(40, margin - 10); ctx.lineTo(40, h - margin + 10); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(w - 40, margin - 10); ctx.lineTo(w - 40, h - margin + 10); ctx.stroke();

      raf = requestAnimationFrame(draw);
    };
    draw();
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, [accent, accent2]);
  return <canvas ref={canvasRef} style={{ position: 'absolute', inset: 0, display: 'block' }} />;
}

// ─────────────────────────────────────────────────────────────────
// 7. HUD — fictional aircraft heads-up display, freq as instruments
// ─────────────────────────────────────────────────────────────────
function VizHUD({ accent, accent2 }) {
  const canvasRef = React.useRef(null);
  const { specRef, bassRef, midRef, trebleRef, tRef, onsetRef } = useFakeSpectrum2(32);
  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let raf = 0;
    const dpr = window.devicePixelRatio || 1;
    const resize = () => {
      const r = canvas.parentElement.getBoundingClientRect();
      canvas.width = r.width * dpr; canvas.height = r.height * dpr;
      canvas.style.width = r.width + 'px'; canvas.style.height = r.height + 'px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize); ro.observe(canvas.parentElement);

    const draw = () => {
      const w = canvas.width / dpr, h = canvas.height / dpr;
      const t = tRef.current;
      const bass = bassRef.current;
      const mid = midRef.current;
      const treble = trebleRef.current;
      const kick = onsetRef.current.kick;
      ctx.fillStyle = '#02050a';
      ctx.fillRect(0, 0, w, h);

      ctx.strokeStyle = accent;
      ctx.fillStyle = accent;
      ctx.lineWidth = 1;
      ctx.font = '11px JetBrains Mono, monospace';

      // Center reticle
      const cx = w / 2, cy = h / 2;
      ctx.strokeStyle = accent + 'cc';
      ctx.beginPath(); ctx.arc(cx, cy, 30, 0, Math.PI * 2); ctx.stroke();
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
        ctx.fillText(String(p * 10).padStart(2, '0'), cx - 160, py + 4);
      }

      // Left tape (altitude = bass)
      const altitude = Math.floor(8000 + bass * 4000);
      drawTape(ctx, accent, 30, cy, altitude, 'ALT');

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
        if (major) ctx.fillText(String(h_ / 10).padStart(2, '0'), x - 5, 14);
      }
      // Heading arrow
      ctx.fillStyle = accent;
      ctx.beginPath();
      ctx.moveTo(cx, 32); ctx.lineTo(cx - 6, 40); ctx.lineTo(cx + 6, 40); ctx.closePath();
      ctx.fill();

      // Spectrum strip at bottom (status)
      const sx = 60, sw = w - 120, sy = h - 50, sh = 30;
      ctx.strokeStyle = accent + '44';
      ctx.strokeRect(sx, sy, sw, sh);
      const N = 32;
      const bw = sw / N;
      for (let i = 0; i < N; i++) {
        const v = specRef.current[i] || 0;
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

      raf = requestAnimationFrame(draw);
    };
    function drawTape(ctx, color, x, y, val, label, right = false) {
      const tapeH = 200, tapeW = 50;
      const tx = right ? x - tapeW : x;
      ctx.strokeStyle = color + '88';
      ctx.strokeRect(tx, y - tapeH/2, tapeW, tapeH);
      ctx.fillStyle = color + '22';
      ctx.fillRect(tx, y - tapeH/2, tapeW, tapeH);
      ctx.fillStyle = color;
      ctx.font = 'bold 14px JetBrains Mono, monospace';
      ctx.fillText(String(val), tx + 4, y + 4);
      ctx.font = '9px JetBrains Mono, monospace';
      ctx.fillText(label, tx + 4, y + 18);
      // ticks
      for (let i = -5; i <= 5; i++) {
        const ty = y + i * 18;
        if (ty < y - tapeH/2 || ty > y + tapeH/2) continue;
        ctx.strokeStyle = color + (i === 0 ? 'ff' : '44');
        ctx.beginPath();
        ctx.moveTo(right ? tx : tx + tapeW, ty);
        ctx.lineTo(right ? tx + 6 : tx + tapeW - 6, ty);
        ctx.stroke();
      }
    }
    draw();
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, [accent, accent2]);
  return <canvas ref={canvasRef} style={{ position: 'absolute', inset: 0, display: 'block' }} />;
}

// ─────────────────────────────────────────────────────────────────
// 8. LIQUID — fluid metaballs / lava lamp, bass merges blobs
// ─────────────────────────────────────────────────────────────────
function VizLiquid({ accent, accent2 }) {
  const canvasRef = React.useRef(null);
  const { bassRef, midRef, tRef } = useFakeSpectrum2(16);
  const blobsRef = React.useRef(null);
  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let raf = 0;
    const dpr = window.devicePixelRatio || 1;
    const resize = () => {
      const r = canvas.parentElement.getBoundingClientRect();
      canvas.width = r.width * dpr; canvas.height = r.height * dpr;
      canvas.style.width = r.width + 'px'; canvas.style.height = r.height + 'px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize); ro.observe(canvas.parentElement);

    if (!blobsRef.current) {
      blobsRef.current = Array.from({ length: 7 }, () => ({
        x: Math.random(), y: Math.random(),
        vx: (Math.random() - 0.5) * 0.001,
        vy: (Math.random() - 0.5) * 0.001,
        r: 60 + Math.random() * 80,
      }));
    }

    const draw = () => {
      const w = canvas.width / dpr, h = canvas.height / dpr;
      const t = tRef.current;
      const bass = bassRef.current;
      const mid = midRef.current;
      // Background
      const grad = ctx.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0, '#020308');
      grad.addColorStop(1, '#080a14');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);

      // Update blobs
      const blobs = blobsRef.current;
      for (const b of blobs) {
        b.x += b.vx + Math.sin(t * 0.3 + b.r) * 0.0008;
        b.y += b.vy + Math.cos(t * 0.4 + b.r) * 0.0008;
        if (b.x < 0 || b.x > 1) b.vx *= -1;
        if (b.y < 0 || b.y > 1) b.vy *= -1;
      }

      // Render with cumulative gradients (fake metaballs)
      ctx.globalCompositeOperation = 'screen';
      for (const b of blobs) {
        const r = b.r * (1 + bass * 0.6);
        const px = b.x * w, py = b.y * h;
        const grad = ctx.createRadialGradient(px, py, 0, px, py, r);
        const col = b.r > 100 ? accent : accent2;
        grad.addColorStop(0, col + 'cc');
        grad.addColorStop(0.5, col + '55');
        grad.addColorStop(1, col + '00');
        ctx.fillStyle = grad;
        ctx.beginPath(); ctx.arc(px, py, r, 0, Math.PI * 2); ctx.fill();
      }
      ctx.globalCompositeOperation = 'source-over';

      // Highlight ripples
      ctx.globalCompositeOperation = 'screen';
      for (let i = 0; i < 3; i++) {
        const ripT = (t + i * 1.5) % 3;
        const ripR = ripT * Math.min(w, h) * 0.5;
        const a = (1 - ripT / 3) * mid * 0.5;
        ctx.strokeStyle = accent + Math.round(a * 255).toString(16).padStart(2, '0');
        ctx.lineWidth = 1 + a * 3;
        ctx.beginPath();
        ctx.arc(w / 2, h / 2, ripR, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.globalCompositeOperation = 'source-over';

      raf = requestAnimationFrame(draw);
    };
    draw();
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, [accent, accent2]);
  return <canvas ref={canvasRef} style={{ position: 'absolute', inset: 0, display: 'block' }} />;
}

// ─────────────────────────────────────────────────────────────────
// 9. CASSETTE — animated tape deck, reels rotate w/ bass, VU meters
// ─────────────────────────────────────────────────────────────────
function VizCassette({ accent, accent2 }) {
  const canvasRef = React.useRef(null);
  const { bassRef, midRef, trebleRef, specRef, tRef } = useFakeSpectrum2(32);
  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let raf = 0;
    const dpr = window.devicePixelRatio || 1;
    const resize = () => {
      const r = canvas.parentElement.getBoundingClientRect();
      canvas.width = r.width * dpr; canvas.height = r.height * dpr;
      canvas.style.width = r.width + 'px'; canvas.style.height = r.height + 'px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize); ro.observe(canvas.parentElement);

    let reel = 0;
    const draw = () => {
      const w = canvas.width / dpr, h = canvas.height / dpr;
      const t = tRef.current;
      const bass = bassRef.current;
      const mid = midRef.current;
      const treble = trebleRef.current;
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

      // Cassette body — dark plastic
      const bw = w * 0.78, bh = h * 0.55;
      const bx = (w - bw) / 2, by = (h - bh) / 2 - 10;
      ctx.fillStyle = '#08090d';
      roundRect(ctx, bx, by, bw, bh, 8); ctx.fill();
      // Inner label area
      const labelH = bh * 0.35;
      ctx.fillStyle = accent + '22';
      roundRect(ctx, bx + 30, by + 16, bw - 60, labelH, 4); ctx.fill();
      ctx.fillStyle = accent;
      ctx.font = 'bold 14px JetBrains Mono, monospace';
      ctx.fillText('SIDE A · 60min', bx + 42, by + 36);
      ctx.font = '11px JetBrains Mono, monospace';
      ctx.fillStyle = accent + 'aa';
      ctx.fillText('NOW PLAYING', bx + 42, by + 54);
      // Volume bars in label
      for (let i = 0; i < 32; i++) {
        const v = specRef.current[i] || 0;
        const x = bx + 42 + i * 6;
        const barH = v * 16;
        ctx.fillStyle = accent + 'dd';
        ctx.fillRect(x, by + 70 - barH, 4, barH);
      }

      // Two reels
      const reelY = by + bh - 70;
      const reelR = 40;
      drawReel(ctx, bx + 90, reelY, reelR, reel, accent2);
      drawReel(ctx, bx + bw - 90, reelY, reelR, -reel, accent2);

      // Tape between reels
      ctx.strokeStyle = '#2a2018';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(bx + 90 + reelR, reelY);
      ctx.lineTo(bx + bw - 90 - reelR, reelY);
      ctx.stroke();

      // Bottom — VU meters L/R
      const meterY = by + bh + 18;
      const meterH = 14;
      drawVU(ctx, bx + 30, meterY, bw / 2 - 50, meterH, mid, accent, 'L');
      drawVU(ctx, bx + bw / 2 + 20, meterY, bw / 2 - 50, meterH, treble, accent, 'R');

      raf = requestAnimationFrame(draw);
    };

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
        const a = i / segments;
        const isHot = i > segments * 0.75;
        const c = isHot ? '#fb7185' : (i > segments * 0.55 ? color : color + 'aa');
        ctx.fillStyle = i < lit ? c : '#0a0c10';
        ctx.fillRect(x + i * (w / segments) + 1, y + 1, w / segments - 2, h - 2);
      }
      ctx.fillStyle = color;
      ctx.font = '9px JetBrains Mono, monospace';
      ctx.fillText(label, x - 12, y + 11);
    }
    draw();
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, [accent, accent2]);
  return <canvas ref={canvasRef} style={{ position: 'absolute', inset: 0, display: 'block' }} />;
}

// ─────────────────────────────────────────────────────────────────
// 10. CONSTELLATION — particles draw lines when near, bass = magnetism
// ─────────────────────────────────────────────────────────────────
function VizConstellation({ accent, accent2 }) {
  const canvasRef = React.useRef(null);
  const { bassRef, midRef, tRef } = useFakeSpectrum2(16);
  const partsRef = React.useRef(null);
  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let raf = 0;
    const dpr = window.devicePixelRatio || 1;
    const resize = () => {
      const r = canvas.parentElement.getBoundingClientRect();
      canvas.width = r.width * dpr; canvas.height = r.height * dpr;
      canvas.style.width = r.width + 'px'; canvas.style.height = r.height + 'px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize); ro.observe(canvas.parentElement);

    if (!partsRef.current) {
      partsRef.current = Array.from({ length: 70 }, () => ({
        x: Math.random(), y: Math.random(),
        vx: (Math.random() - 0.5) * 0.0008,
        vy: (Math.random() - 0.5) * 0.0008,
        r: 1 + Math.random() * 2,
      }));
    }

    const draw = () => {
      const w = canvas.width / dpr, h = canvas.height / dpr;
      const t = tRef.current;
      const bass = bassRef.current;
      const mid = midRef.current;
      ctx.fillStyle = '#020308';
      ctx.fillRect(0, 0, w, h);

      const parts = partsRef.current;
      const cx = w / 2, cy = h / 2;
      for (const p of parts) {
        // Magnet to center on bass
        const dx = 0.5 - p.x;
        const dy = 0.5 - p.y;
        p.vx += dx * bass * 0.0005;
        p.vy += dy * bass * 0.0005;
        // Drift
        p.x += p.vx + Math.sin(t * 0.5 + p.r * 7) * 0.0002;
        p.y += p.vy + Math.cos(t * 0.4 + p.r * 5) * 0.0002;
        // Bounce
        if (p.x < 0 || p.x > 1) p.vx *= -1;
        if (p.y < 0 || p.y > 1) p.vy *= -1;
        p.x = Math.max(0, Math.min(1, p.x));
        p.y = Math.max(0, Math.min(1, p.y));
        p.vx *= 0.99; p.vy *= 0.99;
      }

      // Connect nearby
      const threshold = 0.18 + mid * 0.12;
      ctx.lineWidth = 1;
      for (let i = 0; i < parts.length; i++) {
        for (let j = i + 1; j < parts.length; j++) {
          const a = parts[i], b = parts[j];
          const ddx = a.x - b.x, ddy = a.y - b.y;
          const d = Math.sqrt(ddx * ddx + ddy * ddy);
          if (d < threshold) {
            const alpha = (1 - d / threshold) * 0.7;
            ctx.strokeStyle = accent + Math.round(alpha * 200).toString(16).padStart(2, '0');
            ctx.beginPath();
            ctx.moveTo(a.x * w, a.y * h);
            ctx.lineTo(b.x * w, b.y * h);
            ctx.stroke();
          }
        }
      }

      // Particles
      for (const p of parts) {
        const px = p.x * w, py = p.y * h;
        ctx.fillStyle = accent2;
        ctx.shadowColor = accent2;
        ctx.shadowBlur = 8 + bass * 12;
        ctx.beginPath();
        ctx.arc(px, py, p.r * (1 + bass * 0.8), 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
      }

      raf = requestAnimationFrame(draw);
    };
    draw();
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, [accent, accent2]);
  return <canvas ref={canvasRef} style={{ position: 'absolute', inset: 0, display: 'block' }} />;
}

// Add to global registry
(function() {
  const NEW = [
    { id: 'starfield',    label: 'Starfield',    desc: 'Hyperspace · kick-flash bursts',     comp: VizStarfield },
    { id: 'perlin',       label: 'Perlin flow',  desc: 'Noise-field particles · drifting',   comp: VizPerlinFlow },
    { id: 'orbital',      label: 'Orbital',      desc: 'Sun + 4 reactive frequency rings',   comp: VizOrbital },
    { id: 'aurora',       label: 'Aurora',       desc: 'Veils over moonlit horizon',         comp: VizAurora },
    { id: 'city',         label: 'Neon city',    desc: 'Skyline w/ frequency-lit windows',   comp: VizCityEqualizer },
    { id: 'strings',      label: 'Strings',      desc: 'Plucked physical strings',           comp: VizStrings },
    { id: 'hud',          label: 'Aircraft HUD', desc: 'Reticle · pitch ladder · tapes',     comp: VizHUD },
    { id: 'liquid',       label: 'Liquid',       desc: 'Metaball lava · bass merges',        comp: VizLiquid },
    { id: 'cassette',     label: 'Cassette',     desc: 'Tape deck · reels · VU meters',      comp: VizCassette },
    { id: 'constellation',label: 'Constellation',desc: 'Particles connect when near',        comp: VizConstellation },
  ];
  if (window.VIZ_STYLES) window.VIZ_STYLES.push(...NEW);
})();

Object.assign(window, {
  VizStarfield, VizPerlinFlow, VizOrbital, VizAurora, VizCityEqualizer,
  VizStrings, VizHUD, VizLiquid, VizCassette, VizConstellation,
});

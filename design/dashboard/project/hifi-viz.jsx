// Hi-fi visualizer renderers — production-quality, theme-aware via CSS vars.
// Uses --accent and --accent2 from the document root for theme-linked color.

const HiFiViz = {};

// ── Bars: smooth animated spectrum w/ peak holds ─────────────────────────────
function HiFiVizBars({ accent, accent2, count = 64, intensity = 1 }) {
  const barsRef = React.useRef([]);
  const peaksRef = React.useRef(new Array(count).fill(0));
  const rafRef = React.useRef(0);

  React.useEffect(() => {
    let t = 0;
    const tick = () => {
      t += 0.04;
      for (let i = 0; i < count; i++) {
        const x = i / count;
        // bass-heavy envelope + multi-frequency animation
        const env = Math.pow(1 - x, 1.2) * 0.55 + 0.18;
        const a = Math.sin(t * 1.6 + i * 0.18) * 0.18;
        const b = Math.sin(t * 0.7 + i * 0.05) * 0.12;
        const c = Math.sin(t * 4.2 + i * 1.1) * 0.06;
        const noise = (Math.sin(i * 1.7 + t) * 0.5 + Math.cos(i * 0.9 + t * 2) * 0.5) * 0.08;
        let h = Math.max(0.04, Math.min(1, (env + a + b + c + noise) * intensity));
        const bar = barsRef.current[i];
        if (bar) bar.style.transform = `scaleY(${h})`;
        if (peaksRef.current[i] < h) peaksRef.current[i] = h;
        else peaksRef.current[i] = Math.max(h, peaksRef.current[i] - 0.008);
        const peak = barsRef.current[i + count];
        if (peak) peak.style.transform = `translateY(${-peaksRef.current[i] * 100}%)`;
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [count, intensity]);

  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'flex-end', justifyContent: 'center', gap: '0.4%', padding: '8% 4% 12%' }}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} style={{ flex: 1, height: '100%', position: 'relative', display: 'flex', alignItems: 'flex-end' }}>
          <div ref={el => barsRef.current[i] = el} style={{
            width: '100%', height: '100%', transformOrigin: 'bottom',
            background: `linear-gradient(180deg, ${accent} 0%, ${accent2} 100%)`,
            borderRadius: '2px 2px 0 0',
            filter: `drop-shadow(0 0 8px ${accent}66)`,
            transform: 'scaleY(0.1)',
            transition: 'background 0.4s',
          }} />
          <div ref={el => barsRef.current[i + count] = el} style={{
            position: 'absolute', left: 0, right: 0, bottom: 0, height: 2,
            background: accent, borderRadius: 1, opacity: 0.85,
            boxShadow: `0 0 8px ${accent}`,
            transition: 'background 0.4s',
          }} />
        </div>
      ))}
    </div>
  );
}

// ── Waveform: smooth oscilloscope ────────────────────────────────────────────
function HiFiVizWaveform({ accent, accent2 }) {
  const ref = React.useRef(null);
  const ref2 = React.useRef(null);
  React.useEffect(() => {
    let t = 0;
    let raf = 0;
    const tick = () => {
      t += 0.05;
      const N = 200;
      const pts = [];
      for (let i = 0; i < N; i++) {
        const x = (i / (N - 1)) * 100;
        const wave = Math.sin(i * 0.18 + t) * 14
          + Math.sin(i * 0.07 + t * 0.7) * 8
          + Math.sin(i * 0.5 + t * 2.1) * 3;
        const env = Math.sin(i * 0.04 + t * 0.3) * 0.5 + 0.7;
        pts.push(`${x},${50 + wave * env}`);
      }
      const d = pts.join(' ');
      if (ref.current) ref.current.setAttribute('points', d);
      if (ref2.current) ref2.current.setAttribute('points', d);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  return (
    <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" style={{ position: 'absolute', inset: 0 }}>
      <defs>
        <linearGradient id="wf-grad" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor={accent2} />
          <stop offset="1" stopColor={accent} />
        </linearGradient>
      </defs>
      <polyline ref={ref2} fill="none" stroke="url(#wf-grad)" strokeWidth="4" vectorEffect="non-scaling-stroke" opacity="0.3" filter="blur(2px)" />
      <polyline ref={ref} fill="none" stroke="url(#wf-grad)" strokeWidth="1.6" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

// ── Radial: bars wrapped in a circle, slow rotation ──────────────────────────
function HiFiVizRadial({ accent, accent2 }) {
  const linesRef = React.useRef([]);
  const groupRef = React.useRef(null);
  const N = 96;
  React.useEffect(() => {
    let t = 0;
    let raf = 0;
    const tick = () => {
      t += 0.03;
      if (groupRef.current) groupRef.current.setAttribute('transform', `rotate(${t * 8})`);
      for (let i = 0; i < N; i++) {
        const x = i / N;
        const a = Math.sin(t * 1.5 + i * 0.3) * 0.2;
        const b = Math.sin(t * 0.8 + x * Math.PI * 8) * 0.25;
        const env = 0.35 + Math.sin(x * Math.PI * 4) * 0.15;
        const h = Math.max(0.1, Math.min(1, env + a + b));
        const ln = linesRef.current[i];
        if (ln) {
          const ang = (i / N) * Math.PI * 2;
          const r1 = 14, r2 = 14 + h * 22;
          ln.setAttribute('x1', Math.cos(ang) * r1);
          ln.setAttribute('y1', Math.sin(ang) * r1);
          ln.setAttribute('x2', Math.cos(ang) * r2);
          ln.setAttribute('y2', Math.sin(ang) * r2);
          ln.setAttribute('opacity', 0.4 + h * 0.6);
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  return (
    <svg width="100%" height="100%" viewBox="-50 -50 100 100" style={{ position: 'absolute', inset: 0 }}>
      <defs>
        <radialGradient id="rd-grad">
          <stop offset="0" stopColor={accent} stopOpacity="0.2" />
          <stop offset="1" stopColor={accent} stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle r="14" fill="url(#rd-grad)" />
      <circle r="13" fill="none" stroke={accent} strokeOpacity="0.25" strokeWidth="0.4" />
      <g ref={groupRef}>
        {Array.from({ length: N }).map((_, i) => (
          <line key={i} ref={el => linesRef.current[i] = el}
            stroke={i % 2 === 0 ? accent : accent2} strokeWidth="0.8" strokeLinecap="round" />
        ))}
      </g>
    </svg>
  );
}

// ── Particles: drifting points reactive to a fake bass ──────────────────────
function HiFiVizParticles({ accent, accent2 }) {
  const ref = React.useRef(null);
  React.useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const resize = () => {
      const r = canvas.getBoundingClientRect();
      canvas.width = r.width * dpr;
      canvas.height = r.height * dpr;
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    const N = 140;
    const pts = Array.from({ length: N }, () => ({
      x: Math.random(), y: Math.random(),
      vx: (Math.random() - 0.5) * 0.0008,
      vy: (Math.random() - 0.5) * 0.0008,
      r: 0.5 + Math.random() * 1.8,
      hue: Math.random(),
    }));
    let t = 0;
    let raf = 0;
    const tick = () => {
      t += 0.02;
      const w = canvas.width, h = canvas.height;
      ctx.clearRect(0, 0, w, h);
      const bass = (Math.sin(t) * 0.5 + 0.5) * 0.5 + 0.3;
      ctx.fillStyle = accent2 + '11';
      ctx.fillRect(0, 0, w, h);
      for (const p of pts) {
        p.x += p.vx + Math.sin(t + p.y * 8) * 0.0006;
        p.y += p.vy + Math.cos(t + p.x * 8) * 0.0006;
        if (p.x < 0) p.x += 1; if (p.x > 1) p.x -= 1;
        if (p.y < 0) p.y += 1; if (p.y > 1) p.y -= 1;
        const px = p.x * w, py = p.y * h;
        const r = p.r * dpr * (0.6 + bass * 1.4);
        const grad = ctx.createRadialGradient(px, py, 0, px, py, r * 4);
        grad.addColorStop(0, p.hue > 0.5 ? accent : accent2);
        grad.addColorStop(1, 'transparent');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(px, py, r * 4, 0, Math.PI * 2);
        ctx.fill();
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, [accent, accent2]);
  return <canvas ref={ref} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} />;
}

// ── Ambient: slow morphing gradient blobs ────────────────────────────────────
function HiFiVizAmbient({ accent, accent2 }) {
  return (
    <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', background: '#06080d' }}>
      <div style={{
        position: 'absolute', inset: '-10%',
        background: `
          radial-gradient(ellipse 50% 40% at 25% 35%, ${accent}77, transparent 65%),
          radial-gradient(ellipse 45% 55% at 75% 60%, ${accent2}77, transparent 65%),
          radial-gradient(ellipse 35% 30% at 50% 85%, ${accent}55, transparent 70%),
          radial-gradient(ellipse 60% 45% at 15% 80%, ${accent2}33, transparent 70%)
        `,
        filter: 'blur(2px) saturate(1.2)',
        animation: 'amb-drift 22s ease-in-out infinite alternate',
      }} />
      <style>{`
        @keyframes amb-drift {
          0% { transform: translate(0, 0) scale(1); }
          50% { transform: translate(3%, -2%) scale(1.08); }
          100% { transform: translate(-2%, 3%) scale(0.95); }
        }
      `}</style>
    </div>
  );
}

function HiFiVizSurface({ mode, accent, accent2 }) {
  if (mode === 'bars') return <HiFiVizBars accent={accent} accent2={accent2} />;
  if (mode === 'waveform') return <HiFiVizWaveform accent={accent} accent2={accent2} />;
  if (mode === 'radial') return <HiFiVizRadial accent={accent} accent2={accent2} />;
  if (mode === 'particles') return <HiFiVizParticles accent={accent} accent2={accent2} />;
  if (mode === 'ambient') return <HiFiVizAmbient accent={accent} accent2={accent2} />;
  return null;
}

Object.assign(window, { HiFiVizBars, HiFiVizWaveform, HiFiVizRadial, HiFiVizParticles, HiFiVizAmbient, HiFiVizSurface });

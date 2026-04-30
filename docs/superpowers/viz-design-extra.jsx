// More equalizer / visualizer styles. Each takes { accent, accent2 }.

function useFakeSpectrum(n = 64) {
  const specRef = React.useRef(new Float32Array(n));
  const bassRef = React.useRef(0);
  const tRef = React.useRef(0);
  React.useEffect(() => {
    let raf = 0;
    const tick = () => {
      tRef.current += 0.04;
      const t = tRef.current;
      let bassSum = 0;
      for (let i = 0; i < n; i++) {
        const x = i / n;
        const env = Math.pow(1 - x, 1.2) * 0.55 + 0.18;
        const a = Math.sin(t * 1.6 + i * 0.18) * 0.18;
        const b = Math.sin(t * 0.7 + i * 0.05) * 0.12;
        const c = Math.sin(t * 4.2 + i * 1.1) * 0.06;
        const noise = (Math.sin(i * 1.7 + t) * 0.5 + Math.cos(i * 0.9 + t * 2) * 0.5) * 0.08;
        const v = Math.max(0.04, Math.min(1, (env + a + b + c + noise)));
        specRef.current[i] = v;
        if (i < 6) bassSum += v;
      }
      bassRef.current = bassRef.current * 0.7 + (bassSum / 6) * 0.3;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  return { specRef, bassRef, tRef };
}

// 1. NEON BARS — glowing mirrored bars
function VizNeonBars({ accent, accent2 }) {
  const N = 56;
  const barsRef = React.useRef([]);
  const { specRef } = useFakeSpectrum(N);
  React.useEffect(() => {
    let raf = 0;
    const tick = () => {
      for (let i = 0; i < N; i++) {
        const v = specRef.current[i];
        const el = barsRef.current[i];
        if (el) el.style.transform = `scaleY(${v})`;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  return (
    <div style={{ position: 'absolute', inset: 0, background: '#020308', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ width: '92%', height: '70%', display: 'flex', alignItems: 'flex-end', gap: '0.4%' }}>
        {Array.from({ length: N }).map((_, i) => (
          <div key={i} ref={el => barsRef.current[i] = el} style={{
            flex: 1, height: '100%', transformOrigin: 'bottom center',
            background: `linear-gradient(0deg, ${accent2}, ${accent})`,
            boxShadow: `0 0 16px ${accent}, 0 0 32px ${accent2}55`,
            borderRadius: 2,
          }} />
        ))}
      </div>
    </div>
  );
}

// 2. SPLIT MIRROR — center line, gradient bars top + bottom
function VizSplitMirror({ accent, accent2 }) {
  const N = 80;
  const barsRef = React.useRef([]);
  const { specRef } = useFakeSpectrum(N);
  React.useEffect(() => {
    let raf = 0;
    const tick = () => {
      for (let i = 0; i < N; i++) {
        const v = specRef.current[i];
        const el = barsRef.current[i];
        if (el) el.style.transform = `scaleY(${v})`;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  return (
    <div style={{ position: 'absolute', inset: 0, background: '#06070a', overflow: 'hidden' }}>
      <div style={{ position: 'absolute', top: '50%', left: 0, right: 0, height: 1, background: `${accent}88`, boxShadow: `0 0 8px ${accent}` }} />
      <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ width: '88%', height: '80%', display: 'flex', alignItems: 'center', gap: '0.4%' }}>
          {Array.from({ length: N }).map((_, i) => (
            <div key={i} ref={el => barsRef.current[i] = el} style={{
              flex: 1, height: '100%',
              background: `linear-gradient(180deg, transparent, ${accent} 45%, ${accent} 55%, transparent)`,
              borderRadius: 1,
            }} />
          ))}
        </div>
      </div>
    </div>
  );
}

// 3. CIRCULAR PULSE — radial bars + bass disc
function VizCircularPulse({ accent, accent2 }) {
  const N = 96;
  const linesRef = React.useRef([]);
  const discRef = React.useRef(null);
  const { specRef, bassRef } = useFakeSpectrum(N);
  React.useEffect(() => {
    let raf = 0;
    const tick = () => {
      for (let i = 0; i < N; i++) {
        const el = linesRef.current[i];
        if (el) {
          el.setAttribute('stroke-width', 2 + specRef.current[i] * 6);
          el.setAttribute('stroke-opacity', 0.3 + specRef.current[i] * 0.7);
        }
      }
      const d = discRef.current;
      if (d) d.setAttribute('r', 60 + bassRef.current * 80);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  return (
    <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(circle at center, #0a0c14 0%, #02030a 100%)' }}>
      <svg viewBox="-200 -200 400 400" preserveAspectRatio="xMidYMid meet" style={{ width: '100%', height: '100%' }}>
        <defs>
          <radialGradient id="cp-disc" cx="0.5" cy="0.5">
            <stop offset="0%" stopColor={accent2} stopOpacity="0.7" />
            <stop offset="60%" stopColor={accent} stopOpacity="0.3" />
            <stop offset="100%" stopColor={accent} stopOpacity="0" />
          </radialGradient>
        </defs>
        <circle ref={discRef} cx="0" cy="0" r="60" fill="url(#cp-disc)" />
        {Array.from({ length: N }).map((_, i) => {
          const a = (i / N) * Math.PI * 2;
          return (
            <line key={i} ref={el => linesRef.current[i] = el}
              x1={Math.cos(a) * 90} y1={Math.sin(a) * 90}
              x2={Math.cos(a) * 170} y2={Math.sin(a) * 170}
              stroke={i % 8 === 0 ? accent2 : accent} strokeLinecap="round" />
          );
        })}
      </svg>
    </div>
  );
}

// 4. WAVEFORM TUNNEL — layered waveforms w/ depth blur
function VizWaveformTunnel({ accent, accent2 }) {
  const refs = React.useRef([]);
  React.useEffect(() => {
    let raf = 0; let t = 0;
    const tick = () => {
      t += 0.04;
      for (let l = 0; l < 6; l++) {
        const ref = refs.current[l];
        if (!ref) continue;
        const phase = l * 0.6;
        const amp = 30 + l * 6;
        const points = [];
        for (let i = 0; i <= 80; i++) {
          const x = (i / 80) * 100;
          const y = 50 + Math.sin(t * 1.5 + i * 0.3 + phase) * amp * 0.4
                       + Math.sin(t * 0.7 + i * 0.1 + phase) * amp * 0.3;
          points.push(`${x},${y}`);
        }
        ref.setAttribute('d', `M ${points.join(' L ')}`);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  return (
    <div style={{ position: 'absolute', inset: 0, background: '#04050a' }}>
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ width: '100%', height: '100%' }}>
        {Array.from({ length: 6 }).map((_, l) => (
          <path key={l} ref={el => refs.current[l] = el} fill="none"
            stroke={l % 2 === 0 ? accent : accent2}
            strokeWidth={0.4 + (6 - l) * 0.15}
            strokeOpacity={(1 - l / 6) * 0.9}
            style={{ filter: `blur(${l * 0.6}px)` }}
            d="M 0,50 L 100,50" />
        ))}
      </svg>
    </div>
  );
}

// 5. PIXEL LED — retro LED grid w/ heat colors
function VizPixelLED({ accent, accent2 }) {
  const N = 32, ROWS = 20;
  const cellRefs = React.useRef([]);
  const { specRef } = useFakeSpectrum(N);
  React.useEffect(() => {
    let raf = 0;
    const tick = () => {
      for (let i = 0; i < N; i++) {
        const v = specRef.current[i];
        const lit = Math.floor(v * ROWS);
        for (let r = 0; r < ROWS; r++) {
          const cell = cellRefs.current[i * ROWS + r];
          if (!cell) continue;
          const isLit = (ROWS - r) <= lit;
          const heatRow = (ROWS - r) / ROWS;
          if (isLit) {
            const color = heatRow > 0.85 ? '#ef4444' : heatRow > 0.65 ? accent2 : accent;
            cell.style.background = color;
            cell.style.boxShadow = `0 0 6px ${color}`;
            cell.style.opacity = '1';
          } else {
            cell.style.background = 'rgba(255,255,255,0.04)';
            cell.style.boxShadow = 'none';
            cell.style.opacity = '0.6';
          }
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [accent, accent2]);
  return (
    <div style={{ position: 'absolute', inset: 0, background: '#020306', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ width: '88%', height: '78%', display: 'grid', gridTemplateColumns: `repeat(${N}, 1fr)`, gap: '2px' }}>
        {Array.from({ length: N }).map((_, i) => (
          <div key={i} style={{ display: 'grid', gridTemplateRows: `repeat(${ROWS}, 1fr)`, gap: '2px' }}>
            {Array.from({ length: ROWS }).map((_, r) => (
              <div key={r} ref={el => cellRefs.current[i * ROWS + r] = el} style={{ borderRadius: 1 }} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

// 6. RIBBON — filled symmetric ribbon
function VizRibbon({ accent, accent2 }) {
  const N = 48;
  const pathRef = React.useRef(null);
  const { specRef } = useFakeSpectrum(N);
  React.useEffect(() => {
    let raf = 0;
    const tick = () => {
      const top = [], bot = [];
      for (let i = 0; i < N; i++) {
        const x = (i / (N - 1)) * 100;
        const v = specRef.current[i];
        top.push(`${x},${50 - v * 36}`);
        bot.push(`${x},${50 + v * 36}`);
      }
      const d = `M ${top.join(' L ')} L ${bot.reverse().join(' L ')} Z`;
      if (pathRef.current) pathRef.current.setAttribute('d', d);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  return (
    <div style={{ position: 'absolute', inset: 0, background: '#06070a' }}>
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ width: '100%', height: '100%' }}>
        <defs>
          <linearGradient id="rib-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={accent} stopOpacity="0.8" />
            <stop offset="50%" stopColor={accent2} stopOpacity="0.5" />
            <stop offset="100%" stopColor={accent} stopOpacity="0.8" />
          </linearGradient>
        </defs>
        <path ref={pathRef} d="" fill="url(#rib-fill)" />
      </svg>
    </div>
  );
}

// 7. OSCILLOSCOPE — green CRT scope w/ phosphor trail
function VizOscilloscope({ accent, accent2 }) {
  const canvasRef = React.useRef(null);
  React.useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext('2d');
    const resize = () => { c.width = c.clientWidth; c.height = c.clientHeight; };
    resize();
    window.addEventListener('resize', resize);
    let raf = 0; let t = 0;
    const tick = () => {
      t += 0.06;
      ctx.fillStyle = 'rgba(2, 8, 4, 0.18)';
      ctx.fillRect(0, 0, c.width, c.height);
      // Grid
      ctx.strokeStyle = 'rgba(120, 220, 140, 0.06)';
      ctx.lineWidth = 1;
      for (let x = 0; x < c.width; x += c.width / 20) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, c.height); ctx.stroke();
      }
      for (let y = 0; y < c.height; y += c.height / 10) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(c.width, y); ctx.stroke();
      }
      // Trace
      ctx.strokeStyle = accent;
      ctx.shadowBlur = 12;
      ctx.shadowColor = accent;
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let x = 0; x < c.width; x += 2) {
        const u = x / c.width;
        const y = c.height / 2
          + Math.sin(u * Math.PI * 8 + t) * c.height * 0.15
          + Math.sin(u * Math.PI * 24 + t * 2.3) * c.height * 0.08
          + Math.sin(u * Math.PI * 3 + t * 0.6) * c.height * 0.18;
        if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.shadowBlur = 0;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', resize); };
  }, [accent]);
  return (
    <div style={{ position: 'absolute', inset: 0, background: '#020806' }}>
      <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block' }} />
    </div>
  );
}

// 8. SPECTROGRAM — scrolling waterfall heatmap
function VizSpectrogram({ accent, accent2 }) {
  const canvasRef = React.useRef(null);
  const { specRef } = useFakeSpectrum(64);
  React.useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext('2d');
    const resize = () => { c.width = c.clientWidth; c.height = c.clientHeight; };
    resize();
    window.addEventListener('resize', resize);
    let raf = 0;
    const tick = () => {
      // Scroll left
      const img = ctx.getImageData(2, 0, c.width - 2, c.height);
      ctx.putImageData(img, 0, 0);
      // Draw new column on right
      const N = specRef.current.length;
      const colH = c.height / N;
      for (let i = 0; i < N; i++) {
        const v = specRef.current[i];
        const heat = Math.min(1, v * 1.4);
        // Heatmap: dark → accent → accent2 → red-hot
        let r, g, b;
        const a2 = hexToRgb(accent2);
        const a1 = hexToRgb(accent);
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
        ctx.fillRect(c.width - 2, c.height - (i + 1) * colH, 2, colH + 1);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', resize); };
  }, [accent, accent2]);
  return (
    <div style={{ position: 'absolute', inset: 0, background: '#04050a' }}>
      <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block' }} />
    </div>
  );
}

function hexToRgb(hex) {
  const h = hex.replace('#', '');
  const num = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16);
  return { r: (num >> 16) & 255, g: (num >> 8) & 255, b: num & 255 };
}

// 9. VINYL — spinning record w/ tonearm
function VizVinyl({ accent, accent2 }) {
  const ref = React.useRef(null);
  React.useEffect(() => {
    let raf = 0; let r = 0;
    const tick = () => {
      r += 0.6;
      if (ref.current) ref.current.style.transform = `rotate(${r}deg)`;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  return (
    <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(circle at 30% 40%, #1a1a22 0%, #06070a 70%)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ position: 'relative', width: '70%', aspectRatio: '1/1' }}>
        <div ref={ref} style={{
          position: 'absolute', inset: 0, borderRadius: '50%',
          background: `radial-gradient(circle, ${accent2} 0%, ${accent2} 8%, #0a0a0c 8%, #0a0a0c 12%, ${accent} 12%, ${accent} 13%, #0a0a0c 13%, #0a0a0c 18%, repeating-radial-gradient(#0a0a0c, #0a0a0c 1px, #161618 2px, #0a0a0c 3px) 18%)`,
          boxShadow: `0 0 80px ${accent}33, inset 0 0 60px rgba(0,0,0,0.8)`,
        }}>
          <div style={{ position: 'absolute', top: '50%', left: '50%', width: '4%', height: '4%', borderRadius: '50%', background: accent, transform: 'translate(-50%, -50%)', boxShadow: `0 0 20px ${accent}` }} />
        </div>
        {/* Tonearm */}
        <div style={{
          position: 'absolute', top: '8%', right: '-2%',
          width: '60%', height: '6%',
          background: 'linear-gradient(90deg, #2a2a32 0%, #1a1a22 100%)',
          borderRadius: 4,
          transformOrigin: '95% 50%',
          transform: 'rotate(-22deg)',
          boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
        }} />
      </div>
    </div>
  );
}

// 10. KALEIDOSCOPE — symmetric reactive triangles
function VizKaleidoscope({ accent, accent2 }) {
  const refs = React.useRef([]);
  const { specRef, bassRef } = useFakeSpectrum(12);
  React.useEffect(() => {
    let raf = 0; let t = 0;
    const tick = () => {
      t += 0.01;
      for (let i = 0; i < 12; i++) {
        const el = refs.current[i];
        if (!el) continue;
        const v = specRef.current[i];
        el.setAttribute('transform', `rotate(${i * 30 + t * 30}) scale(${0.5 + v * 0.8})`);
        el.setAttribute('opacity', 0.3 + v * 0.6);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  return (
    <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(circle at center, #0a0a14 0%, #02030a 80%)' }}>
      <svg viewBox="-100 -100 200 200" preserveAspectRatio="xMidYMid meet" style={{ width: '100%', height: '100%' }}>
        {Array.from({ length: 12 }).map((_, i) => (
          <polygon key={i} ref={el => refs.current[i] = el}
            points="0,-60 20,0 0,60 -20,0"
            fill={i % 2 === 0 ? accent : accent2}
            opacity="0.5"
            style={{ mixBlendMode: 'screen', filter: `blur(${i % 3}px)` }}
          />
        ))}
      </svg>
    </div>
  );
}

// 11. FREQUENCY GRID — 2D bar grid (frequency vs time history)
function VizFreqGrid({ accent, accent2 }) {
  const COLS = 32, ROWS = 16;
  const histRef = React.useRef(Array.from({ length: COLS }, () => new Array(ROWS).fill(0)));
  const cellRefs = React.useRef([]);
  const { specRef } = useFakeSpectrum(ROWS);
  React.useEffect(() => {
    let raf = 0;
    const tick = () => {
      // Shift history
      for (let c = COLS - 1; c > 0; c--) {
        histRef.current[c] = histRef.current[c - 1];
      }
      histRef.current[0] = Array.from(specRef.current);
      // Render
      for (let c = 0; c < COLS; c++) {
        for (let r = 0; r < ROWS; r++) {
          const el = cellRefs.current[c * ROWS + r];
          if (!el) continue;
          const v = histRef.current[c][r] || 0;
          el.style.opacity = (v * 0.95).toFixed(2);
          el.style.transform = `scale(${0.3 + v * 0.7})`;
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  return (
    <div style={{ position: 'absolute', inset: 0, background: '#04050b', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ width: '88%', height: '78%', display: 'grid', gridTemplateColumns: `repeat(${COLS}, 1fr)`, gap: 4 }}>
        {Array.from({ length: COLS }).map((_, c) => (
          <div key={c} style={{ display: 'grid', gridTemplateRows: `repeat(${ROWS}, 1fr)`, gap: 4 }}>
            {Array.from({ length: ROWS }).map((_, r) => (
              <div key={r} ref={el => cellRefs.current[c * ROWS + r] = el} style={{
                background: r > ROWS * 0.7 ? accent2 : accent,
                borderRadius: 2,
                boxShadow: `0 0 6px ${r > ROWS * 0.7 ? accent2 : accent}66`,
              }} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

// 12. MINIMAL DOTS — three dots size-pulse to bass/mid/treble
function VizMinimalDots({ accent, accent2 }) {
  const refs = React.useRef([]);
  const { specRef } = useFakeSpectrum(16);
  React.useEffect(() => {
    let raf = 0;
    const tick = () => {
      const bands = [
        (specRef.current[0] + specRef.current[1] + specRef.current[2]) / 3,
        (specRef.current[6] + specRef.current[7] + specRef.current[8]) / 3,
        (specRef.current[13] + specRef.current[14] + specRef.current[15]) / 3,
      ];
      for (let i = 0; i < 3; i++) {
        const el = refs.current[i];
        if (!el) continue;
        const s = 0.5 + bands[i] * 1.3;
        el.style.transform = `scale(${s})`;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  const labels = ['BASS', 'MID', 'TREBLE'];
  return (
    <div style={{ position: 'absolute', inset: 0, background: '#06070a', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8%' }}>
      {labels.map((label, i) => (
        <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 24 }}>
          <div ref={el => refs.current[i] = el} style={{
            width: 140, height: 140, borderRadius: '50%',
            background: i === 1 ? accent2 : accent,
            boxShadow: `0 0 80px ${i === 1 ? accent2 : accent}`,
            transition: 'none',
          }} />
          <span style={{ fontSize: 12, fontFamily: 'JetBrains Mono, ui-monospace, monospace', color: 'rgba(255,255,255,0.4)', letterSpacing: '.2em' }}>{label}</span>
        </div>
      ))}
    </div>
  );
}

// Mode registry — id, label, description, component
const VIZ_STYLES = [
  { id: 'bars',         label: 'Bars',         desc: 'Classic spectrum analyzer', comp: window.HiFiVizBars },
  { id: 'waveform',     label: 'Waveform',     desc: 'Smooth oscilloscope',       comp: window.HiFiVizWaveform },
  { id: 'radial',       label: 'Radial',       desc: 'Circular spectrum',         comp: window.HiFiVizRadial },
  { id: 'particles',    label: 'Particles',    desc: 'Drifting points',           comp: window.HiFiVizParticles },
  { id: 'ambient',      label: 'Ambient',      desc: 'Slow morphing blobs',       comp: window.HiFiVizAmbient },
  { id: 'neonbars',     label: 'Neon bars',    desc: 'Glowing solid bars',        comp: VizNeonBars },
  { id: 'splitmirror',  label: 'Split mirror', desc: 'Mirrored bars on a horizon',comp: VizSplitMirror },
  { id: 'circular',     label: 'Circular pulse', desc: 'Radial w/ bass disc',     comp: VizCircularPulse },
  { id: 'tunnel',       label: 'Wave tunnel',  desc: 'Layered depth waveforms',   comp: VizWaveformTunnel },
  { id: 'pixelled',     label: 'Pixel LED',    desc: 'Retro LED matrix · heatmap',comp: VizPixelLED },
  { id: 'ribbon',       label: 'Ribbon',       desc: 'Filled symmetric flow',     comp: VizRibbon },
  { id: 'scope',        label: 'Oscilloscope', desc: 'CRT phosphor trace',        comp: VizOscilloscope },
  { id: 'spectrogram',  label: 'Spectrogram',  desc: 'Scrolling waterfall',       comp: VizSpectrogram },
  { id: 'vinyl',        label: 'Vinyl',        desc: 'Spinning record',           comp: VizVinyl },
  { id: 'kaleidoscope', label: 'Kaleidoscope', desc: 'Symmetric petals',          comp: VizKaleidoscope },
  { id: 'freqgrid',     label: 'Freq grid',    desc: 'Time × frequency cells',    comp: VizFreqGrid },
  { id: 'minimal',      label: 'Minimal dots', desc: 'Bass / Mid / Treble pulse', comp: VizMinimalDots },
];

// Override the surface to look up by id from the registry
function HiFiVizSurfaceExt({ mode, accent, accent2 }) {
  const entry = VIZ_STYLES.find(v => v.id === mode);
  if (!entry || !entry.comp) {
    // Fallback to original surface
    return <window.HiFiVizSurface mode={mode} accent={accent} accent2={accent2} />;
  }
  const C = entry.comp;
  return <C accent={accent} accent2={accent2} />;
}

// Picker UI — grid of small previews
function VizStylePicker({ value, onChange, accent, accent2, onClose }) {
  return (
    <div onClick={onClose} style={{
      position: 'absolute', inset: 0, zIndex: 70,
      background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(12px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        width: 1800, maxHeight: 1200, padding: 40, borderRadius: 18,
        background: 'rgba(15,17,22,0.96)',
        border: '1px solid rgba(255,255,255,0.08)',
        boxShadow: '0 40px 100px rgba(0,0,0,0.6)',
        display: 'flex', flexDirection: 'column',
      }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 16, marginBottom: 8 }}>
          <h2 style={{ fontSize: 28, margin: 0, fontWeight: 700, letterSpacing: '-0.02em' }}>Visualizer style</h2>
          <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', fontFamily: 'JetBrains Mono, ui-monospace, monospace' }}>{VIZ_STYLES.length} styles</span>
          <div style={{ flex: 1 }} />
          <button onClick={onClose} style={{
            padding: '8px 16px', fontSize: 12, color: 'rgba(255,255,255,0.5)',
            background: 'transparent', border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: 6, cursor: 'pointer',
          }}>Esc</button>
        </div>
        <p style={{ fontSize: 14, color: 'rgba(255,255,255,0.55)', margin: '0 0 24px 0' }}>
          Click a style to apply it live. All styles inherit the current theme accent color.
        </p>
        <div style={{ flex: 1, overflow: 'auto', display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, paddingRight: 8 }}>
          {VIZ_STYLES.map(s => (
            <VizStyleCard key={s.id} style={s} active={value === s.id} accent={accent} accent2={accent2}
              onClick={() => onChange(s.id)} />
          ))}
        </div>
      </div>
    </div>
  );
}

function VizStyleCard({ style, active, accent, accent2, onClick }) {
  const C = style.comp;
  return (
    <button onClick={onClick} style={{
      padding: 0, borderRadius: 10, overflow: 'hidden', textAlign: 'left',
      background: active ? `${accent}10` : 'rgba(255,255,255,0.02)',
      border: active ? `2px solid ${accent}` : '2px solid rgba(255,255,255,0.06)',
      cursor: 'pointer', color: '#fff',
      transition: 'transform .15s, border-color .15s',
      transform: active ? 'translateY(-2px)' : 'none',
      boxShadow: active ? `0 12px 30px -10px ${accent}66` : 'none',
    }}>
      <div style={{ position: 'relative', width: '100%', aspectRatio: '16/9', overflow: 'hidden', borderRadius: '8px 8px 0 0', background: '#06070a' }}>
        {C ? <C accent={accent} accent2={accent2} /> : null}
      </div>
      <div style={{ padding: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 2 }}>{style.label}</div>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)' }}>{style.desc}</div>
        </div>
        {active && <span style={{ fontSize: 9, color: accent, padding: '3px 8px', background: `${accent}25`, borderRadius: 3, fontFamily: 'JetBrains Mono, ui-monospace, monospace', letterSpacing: '.05em' }}>● ACTIVE</span>}
      </div>
    </button>
  );
}

Object.assign(window, {
  VizNeonBars, VizSplitMirror, VizCircularPulse, VizWaveformTunnel,
  VizPixelLED, VizRibbon, VizOscilloscope, VizSpectrogram, VizVinyl,
  VizKaleidoscope, VizFreqGrid, VizMinimalDots,
  VIZ_STYLES, HiFiVizSurfaceExt, VizStylePicker, VizStyleCard,
});

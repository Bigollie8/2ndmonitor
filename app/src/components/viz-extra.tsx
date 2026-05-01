import { useEffect, useRef } from 'react';
import { makeSpectrumReader, useAnimateGate, type VizProps } from './viz';

// hexToRgb helper (used by Spectrogram)
function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const h = hex.replace('#', '');
  const num = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return { r: (num >> 16) & 255, g: (num >> 8) & 255, b: num & 255 };
}

// 1. NEON BARS — glowing mirrored bars
export function VizNeonBars({ accent, accent2, spectrumRef, sensitivity = 1, smoothing = 0, paused }: VizProps) {
  const N = 56;
  const barsRef = useRef<(HTMLDivElement | null)[]>([]);
  const gate = useAnimateGate(paused, 'neonbars');
  useEffect(() => {
    const reader = makeSpectrumReader(N, spectrumRef, sensitivity, smoothing);
    let raf = 0;
    const tick = () => {
      if (gate.shouldDraw()) {
        reader.read();
        for (let i = 0; i < N; i++) {
          const v = reader.out[i] ?? 0;
          const el = barsRef.current[i];
          if (el) el.style.transform = `scaleY(${v})`;
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [spectrumRef, sensitivity, smoothing]);
  return (
    <div style={{ position: 'absolute', inset: 0, background: '#020308', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ width: '92%', height: '70%', display: 'flex', alignItems: 'flex-end', gap: '0.4%' }}>
        {Array.from({ length: N }).map((_, i) => (
          <div key={i} ref={(el) => { barsRef.current[i] = el; }} style={{
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
export function VizSplitMirror({ accent, accent2, spectrumRef, sensitivity = 1, smoothing = 0, paused }: VizProps) {
  const N = 80;
  const barsRef = useRef<(HTMLDivElement | null)[]>([]);
  const gate = useAnimateGate(paused, 'splitmirror');
  useEffect(() => {
    const reader = makeSpectrumReader(N, spectrumRef, sensitivity, smoothing);
    let raf = 0;
    const tick = () => {
      if (gate.shouldDraw()) {
        reader.read();
        for (let i = 0; i < N; i++) {
          const v = reader.out[i] ?? 0;
          const el = barsRef.current[i];
          if (el) el.style.transform = `scaleY(${v})`;
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [spectrumRef, sensitivity, smoothing]);
  return (
    <div style={{ position: 'absolute', inset: 0, background: '#06070a', overflow: 'hidden' }}>
      <div style={{ position: 'absolute', top: '50%', left: 0, right: 0, height: 1, background: `${accent}88`, boxShadow: `0 0 8px ${accent}` }} />
      <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ width: '88%', height: '80%', display: 'flex', alignItems: 'center', gap: '0.4%' }}>
          {Array.from({ length: N }).map((_, i) => (
            <div key={i} ref={(el) => { barsRef.current[i] = el; }} style={{
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
export function VizCircularPulse({ accent, accent2, spectrumRef, sensitivity = 1, smoothing = 0, paused }: VizProps) {
  const N = 96;
  const linesRef = useRef<(SVGLineElement | null)[]>([]);
  const discRef = useRef<SVGCircleElement | null>(null);
  const gate = useAnimateGate(paused, 'circular');
  useEffect(() => {
    const reader = makeSpectrumReader(N, spectrumRef, sensitivity, smoothing);
    let raf = 0;
    let bassSm = 0;
    const tick = () => {
      if (gate.shouldDraw()) {
        const bass = reader.read();
        bassSm = bassSm * 0.7 + bass * 0.3;
        for (let i = 0; i < N; i++) {
          const el = linesRef.current[i];
          const v = reader.out[i] ?? 0;
          if (el) {
            el.setAttribute('stroke-width', String(2 + v * 6));
            el.setAttribute('stroke-opacity', String(0.3 + v * 0.7));
          }
        }
        const d = discRef.current;
        if (d) d.setAttribute('r', String(60 + bassSm * 80));
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [spectrumRef, sensitivity, smoothing]);
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
            <line key={i} ref={(el) => { linesRef.current[i] = el; }}
              x1={Math.cos(a) * 90} y1={Math.sin(a) * 90}
              x2={Math.cos(a) * 170} y2={Math.sin(a) * 170}
              stroke={i % 8 === 0 ? accent2 : accent} strokeLinecap="round" />
          );
        })}
      </svg>
    </div>
  );
}

// 4. WAVEFORM TUNNEL — layered waveforms w/ depth blur (pure procedural, no spectrum)
export function VizWaveformTunnel({ accent, accent2, spectrumRef, sensitivity = 1, smoothing = 0, paused }: VizProps) {
  const refs = useRef<(SVGPathElement | null)[]>([]);
  const gate = useAnimateGate(paused, 'tunnel');
  useEffect(() => {
    const reader = makeSpectrumReader(64, spectrumRef, sensitivity, smoothing);
    let raf = 0;
    let t = 0;
    const tick = () => {
      if (gate.shouldDraw()) {
        t += 0.04;
        reader.read();
        const bass = reader.bands.bass;
        const mid = reader.bands.mid;
        const treble = reader.bands.treble;
        for (let l = 0; l < 6; l++) {
          const ref = refs.current[l];
          if (!ref) continue;
          const phase = l * 0.6;
          // Each layer rides a different frequency band. Outer layers (smaller l)
          // track bass, inner layers track higher frequencies.
          const energy = l < 2 ? bass : l < 4 ? mid : treble;
          const amp = (30 + l * 6) * (0.6 + energy * 1.8);
          const points: string[] = [];
          for (let i = 0; i <= 80; i++) {
            const x = (i / 80) * 100;
            // Modulate per-bin via the spectrum so the wave shape itself reacts.
            const spec = reader.out[Math.floor((i / 80) * 64)] ?? 0;
            const y = 50 + Math.sin(t * 1.5 + i * 0.3 + phase) * amp * 0.4
                         + Math.sin(t * 0.7 + i * 0.1 + phase) * amp * 0.3
                         + (spec - 0.5) * amp * 0.5;
            points.push(`${x},${y}`);
          }
          ref.setAttribute('d', `M ${points.join(' L ')}`);
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [spectrumRef, sensitivity, smoothing]);
  return (
    <div style={{ position: 'absolute', inset: 0, background: '#04050a' }}>
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ width: '100%', height: '100%' }}>
        {Array.from({ length: 6 }).map((_, l) => (
          <path key={l} ref={(el) => { refs.current[l] = el; }} fill="none"
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
export function VizPixelLED({ accent, accent2, spectrumRef, sensitivity = 1, smoothing = 0, paused }: VizProps) {
  const N = 32;
  const ROWS = 20;
  const cellRefs = useRef<(HTMLDivElement | null)[]>([]);
  const gate = useAnimateGate(paused, 'pixelled');
  useEffect(() => {
    const reader = makeSpectrumReader(N, spectrumRef, sensitivity, smoothing);
    let raf = 0;
    const tick = () => {
      if (gate.shouldDraw()) {
        reader.read();
        for (let i = 0; i < N; i++) {
          const v = reader.out[i] ?? 0;
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
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [accent, accent2, spectrumRef, sensitivity, smoothing]);
  return (
    <div style={{ position: 'absolute', inset: 0, background: '#020306', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ width: '88%', height: '78%', display: 'grid', gridTemplateColumns: `repeat(${N}, 1fr)`, gap: '2px' }}>
        {Array.from({ length: N }).map((_, i) => (
          <div key={i} style={{ display: 'grid', gridTemplateRows: `repeat(${ROWS}, 1fr)`, gap: '2px' }}>
            {Array.from({ length: ROWS }).map((_, r) => (
              <div key={r} ref={(el) => { cellRefs.current[i * ROWS + r] = el; }} style={{ borderRadius: 1 }} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

// 6. RIBBON — filled symmetric ribbon
export function VizRibbon({ accent, accent2, spectrumRef, sensitivity = 1, smoothing = 0, paused }: VizProps) {
  const N = 48;
  const pathRef = useRef<SVGPathElement | null>(null);
  const gate = useAnimateGate(paused, 'ribbon');
  useEffect(() => {
    const reader = makeSpectrumReader(N, spectrumRef, sensitivity, smoothing);
    let raf = 0;
    const tick = () => {
      if (gate.shouldDraw()) {
        reader.read();
        const top: string[] = [];
        const bot: string[] = [];
        for (let i = 0; i < N; i++) {
          const x = (i / (N - 1)) * 100;
          const v = reader.out[i] ?? 0;
          top.push(`${x},${50 - v * 36}`);
          bot.push(`${x},${50 + v * 36}`);
        }
        const d = `M ${top.join(' L ')} L ${bot.reverse().join(' L ')} Z`;
        if (pathRef.current) pathRef.current.setAttribute('d', d);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [spectrumRef, sensitivity, smoothing]);
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

// 7. OSCILLOSCOPE — CRT phosphor scope, trace driven by audio
export function VizOscilloscope({ accent, spectrumRef, sensitivity = 1, smoothing = 0, paused }: VizProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const gate = useAnimateGate(paused, 'scope');
  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    const resize = () => { c.width = c.clientWidth; c.height = c.clientHeight; };
    resize();
    window.addEventListener('resize', resize);
    const reader = makeSpectrumReader(128, spectrumRef, sensitivity, smoothing);
    let raf = 0;
    let t = 0;
    const tick = () => {
      if (gate.shouldDraw()) {
        t += 0.06;
        reader.read();
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
        // Trace — y combines spectrum-driven amplitude with a slow-moving carrier
        // so it still feels CRT-scope-y rather than just a bar chart.
        const overall = (reader.bands.bass + reader.bands.mid + reader.bands.treble) / 3;
        const amp = c.height * (0.18 + overall * 0.28);
        ctx.strokeStyle = accent;
        ctx.shadowBlur = 12;
        ctx.shadowColor = accent;
        ctx.lineWidth = 2;
        ctx.beginPath();
        for (let x = 0; x < c.width; x += 2) {
          const u = x / c.width;
          const specIdx = Math.min(127, Math.floor(u * 128));
          const sp = (reader.out[specIdx] ?? 0) - 0.5;
          const y = c.height / 2
            + sp * amp * 1.4
            + Math.sin(u * Math.PI * 8 + t) * c.height * 0.05
            + Math.sin(u * Math.PI * 24 + t * 2.3) * c.height * 0.025;
          if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.stroke();
        ctx.shadowBlur = 0;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', resize); };
  }, [accent, spectrumRef, sensitivity, smoothing]);
  return (
    <div style={{ position: 'absolute', inset: 0, background: '#020806' }}>
      <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block' }} />
    </div>
  );
}

// 8. SPECTROGRAM — scrolling waterfall heatmap
export function VizSpectrogram({ accent, accent2, spectrumRef, sensitivity = 1, smoothing = 0, paused }: VizProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const gate = useAnimateGate(paused, 'spectrogram');
  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    const resize = () => { c.width = c.clientWidth; c.height = c.clientHeight; };
    resize();
    window.addEventListener('resize', resize);
    const N = 64;
    const reader = makeSpectrumReader(N, spectrumRef, sensitivity, smoothing);
    const a1 = hexToRgb(accent);
    const a2 = hexToRgb(accent2);
    let raf = 0;
    const tick = () => {
      if (gate.shouldDraw()) {
        reader.read();
        // Scroll left
        const img = ctx.getImageData(2, 0, c.width - 2, c.height);
        ctx.putImageData(img, 0, 0);
        // Draw new column on right
        const colH = c.height / N;
        for (let i = 0; i < N; i++) {
          const v = reader.out[i] ?? 0;
          const heat = Math.min(1, v * 1.4);
          let r: number;
          let g: number;
          let b: number;
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
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', resize); };
  }, [accent, accent2, spectrumRef, sensitivity, smoothing]);
  return (
    <div style={{ position: 'absolute', inset: 0, background: '#04050a' }}>
      <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block' }} />
    </div>
  );
}

// 9. VINYL — spinning record with album art as the label. Disc rotates only
//    while playback is *playing* (so a paused track parks the disc) at a
//    pleasant ~16 rpm — real 33⅓ rpm at 60fps reads as a blur on screen.
//    Bass pulses add a small speed bump; kicks flash the glow ring (which
//    doesn't rotate so the highlight stays anchored). The tonearm is a
//    multi-piece SVG (counterweight + pivot + tube + headshell + cartridge)
//    that swings to a parked angle when not playing.
export function VizVinyl({ accent, accent2, spectrumRef, sensitivity = 1, smoothing = 0, paused, track, playback }: VizProps) {
  const discRef = useRef<HTMLDivElement | null>(null);
  const glowRef = useRef<HTMLDivElement | null>(null);
  const gate = useAnimateGate(paused, 'vinyl');
  // When playback is unknown (no GSMTC sync yet), default to spinning so the
  // viz looks alive on first paint; only stop once we *know* it's paused.
  const isPlaying = playback?.playing !== false;
  useEffect(() => {
    const reader = makeSpectrumReader(64, spectrumRef, sensitivity, smoothing);
    let raf = 0;
    let rot = 0;
    let rotVel = 0;  // angular velocity (deg/frame), eased toward target each frame
    const tick = () => {
      if (gate.shouldDraw()) {
        reader.read();
        const bass = reader.bands.bass;
        const kick = reader.onset.kick;
        // Target ~16 rpm at 60fps (~1.6°/frame), with bass adding up to ~10
        // rpm more. When paused the target ramps to 0 so the disc smoothly
        // winds down instead of stopping mid-stride.
        const target = isPlaying ? (1.6 + bass * 1.0) : 0;
        rotVel += (target - rotVel) * 0.06;
        rot += rotVel;
        const disc = discRef.current;
        if (disc) {
          disc.style.transform = `rotate(${rot}deg)`;
        }
        // Glow ring around the disc reacts to kicks without rotating. Damped
        // when paused so a stopped record reads as quiet.
        const glow = glowRef.current;
        if (glow) {
          const kickEff = isPlaying ? kick : 0;
          const blur = 60 + kickEff * 90;
          const alpha = Math.round((0.18 + kickEff * 0.45) * 255).toString(16).padStart(2, '0');
          glow.style.boxShadow = `0 0 ${blur}px ${accent}${alpha}, inset 0 0 60px rgba(0,0,0,0.8)`;
          const s = 1 + kickEff * 0.04;
          glow.style.transform = `scale(${s})`;
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [accent, spectrumRef, sensitivity, smoothing, isPlaying]);
  // The label is the album-art circle in the middle of the disc. When no art
  // is available (gradient fallback in track.cover), we just use that gradient
  // — it still reads as an "album cover" because the palette is art-derived.
  const labelBg = track?.cover ?? `linear-gradient(135deg, ${accent}, ${accent2})`;
  // Tonearm angle — when playing, the cartridge sits over the record near
  // the outer track; when paused it swings back to a rest position so the
  // headshell is off the disc. CSS transition handles the smooth swing.
  const armAngle = isPlaying ? -22 : -52;
  return (
    <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(circle at 30% 40%, #1a1a22 0%, #06070a 70%)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ position: 'relative', width: 'min(90%, 90vh)', aspectRatio: '1/1' }}>
        {/* Glow ring — sits behind the disc, doesn't rotate, pulses on kicks */}
        <div ref={glowRef} style={{
          position: 'absolute', inset: 0, borderRadius: '50%',
          boxShadow: `0 0 80px ${accent}33, inset 0 0 60px rgba(0,0,0,0.8)`,
          transition: 'box-shadow 60ms linear',
          pointerEvents: 'none',
        }} />
        {/* Disc — rotates as one unit (vinyl + grooves + label) */}
        <div ref={discRef} style={{
          position: 'absolute', inset: 0, borderRadius: '50%',
          // Three layers: a subtle 1px-period groove pattern, an outer black ring,
          // and the dark vinyl base. Keeping these as separate `background-image`
          // layers (not one nested gradient) is what makes the grooves render.
          backgroundImage: `
            repeating-radial-gradient(circle, rgba(255,255,255,0.04) 0 1px, transparent 1px 3px),
            radial-gradient(circle, #0a0a0c 0%, #0a0a0c 96%, #050507 96%, #050507 100%)
          `,
          backgroundColor: '#0a0a0c',
        }}>
          {/* Highlight sheen — sits on top of the rotating disc but masked to the surface */}
          <div style={{
            position: 'absolute', inset: 0, borderRadius: '50%',
            background: 'radial-gradient(ellipse 60% 40% at 30% 30%, rgba(255,255,255,0.08), transparent 70%)',
            pointerEvents: 'none',
          }} />
          {/* Album-art label — circular, ~38% of disc diameter, with center spindle hole */}
          <div style={{
            position: 'absolute', top: '50%', left: '50%',
            width: '38%', height: '38%',
            transform: 'translate(-50%, -50%)',
            borderRadius: '50%',
            background: labelBg,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
            backgroundRepeat: 'no-repeat',
            boxShadow: `inset 0 0 0 2px rgba(0,0,0,0.4), 0 0 24px ${accent}55`,
            overflow: 'hidden',
          }}>
            {/* Spindle hole */}
            <div style={{
              position: 'absolute', top: '50%', left: '50%',
              width: '8%', height: '8%',
              transform: 'translate(-50%, -50%)',
              borderRadius: '50%',
              background: '#06070a',
              boxShadow: 'inset 0 0 4px rgba(0,0,0,0.9)',
            }} />
          </div>
        </div>
        {/* Tonearm assembly — drawn in SVG so all parts (counterweight,
            pivot, arm tube, headshell, cartridge) scale together. The pivot
            sits at viewBox x=92, just past the upper-right edge of the disc.
            transformOrigin '92% 50%' rotates the whole assembly around it. */}
        <svg
          viewBox="0 0 110 14"
          preserveAspectRatio="xMidYMid meet"
          style={{
            position: 'absolute', top: '4%', right: '-6%',
            width: '70%', height: '14%',
            transformOrigin: '83.6% 50%',  // x=92 of 110 ≈ 83.6%
            transform: `rotate(${armAngle}deg)`,
            transition: 'transform 900ms cubic-bezier(0.55, 0.05, 0.4, 1)',
            overflow: 'visible',
            pointerEvents: 'none',
            filter: 'drop-shadow(0 0.4px 1.2px rgba(0,0,0,0.7))',
          }}
        >
          <defs>
            <linearGradient id="vinyl-arm-tube" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#5a5a64" />
              <stop offset="0.45" stopColor="#2a2a34" />
              <stop offset="1" stopColor="#1a1a22" />
            </linearGradient>
            <linearGradient id="vinyl-arm-cw" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#3a3a44" />
              <stop offset="1" stopColor="#0e0e16" />
            </linearGradient>
            <radialGradient id="vinyl-arm-pivot" cx="35%" cy="35%" r="65%">
              <stop offset="0" stopColor="#7a7a86" />
              <stop offset="0.55" stopColor="#2a2a34" />
              <stop offset="1" stopColor="#08080c" />
            </radialGradient>
          </defs>
          {/* Counterweight — chunky cylinder behind the pivot (right of x=92) */}
          <rect x="98" y="4" width="10" height="6" rx="1.4" fill="url(#vinyl-arm-cw)" />
          <line x1="100.5" y1="4.4" x2="100.5" y2="9.6" stroke="rgba(255,255,255,0.08)" strokeWidth="0.3" />
          {/* Arm tube — main length from headshell to pivot */}
          <rect x="9" y="6" width="83" height="2" rx="1" fill="url(#vinyl-arm-tube)" />
          <rect x="9" y="6.1" width="83" height="0.35" fill="rgba(255,255,255,0.18)" />
          {/* Pivot bearing — circular hub at x=92 */}
          <circle cx="92" cy="7" r="3.6" fill="url(#vinyl-arm-pivot)" />
          <circle cx="92" cy="7" r="3.6" fill="none" stroke="rgba(0,0,0,0.5)" strokeWidth="0.3" />
          <circle cx="92" cy="7" r="1" fill="#08080c" />
          {/* Headshell — angled block at the cartridge end (left), with the
              cartridge body hanging just below it */}
          <path d="M 2 4 L 12 5 L 12 9 L 2 10 Z" fill="#1a1a22" stroke="rgba(0,0,0,0.6)" strokeWidth="0.3" />
          <rect x="4" y="9.5" width="6" height="2.6" rx="0.4" fill="#06070a" stroke="rgba(255,255,255,0.06)" strokeWidth="0.2" />
          {/* Stylus tip — accent dot under the cartridge, dim when parked */}
          <circle cx="7" cy="12.6" r="0.35" fill={accent} opacity={isPlaying ? 0.95 : 0.3} />
        </svg>
      </div>
    </div>
  );
}

// 10. KALEIDOSCOPE — symmetric reactive triangles
export function VizKaleidoscope({ accent, accent2, spectrumRef, sensitivity = 1, smoothing = 0, paused }: VizProps) {
  const N = 12;
  const refs = useRef<(SVGPolygonElement | null)[]>([]);
  const gate = useAnimateGate(paused, 'kaleidoscope');
  useEffect(() => {
    const reader = makeSpectrumReader(N, spectrumRef, sensitivity, smoothing);
    let raf = 0;
    let t = 0;
    const tick = () => {
      if (gate.shouldDraw()) {
        t += 0.01;
        reader.read();
        for (let i = 0; i < N; i++) {
          const el = refs.current[i];
          if (!el) continue;
          const v = reader.out[i] ?? 0;
          el.setAttribute('transform', `rotate(${i * 30 + t * 30}) scale(${0.5 + v * 0.8})`);
          el.setAttribute('opacity', String(0.3 + v * 0.6));
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [spectrumRef, sensitivity, smoothing]);
  return (
    <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(circle at center, #0a0a14 0%, #02030a 80%)' }}>
      <svg viewBox="-100 -100 200 200" preserveAspectRatio="xMidYMid meet" style={{ width: '100%', height: '100%' }}>
        {Array.from({ length: N }).map((_, i) => (
          <polygon key={i} ref={(el) => { refs.current[i] = el; }}
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
export function VizFreqGrid({ accent, accent2, spectrumRef, sensitivity = 1, smoothing = 0, paused }: VizProps) {
  const COLS = 32;
  const ROWS = 16;
  // Pre-allocated history buffer: COLS rows, each ROWS floats. Treated as a
  // ring with `head` pointing at the most-recent column.
  const histRef = useRef<Float32Array[]>(
    Array.from({ length: COLS }, () => new Float32Array(ROWS)),
  );
  const headRef = useRef(0);
  const cellRefs = useRef<(HTMLDivElement | null)[]>([]);
  const gate = useAnimateGate(paused, 'freqgrid');
  useEffect(() => {
    const reader = makeSpectrumReader(ROWS, spectrumRef, sensitivity, smoothing);
    let raf = 0;
    const tick = () => {
      if (gate.shouldDraw()) {
        reader.read();
        // Advance ring head, then copy current spectrum into the new head row.
        headRef.current = (headRef.current + 1) % COLS;
        const head = histRef.current[headRef.current]!;
        for (let r = 0; r < ROWS; r++) {
          head[r] = reader.out[r] ?? 0;
        }
        // Render: col 0 = newest, col COLS-1 = oldest. Map col c → ring index
        // (head - c + COLS) % COLS.
        for (let c = 0; c < COLS; c++) {
          const ringIdx = (headRef.current - c + COLS) % COLS;
          const row = histRef.current[ringIdx]!;
          for (let r = 0; r < ROWS; r++) {
            const el = cellRefs.current[c * ROWS + r];
            if (!el) continue;
            const v = row[r] ?? 0;
            el.style.opacity = (v * 0.95).toFixed(2);
            el.style.transform = `scale(${0.3 + v * 0.7})`;
          }
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [spectrumRef, sensitivity, smoothing]);
  return (
    <div style={{ position: 'absolute', inset: 0, background: '#04050b', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ width: '88%', height: '78%', display: 'grid', gridTemplateColumns: `repeat(${COLS}, 1fr)`, gap: 4 }}>
        {Array.from({ length: COLS }).map((_, c) => (
          <div key={c} style={{ display: 'grid', gridTemplateRows: `repeat(${ROWS}, 1fr)`, gap: 4 }}>
            {Array.from({ length: ROWS }).map((_, r) => (
              <div key={r} ref={(el) => { cellRefs.current[c * ROWS + r] = el; }} style={{
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
export function VizMinimalDots({ accent, accent2, spectrumRef, sensitivity = 1, smoothing = 0, paused }: VizProps) {
  const refs = useRef<(HTMLDivElement | null)[]>([]);
  const gate = useAnimateGate(paused, 'minimal');
  useEffect(() => {
    const reader = makeSpectrumReader(16, spectrumRef, sensitivity, smoothing);
    let raf = 0;
    const tick = () => {
      if (gate.shouldDraw()) {
        reader.read();
        const s = reader.out;
        const bands = [
          ((s[0] ?? 0) + (s[1] ?? 0) + (s[2] ?? 0)) / 3,
          ((s[6] ?? 0) + (s[7] ?? 0) + (s[8] ?? 0)) / 3,
          ((s[13] ?? 0) + (s[14] ?? 0) + (s[15] ?? 0)) / 3,
        ];
        for (let i = 0; i < 3; i++) {
          const el = refs.current[i];
          if (!el) continue;
          const sc = 0.5 + (bands[i] ?? 0) * 1.3;
          el.style.transform = `scale(${sc})`;
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [spectrumRef, sensitivity, smoothing]);
  const labels = ['BASS', 'MID', 'TREBLE'];
  return (
    <div style={{ position: 'absolute', inset: 0, background: '#06070a', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8%' }}>
      {labels.map((label, i) => (
        <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 24 }}>
          <div ref={(el) => { refs.current[i] = el; }} style={{
            width: 140, height: 140, borderRadius: '50%',
            background: i === 1 ? accent2 : accent,
            boxShadow: `0 0 80px ${i === 1 ? accent2 : accent}`,
            transition: 'none',
          }} />
          <span style={{ fontSize: 12, fontFamily: '"JetBrains Mono", ui-monospace, monospace', color: 'rgba(255,255,255,0.4)', letterSpacing: '.2em' }}>{label}</span>
        </div>
      ))}
    </div>
  );
}

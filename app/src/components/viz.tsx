import React, { useEffect, useRef, useState, type MutableRefObject } from 'react';
import type { VizMode, Track } from '../types';
import { type SpectrumState, type Playback, mediaControls } from '../state/tauri';

interface VizProps {
  accent: string;
  accent2: string;
  /** Live audio-spectrum ref. When live, viz reads from `bands`/`level`; otherwise falls back to a synthetic envelope. */
  spectrumRef?: MutableRefObject<SpectrumState>;
}

export function HiFiVizBars({ accent, accent2, spectrumRef }: VizProps) {
  const count = 64;
  const barsRef = useRef<(HTMLDivElement | null)[]>([]);
  const peaksRef = useRef<number[]>(new Array(count).fill(0));
  const rafRef = useRef(0);

  useEffect(() => {
    let t = 0;
    const tick = () => {
      t += 0.04;
      const live = spectrumRef?.current.live === true;
      const bands = spectrumRef?.current.bands;
      for (let i = 0; i < count; i++) {
        let h: number;
        if (live && bands) {
          // Real audio: bins are already log-spaced + smoothed in Rust.
          h = Math.max(0.04, Math.min(1, bands[i] ?? 0));
        } else {
          // Decorative fallback (no Tauri / no audio yet).
          const x = i / count;
          const env = Math.pow(1 - x, 1.2) * 0.55 + 0.18;
          const a = Math.sin(t * 1.6 + i * 0.18) * 0.18;
          const b = Math.sin(t * 0.7 + i * 0.05) * 0.12;
          const c = Math.sin(t * 4.2 + i * 1.1) * 0.06;
          const noise = (Math.sin(i * 1.7 + t) * 0.5 + Math.cos(i * 0.9 + t * 2) * 0.5) * 0.08;
          h = Math.max(0.04, Math.min(1, env + a + b + c + noise));
        }
        const bar = barsRef.current[i];
        if (bar) bar.style.transform = `scaleY(${h})`;
        if (peaksRef.current[i]! < h) peaksRef.current[i] = h;
        else peaksRef.current[i] = Math.max(h, peaksRef.current[i]! - 0.008);
        const peak = barsRef.current[i + count];
        if (peak) peak.style.transform = `translateY(${-peaksRef.current[i]! * 100}%)`;
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [spectrumRef]);

  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'flex-end', justifyContent: 'center', gap: '0.4%', padding: '8% 4% 12%' }}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} style={{ flex: 1, height: '100%', position: 'relative', display: 'flex', alignItems: 'flex-end' }}>
          <div ref={(el) => { barsRef.current[i] = el; }} style={{
            width: '100%', height: '100%', transformOrigin: 'bottom',
            background: `linear-gradient(180deg, ${accent} 0%, ${accent2} 100%)`,
            borderRadius: '2px 2px 0 0',
            filter: `drop-shadow(0 0 8px ${accent}66)`,
            transform: 'scaleY(0.1)',
            transition: 'background 0.4s',
          }} />
          <div ref={(el) => { barsRef.current[i + count] = el; }} style={{
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

export function HiFiVizWaveform({ accent, accent2, spectrumRef }: VizProps) {
  const ref = useRef<SVGPolylineElement | null>(null);
  const ref2 = useRef<SVGPolylineElement | null>(null);
  useEffect(() => {
    let t = 0;
    let raf = 0;
    const N = 200;
    const tick = () => {
      t += 0.05;
      const live = spectrumRef?.current.live === true;
      const bands = spectrumRef?.current.bands;
      const level = spectrumRef?.current.level ?? 0;
      const pts: string[] = [];
      for (let i = 0; i < N; i++) {
        const x = (i / (N - 1)) * 100;
        let y: number;
        if (live && bands) {
          // Sample lower-mid bins (most musical energy lives there); the top
          // 16 kHz band is usually silent and made the right edge go flat.
          // Squaring the position skews the mapping toward the energetic end.
          const t_norm = i / (N - 1);
          const biased = Math.pow(t_norm, 1.6);
          const maxBand = Math.floor(bands.length * 0.7);
          const bandIdx = Math.min(maxBand, Math.floor(biased * maxBand));
          const bandV = bands[bandIdx] ?? 0;
          // Blend: spectral detail + overall level + a tiny baseline so the
          // wave breathes even in very quiet passages.
          const v = bandV * 0.55 + level * 0.45 + 0.06;
          const phase = Math.sin(i * 0.4 + t * 1.3);
          y = 50 + phase * v * 35;
        } else {
          const wave = Math.sin(i * 0.18 + t) * 14
            + Math.sin(i * 0.07 + t * 0.7) * 8
            + Math.sin(i * 0.5 + t * 2.1) * 3;
          const env = Math.sin(i * 0.04 + t * 0.3) * 0.5 + 0.7;
          y = 50 + wave * env;
        }
        pts.push(`${x},${y}`);
      }
      const d = pts.join(' ');
      ref.current?.setAttribute('points', d);
      ref2.current?.setAttribute('points', d);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [spectrumRef]);
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

export function HiFiVizRadial({ accent, accent2, spectrumRef }: VizProps) {
  const linesRef = useRef<(SVGLineElement | null)[]>([]);
  const groupRef = useRef<SVGGElement | null>(null);
  const N = 96;
  useEffect(() => {
    let t = 0;
    let raf = 0;
    const tick = () => {
      t += 0.03;
      const live = spectrumRef?.current.live === true;
      const bands = spectrumRef?.current.bands;
      groupRef.current?.setAttribute('transform', `rotate(${t * 8})`);
      for (let i = 0; i < N; i++) {
        const x = i / N;
        let h: number;
        if (live && bands) {
          // Mirror the spectrum around the circle: first half is bands, second half mirrors.
          const half = N / 2;
          const idx = i < half ? i : N - 1 - i;
          const bandIdx = Math.floor((idx / half) * (bands.length - 1));
          h = Math.max(0.1, Math.min(1, (bands[bandIdx] ?? 0) * 1.1 + 0.08));
        } else {
          const a = Math.sin(t * 1.5 + i * 0.3) * 0.2;
          const b = Math.sin(t * 0.8 + x * Math.PI * 8) * 0.25;
          const env = 0.35 + Math.sin(x * Math.PI * 4) * 0.15;
          h = Math.max(0.1, Math.min(1, env + a + b));
        }
        const ln = linesRef.current[i];
        if (ln) {
          const ang = (i / N) * Math.PI * 2;
          const r1 = 14, r2 = 14 + h * 22;
          ln.setAttribute('x1', String(Math.cos(ang) * r1));
          ln.setAttribute('y1', String(Math.sin(ang) * r1));
          ln.setAttribute('x2', String(Math.cos(ang) * r2));
          ln.setAttribute('y2', String(Math.sin(ang) * r2));
          ln.setAttribute('opacity', String(0.4 + h * 0.6));
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [spectrumRef]);
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
          <line key={i} ref={(el) => { linesRef.current[i] = el; }}
            stroke={i % 2 === 0 ? accent : accent2} strokeWidth="0.8" strokeLinecap="round" />
        ))}
      </g>
    </svg>
  );
}

export function HiFiVizParticles({ accent, accent2, spectrumRef }: VizProps) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
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
      const live = spectrumRef?.current.live === true;
      const bands = spectrumRef?.current.bands;
      // Bass = energy across the lowest ~8 bands; falls back to a slow sine.
      let bass: number;
      if (live && bands) {
        let sum = 0;
        const lowN = Math.min(8, bands.length);
        for (let i = 0; i < lowN; i++) sum += bands[i] ?? 0;
        bass = Math.min(1, (sum / lowN) * 1.5 + 0.1);
      } else {
        bass = (Math.sin(t) * 0.5 + 0.5) * 0.5 + 0.3;
      }
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
  }, [accent, accent2, spectrumRef]);
  return <canvas ref={ref} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} />;
}

export function HiFiVizAmbient({ accent, accent2 }: VizProps) {
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

export function HiFiVizSurface({ mode, accent, accent2, spectrumRef }: { mode: VizMode } & VizProps) {
  if (mode === 'bars') return <HiFiVizBars accent={accent} accent2={accent2} spectrumRef={spectrumRef} />;
  if (mode === 'waveform') return <HiFiVizWaveform accent={accent} accent2={accent2} spectrumRef={spectrumRef} />;
  if (mode === 'radial') return <HiFiVizRadial accent={accent} accent2={accent2} spectrumRef={spectrumRef} />;
  if (mode === 'particles') return <HiFiVizParticles accent={accent} accent2={accent2} spectrumRef={spectrumRef} />;
  if (mode === 'ambient') return <HiFiVizAmbient accent={accent} accent2={accent2} />;
  return null;
}

const overlayBtn: React.CSSProperties = {
  background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(20px)',
  border: '1px solid rgba(255,255,255,0.08)',
  color: 'rgba(255,255,255,0.85)', padding: '7px 12px', borderRadius: 8,
  cursor: 'pointer', fontSize: 11, fontWeight: 500,
  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
};

function fmtMMSS(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) return '0:00';
  const total = Math.floor(seconds);
  return `${Math.floor(total / 60)}:${(total % 60).toString().padStart(2, '0')}`;
}

/** Same 1Hz interpolation logic as the Spotify tile, hoisted so the overlay
 *  shows a smoothly ticking elapsed time between 2-second GSMTC syncs. */
function useLivePos(playback: Playback | null): number {
  const [now, setNow] = useState(() => performance.now());
  useEffect(() => {
    if (!playback?.playing) return;
    const id = setInterval(() => setNow(performance.now()), 250);
    return () => clearInterval(id);
  }, [playback?.playing, playback?.syncedAt]);
  if (!playback) return 0;
  if (!playback.playing) return playback.positionAtSync;
  const elapsed = (now - playback.syncedAt) / 1000;
  const projected = playback.positionAtSync + elapsed;
  return playback.duration > 0 ? Math.min(playback.duration, projected) : projected;
}

export function VizOverlay({
  track, mode, setMode, accent, accent2, playback,
}: {
  track: Track;
  mode: VizMode;
  setMode: (m: VizMode) => void;
  accent: string;
  accent2: string;
  playback?: Playback | null;
}) {
  const position = useLivePos(playback ?? null);
  const duration = playback?.duration ?? 0;
  const havePlayback = !!playback && duration > 0;
  const progressPct = havePlayback ? Math.min(100, (position / duration) * 100) : 0;
  const positionLabel = havePlayback ? fmtMMSS(position) : '—';
  const durationLabel = havePlayback ? fmtMMSS(duration) : '—';
  const playIcon = playback?.playing ? '⏸' : '⏵';
  const modes: { k: VizMode; label: string }[] = [
    { k: 'bars', label: 'Bars' },
    { k: 'waveform', label: 'Wave' },
    { k: 'radial', label: 'Radial' },
    { k: 'particles', label: 'Particle' },
    { k: 'ambient', label: 'Ambient' },
  ];
  return (
    <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
      <div style={{ padding: 18, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', pointerEvents: 'auto' }}>
        <div style={{ display: 'flex', gap: 4, padding: 4, background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(20px)', borderRadius: 10, border: '1px solid rgba(255,255,255,0.06)' }}>
          {modes.map((m) => (
            <button key={m.k} onClick={() => setMode(m.k)} style={{
              padding: '6px 12px', fontSize: 11, fontWeight: 600,
              background: mode === m.k ? accent : 'transparent',
              color: mode === m.k ? '#000' : 'rgba(255,255,255,0.7)',
              border: 'none', borderRadius: 6, cursor: 'pointer',
              boxShadow: mode === m.k ? `0 0 12px ${accent}77` : 'none',
              transition: 'all 0.2s',
            }}>{m.label}</button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button style={overlayBtn}>⚙ Configure</button>
          <button style={overlayBtn}>⛶</button>
        </div>
      </div>
      <div style={{ padding: 22, display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 20, pointerEvents: 'auto' }}>
        <div style={{ display: 'flex', gap: 14, alignItems: 'center', minWidth: 0 }}>
          <div style={{ width: 78, height: 78, borderRadius: 10, background: track.cover, position: 'relative', overflow: 'hidden', flexShrink: 0, boxShadow: `0 12px 40px ${accent}66` }}>
            <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(circle at 30% 30%, rgba(255,255,255,0.3), transparent 60%)' }} />
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 10, color: accent, textTransform: 'uppercase', letterSpacing: '.1em', fontWeight: 700, marginBottom: 4 }}>● Now playing — accent linked</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: '#fff', letterSpacing: '-0.01em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{track.title}</div>
            <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.65)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{track.artist} — {track.album}</div>
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-end' }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button title="Previous" onClick={() => mediaControls.previous()} style={overlayBtn}>⏮</button>
            <button
              title={playback?.playing ? 'Pause' : 'Play'}
              onClick={() => mediaControls.togglePlayPause()}
              style={{ ...overlayBtn, width: 44, height: 44, background: '#fff', color: '#000', borderRadius: 999, fontSize: 16 }}
            >{playIcon}</button>
            <button title="Next" onClick={() => mediaControls.next()} style={overlayBtn}>⏭</button>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 280 }}>
            <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.5)', fontFamily: '"JetBrains Mono", ui-monospace, monospace' }}>{positionLabel}</span>
            <div style={{ flex: 1, height: 3, background: 'rgba(255,255,255,0.15)', borderRadius: 2, position: 'relative', overflow: 'hidden' }}>
              <div style={{
                position: 'absolute', left: 0, top: 0, bottom: 0,
                width: `${progressPct}%`,
                background: `linear-gradient(90deg, ${accent2}, ${accent})`,
                borderRadius: 2,
                transition: havePlayback ? 'width 0.25s linear' : 'none',
              }} />
            </div>
            <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.5)', fontFamily: '"JetBrains Mono", ui-monospace, monospace' }}>{durationLabel}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

export function VizHero({
  mode, setMode, accent, accent2, track, spectrumRef, playback, showArtBg = false,
}: {
  mode: VizMode;
  setMode: (m: VizMode) => void;
  accent: string;
  accent2: string;
  track: Track;
  spectrumRef?: MutableRefObject<SpectrumState>;
  playback?: Playback | null;
  /** When true, render a heavily blurred album-art backdrop behind the viz. */
  showArtBg?: boolean;
}) {
  return (
    <div style={{
      position: 'relative', overflow: 'hidden',
      borderRadius: 14,
      background: '#06070a',
      border: '1px solid rgba(255,255,255,0.05)',
      boxShadow: `0 0 60px -20px ${accent}66`,
    }}>
      {showArtBg && (
        <div style={{
          position: 'absolute', inset: '-8%',  // overscan so the blur edges don't show
          background: track.cover,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          filter: 'blur(48px) saturate(1.4) brightness(0.45)',
          transform: 'scale(1.12)',
          pointerEvents: 'none',
          zIndex: 0,
        }} />
      )}
      <div style={{ position: 'absolute', inset: 0, zIndex: 1 }}>
        <HiFiVizSurface mode={mode} accent={accent} accent2={accent2} spectrumRef={spectrumRef} />
      </div>
      <div style={{
        position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 2,
        background: 'linear-gradient(180deg, rgba(0,0,0,0.5) 0%, transparent 18%, transparent 75%, rgba(0,0,0,0.55) 100%)',
      }} />
      <div style={{ position: 'absolute', inset: 0, zIndex: 3 }}>
        <VizOverlay track={track} mode={mode} setMode={setMode} accent={accent} accent2={accent2} playback={playback} />
      </div>
    </div>
  );
}

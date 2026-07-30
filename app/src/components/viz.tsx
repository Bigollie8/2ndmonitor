import React, { lazy, Suspense, useEffect, useRef, useState, type MutableRefObject } from 'react';
import type { VizMode, Track } from '../types';
import { type SpectrumState, type Playback, mediaControls } from '../state/tauri';
import { useLyrics, currentLineIndex } from '../state/lyrics';
import { recordDraw, useRegisterSurface } from '../perf/debug';
import { paceFrame, isWindowHidden } from '../state/framePace';
import { BrowserPlayer, type Bookmark } from './browser-player';
import { bundleIdOf, isBundleMode } from '../state/contentRegistry';
import { useVizStyles } from './useVizStyles';
import { catalogKey } from '../state/catalog';

// The "extra" visualizer styles (viz-extra) are lazy-loaded: most sessions
// run a single style, and eagerly importing all of them bloats the boot
// bundle for code that may never render. Each becomes its own chunk, fetched
// on first switch to that mode. The core set below (bars/waveform/radial/
// particles/ambient) stays eager — it's the default/onboarding path.
const VizNeonBars = lazy(() => import('./viz-extra').then((m) => ({ default: m.VizNeonBars })));
const VizSplitMirror = lazy(() => import('./viz-extra').then((m) => ({ default: m.VizSplitMirror })));
const VizCircularPulse = lazy(() => import('./viz-extra').then((m) => ({ default: m.VizCircularPulse })));
const VizWaveformTunnel = lazy(() => import('./viz-extra').then((m) => ({ default: m.VizWaveformTunnel })));
const VizPixelLED = lazy(() => import('./viz-extra').then((m) => ({ default: m.VizPixelLED })));
const VizRibbon = lazy(() => import('./viz-extra').then((m) => ({ default: m.VizRibbon })));
const VizVinyl = lazy(() => import('./viz-extra').then((m) => ({ default: m.VizVinyl })));
const VizKaleidoscope = lazy(() => import('./viz-extra').then((m) => ({ default: m.VizKaleidoscope })));
const VizFreqGrid = lazy(() => import('./viz-extra').then((m) => ({ default: m.VizFreqGrid })));
const VizMinimalDots = lazy(() => import('./viz-extra').then((m) => ({ default: m.VizMinimalDots })));
const VizMilkdrop = lazy(() => import('./viz-milkdrop').then((m) => ({ default: m.VizMilkdrop })));
const VizScripted = lazy(() => import('./viz-scripted').then((m) => ({ default: m.VizScripted })));
const SandboxVizSurface = lazy(() => import('./viz-sandbox-surface').then((m) => ({ default: m.SandboxVizSurface })));

/** Per-frame DPR cap for viz canvases. On a 4K monitor at DPR=2, dropping to 1
 *  cuts canvas pixel work 4x with no perceptible loss for music visualizers. */
let vizDprCap = 1;
export function setVizDprCap(cap: number) { vizDprCap = cap; }
export function getVizDpr(): number {
  const dpr = typeof window !== 'undefined' ? (window.devicePixelRatio || 1) : 1;
  return Math.min(dpr, vizDprCap);
}

/** Frames-per-second cap. 0 means no cap (native rAF). Otherwise, viz tick
 *  bodies skip drawing when `now - lastDraw < 1000/maxFps`. */
let vizMaxFps = 0;
export function setVizMaxFps(fps: number) { vizMaxFps = fps; }
/** 0 = uncapped (rAF native rate). Otherwise the configured cap in fps. */
export function getVizMaxFps(): number { return vizMaxFps; }

/** Reads N values from spectrumRef.current.bands by resampling, applies
 *  sensitivity, and per-bin smooths. Falls back to a procedural fake
 *  spectrum when no live audio. Returns a callable that mutates `out`
 *  in place each frame — much faster than allocating per-frame.
 *
 *  Also exposes per-band means (`bands.bass/mid/treble`) and onset envelopes
 *  (`onset.kick/snare/hat`) that decay between transients — these are stable
 *  object references mutated in place each `read()` call. */
export function makeSpectrumReader(
  N: number,
  spectrumRef: MutableRefObject<SpectrumState> | undefined,
  sensitivity: number,
  smoothing: number,
) {
  const out = new Float32Array(N);
  const smoothed = new Float32Array(N);
  let t = 0;
  // For onset detection: slow-tracked baseline per region.
  let bassBaseline = 0, midBaseline = 0, trebleBaseline = 0;
  // Decaying onset envelopes — peak on transient, decay over ~150ms.
  let kickEnv = 0, snareEnv = 0, hatEnv = 0;
  // Procedural beat clock for fallback (120 bpm).
  let beatPhase = 0;
  const sm = Math.max(0, Math.min(0.95, smoothing));
  const bands = { bass: 0, mid: 0, treble: 0 };
  const onset = { kick: 0, snare: 0, hat: 0 };
  return {
    out,
    bands,
    onset,
    /** Call once per frame; mutates `out`, `bands`, `onset` in place.
     *  Returns the bass scalar (mean of low ~12.5% of bins). */
    read(): number {
      t += 0.04;
      beatPhase += 0.04;
      const live = spectrumRef?.current.live === true;
      const liveBands = spectrumRef?.current.bands;
      const srcLen = liveBands?.length ?? 64;
      let bassSum = 0, midSum = 0, trebleSum = 0;
      // Musical thirds in log-frequency space (Rust emits 30Hz–16kHz log-spaced).
      // bass = 30–250Hz (kick, bass guitar), mid = 250Hz–2kHz (vocals, snare body),
      // treble = 2–16kHz (cymbals, air). Old 12.5/37.5/50 split made "bass" cover
      // only sub-bass (30–66Hz) so kicks read as mid and reactivity felt skewed.
      const bassN = Math.max(1, Math.floor(N * 0.338));
      const midEnd = Math.max(bassN + 1, Math.floor(N * 0.669));
      let bassCount = 0, midCount = 0, trebleCount = 0;
      for (let i = 0; i < N; i++) {
        let raw: number;
        if (live && liveBands) {
          raw = liveBands[Math.floor((i / N) * srcLen)] ?? 0;
        } else {
          // Procedural fallback — same shape as the design's fake spectrum,
          // with kick/snare/hat boosts so onset-driven visuals still animate.
          const x = i / N;
          const env = Math.pow(1 - x, 1.2) * 0.55 + 0.18;
          const a = Math.sin(t * 1.6 + i * 0.18) * 0.18;
          const b = Math.sin(t * 0.7 + i * 0.05) * 0.12;
          const c = Math.sin(t * 4.2 + i * 1.1) * 0.06;
          const noise = (Math.sin(i * 1.7 + t) * 0.5 + Math.cos(i * 0.9 + t * 2) * 0.5) * 0.08;
          // 120 bpm fake onsets
          const beatT = (beatPhase % 0.5) / 0.5;
          const fkick = beatT < 0.08 ? Math.exp(-beatT * 30) : 0;
          const fsnare = (beatPhase % 0.5) > 0.25 && (beatPhase % 0.5) < 0.27 ? 1 : 0;
          const fhat = (beatPhase * 4) % 1 < 0.04 ? 0.6 : 0;
          const kickBoost = i < bassN ? fkick * 0.6 : 0;
          const snareBoost = i >= bassN && i < midEnd ? fsnare * 0.4 : 0;
          const hatBoost = i >= midEnd ? fhat * 0.3 : 0;
          raw = env + a + b + c + noise + kickBoost + snareBoost + hatBoost;
        }
        const scaled = raw * sensitivity;
        const prev = smoothed[i] ?? 0;
        const v = prev * sm + scaled * (1 - sm);
        smoothed[i] = v;
        const clamped = Math.max(0.04, Math.min(1, v));
        out[i] = clamped;
        if (i < bassN) { bassSum += clamped; bassCount++; }
        else if (i < midEnd) { midSum += clamped; midCount++; }
        else { trebleSum += clamped; trebleCount++; }
      }
      const bass = bassSum / Math.max(1, bassCount);
      const mid = midSum / Math.max(1, midCount);
      const treble = trebleSum / Math.max(1, trebleCount);
      bands.bass = bass;
      bands.mid = mid;
      bands.treble = treble;

      // Onset detection: spike above slow baseline triggers a peak that
      // decays over ~150ms. Threshold and decay tuned so kicks read distinctly.
      bassBaseline = bassBaseline * 0.92 + bass * 0.08;
      midBaseline = midBaseline * 0.92 + mid * 0.08;
      trebleBaseline = trebleBaseline * 0.92 + treble * 0.08;
      const kickHit = Math.max(0, bass - bassBaseline * 1.25);
      const snareHit = Math.max(0, mid - midBaseline * 1.25);
      const hatHit = Math.max(0, treble - trebleBaseline * 1.25);
      kickEnv = Math.max(kickEnv * 0.82, Math.min(1, kickHit * 4));
      snareEnv = Math.max(snareEnv * 0.82, Math.min(1, snareHit * 4));
      hatEnv = Math.max(hatEnv * 0.82, Math.min(1, hatHit * 4));
      onset.kick = kickEnv;
      onset.snare = snareEnv;
      onset.hat = hatEnv;

      return bass;
    },
  };
}

export interface VizProps {
  accent: string;
  accent2: string;
  /** Live audio-spectrum ref. When live, viz reads from `bands`/`level`; otherwise falls back to a synthetic envelope. */
  spectrumRef?: MutableRefObject<SpectrumState>;
  /** Multiplier applied to band amplitudes before clamping. Default 1. */
  sensitivity?: number;
  /** Exponential smoothing factor on bands (0=no smoothing, 0.95=heavy). Default 0. */
  smoothing?: number;
  /** When true, viz freezes — skips reader.read() and drawing each frame.
   *  rAF is still scheduled so resume is instant on unpause. */
  paused?: boolean;
  /** Currently playing track. Visualizers that surface album art (e.g. vinyl)
   *  read `track.cover` — a CSS background string that's either a gradient
   *  fallback or `center / cover no-repeat url("...")` when GSMTC has art. */
  track?: Track;
  /** Live playback state. Used by playback-aware viz (vinyl stops spinning
   *  when not playing; cassette shows the track length on the label). */
  playback?: Playback | null;
  /** True when rendered as a gallery-grid thumbnail. Styles that allocate
   *  scarce resources (MilkDrop's WebGL context) render a cheap placeholder
   *  instead — Chromium caps live WebGL contexts around 16 and the gallery
   *  mounts every style at once. */
  preview?: boolean;
}

/** Combined visibility + frame-rate gate. Each viz calls `shouldDraw()` once
 *  per rAF; returns true only when (a) not paused, (b) document not hidden,
 *  and (c) enough time has elapsed since the last successful draw to honour
 *  the global FPS cap. The rAF callback should still re-schedule unconditionally.
 *
 *  `name` (optional): when provided + perfDebug is on, every successful draw is
 *  recorded for per-viz draw-rate attribution and long-task heuristic tagging. */
export function useAnimateGate(paused?: boolean, name?: string): { shouldDraw(): boolean } {
  const visibleRef = useRef(true);
  const paceRef = useRef({ nextDue: 0 });
  useEffect(() => {
    const update = () => {
      visibleRef.current = !paused && (typeof document === 'undefined' || document.visibilityState !== 'hidden');
    };
    update();
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', update);
      return () => document.removeEventListener('visibilitychange', update);
    }
    return undefined;
  }, [paused]);

  return {
    shouldDraw(): boolean {
      if (isWindowHidden()) return false;
      if (!visibleRef.current) return false;
      if (vizMaxFps > 0 && !paceFrame(performance.now(), paceRef.current, 1000 / vizMaxFps)) {
        return false;
      }
      if (name) recordDraw(name);
      return true;
    },
  };
}

export function HiFiVizBars({ accent, accent2, spectrumRef, sensitivity = 1, smoothing = 0, paused }: VizProps) {
  const count = 64;
  const barsRef = useRef<(HTMLDivElement | null)[]>([]);
  const peaksRef = useRef<number[]>(new Array(count).fill(0));
  const smoothedRef = useRef<number[]>(new Array(count).fill(0));
  const rafRef = useRef(0);
  const gate = useAnimateGate(paused, 'bars');

  useEffect(() => {
    let t = 0;
    const tick = () => {
      if (gate.shouldDraw()) {
        t += 0.04;
        const live = spectrumRef?.current.live === true;
        const bands = spectrumRef?.current.bands;
        const sm = Math.max(0, Math.min(0.95, smoothing));
        for (let i = 0; i < count; i++) {
          let raw: number;
          if (live && bands) {
            raw = bands[i] ?? 0;
          } else {
            const x = i / count;
            const env = Math.pow(1 - x, 1.2) * 0.55 + 0.18;
            const a = Math.sin(t * 1.6 + i * 0.18) * 0.18;
            const b = Math.sin(t * 0.7 + i * 0.05) * 0.12;
            const c = Math.sin(t * 4.2 + i * 1.1) * 0.06;
            const noise = (Math.sin(i * 1.7 + t) * 0.5 + Math.cos(i * 0.9 + t * 2) * 0.5) * 0.08;
            raw = env + a + b + c + noise;
          }
          const scaled = raw * sensitivity;
          const prev = smoothedRef.current[i] ?? 0;
          const sm_v = prev * sm + scaled * (1 - sm);
          smoothedRef.current[i] = sm_v;
          const h = Math.max(0.04, Math.min(1, sm_v));

          const bar = barsRef.current[i];
          if (bar) bar.style.transform = `scaleY(${h})`;
          if (peaksRef.current[i]! < h) peaksRef.current[i] = h;
          else peaksRef.current[i] = Math.max(h, peaksRef.current[i]! - 0.008);
          const peak = barsRef.current[i + count];
          if (peak) peak.style.transform = `translateY(${-peaksRef.current[i]! * 100}%)`;
        }
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [spectrumRef, sensitivity, smoothing]);

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

export function HiFiVizWaveform({ accent, accent2, spectrumRef, sensitivity = 1, smoothing = 0, paused }: VizProps) {
  const ref = useRef<SVGPolylineElement | null>(null);
  const ref2 = useRef<SVGPolylineElement | null>(null);
  const smoothedRef = useRef<number[]>(new Array(200).fill(0));
  const gate = useAnimateGate(paused, 'waveform');
  useEffect(() => {
    let t = 0;
    let raf = 0;
    const N = 200;
    const tick = () => {
      if (gate.shouldDraw()) {
        t += 0.05;
        const live = spectrumRef?.current.live === true;
        const bands = spectrumRef?.current.bands;
        const level = spectrumRef?.current.level ?? 0;
        const sm = Math.max(0, Math.min(0.95, smoothing));
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
            const vRaw = (bandV * 0.55 + level * 0.45 + 0.06) * sensitivity;
            const prev = smoothedRef.current[i] ?? 0;
            const v = prev * sm + vRaw * (1 - sm);
            smoothedRef.current[i] = v;
            const phase = Math.sin(i * 0.4 + t * 1.3);
            y = 50 + phase * v * 35;
          } else {
            const wave = Math.sin(i * 0.18 + t) * 14
              + Math.sin(i * 0.07 + t * 0.7) * 8
              + Math.sin(i * 0.5 + t * 2.1) * 3;
            const env = Math.sin(i * 0.04 + t * 0.3) * 0.5 + 0.7;
            const yRaw = (wave * env) * sensitivity;
            const prev = smoothedRef.current[i] ?? 0;
            const yS = prev * sm + yRaw * (1 - sm);
            smoothedRef.current[i] = yS;
            y = 50 + yS;
          }
          pts.push(`${x},${y}`);
        }
        const d = pts.join(' ');
        ref.current?.setAttribute('points', d);
        ref2.current?.setAttribute('points', d);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [spectrumRef, sensitivity, smoothing]);
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

export function HiFiVizRadial({ accent, accent2, spectrumRef, sensitivity = 1, smoothing = 0, paused }: VizProps) {
  const linesRef = useRef<(SVGLineElement | null)[]>([]);
  const groupRef = useRef<SVGGElement | null>(null);
  const N = 96;
  const smoothedRef = useRef<number[]>(new Array(N).fill(0));
  const gate = useAnimateGate(paused, 'radial');
  useEffect(() => {
    let t = 0;
    let raf = 0;
    const tick = () => {
      if (gate.shouldDraw()) {
        t += 0.03;
        const live = spectrumRef?.current.live === true;
        const bands = spectrumRef?.current.bands;
        const sm = Math.max(0, Math.min(0.95, smoothing));
        groupRef.current?.setAttribute('transform', `rotate(${t * 8})`);
        for (let i = 0; i < N; i++) {
          const x = i / N;
          let raw: number;
          if (live && bands) {
            // Mirror the spectrum around the circle: first half is bands, second half mirrors.
            const half = N / 2;
            const idx = i < half ? i : N - 1 - i;
            const bandIdx = Math.floor((idx / half) * (bands.length - 1));
            raw = (bands[bandIdx] ?? 0) * 1.1 + 0.08;
          } else {
            const a = Math.sin(t * 1.5 + i * 0.3) * 0.2;
            const b = Math.sin(t * 0.8 + x * Math.PI * 8) * 0.25;
            const env = 0.35 + Math.sin(x * Math.PI * 4) * 0.15;
            raw = env + a + b;
          }
          const scaled = raw * sensitivity;
          const prev = smoothedRef.current[i] ?? 0;
          const sm_v = prev * sm + scaled * (1 - sm);
          smoothedRef.current[i] = sm_v;
          const h = Math.max(0.1, Math.min(1, sm_v));
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
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [spectrumRef, sensitivity, smoothing]);
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

export function HiFiVizParticles({ accent, accent2, spectrumRef, sensitivity = 1, smoothing = 0, paused }: VizProps) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const gate = useAnimateGate(paused, 'particles');
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = getVizDpr();
    const resize = () => {
      const r = canvas.getBoundingClientRect();
      canvas.width = r.width * dpr;
      canvas.height = r.height * dpr;
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    const N = 140;
    const pts = Array.from({ length: N }, () => {
      const x = Math.random();
      const y = Math.random();
      return {
        x, y,
        homeX: x, homeY: y, // each particle springs back to its (drifting) home
        // homes drift slowly across the canvas, bouncing off walls — so the
        // overall scene is alive even when no beat is hitting.
        vhomeX: (Math.random() - 0.5) * 0.0010,
        vhomeY: (Math.random() - 0.5) * 0.0010,
        vx: 0, vy: 0,
        r: 0.5 + Math.random() * 1.8,
        hue: Math.random(),
      };
    });
    let t = 0;
    let raf = 0;
    let bassSmoothed = 0;
    let bassReference = 0;  // slow-tracking baseline; spike = bass - reference
    const tick = () => {
      if (gate.shouldDraw()) {
        t += 0.02;
        const w = canvas.width, h = canvas.height;
        ctx.clearRect(0, 0, w, h);
        const live = spectrumRef?.current.live === true;
        const bands = spectrumRef?.current.bands;
        const level = spectrumRef?.current.level ?? 0;
        const sm = Math.max(0, Math.min(0.95, smoothing));
        // Bass = energy across the lowest ~8 bands, mixed with overall RMS for
        // snappier reaction on transient kicks. Falls back to a slow sine.
        let bassRaw: number;
        if (live && bands) {
          let sum = 0;
          const lowN = Math.min(8, bands.length);
          for (let i = 0; i < lowN; i++) sum += bands[i] ?? 0;
          const lowAvg = sum / lowN;
          bassRaw = (lowAvg * 0.7 + level * 0.6) * 1.6 + 0.08;
        } else {
          bassRaw = (Math.sin(t) * 0.5 + 0.5) * 0.5 + 0.3;
        }
        const scaled = bassRaw * sensitivity;
        bassSmoothed = bassSmoothed * sm + scaled * (1 - sm);
        const bass = Math.min(1.5, bassSmoothed);

        // Spike detection: bass exceeding the slow-tracked reference is "the beat".
        // The reference catches up slowly so a sustained loud passage still has beats.
        bassReference = bassReference * 0.92 + bass * 0.08;
        const spike = Math.max(0, bass - bassReference); // 0..~0.6 typical

        ctx.fillStyle = accent2 + '11';
        ctx.fillRect(0, 0, w, h);

        // Outward kick on beats — falls off with distance from center, so the
        // shockwave moves the inner particles more than the edge ones.
        const kickStrength = spike * 0.012;
        const springK = 0.018;  // pull-back-to-home force
        const drag = 0.86;

        for (const p of pts) {
          // Drift the home position so the scene stays alive between beats.
          // Bounce off a 5% inner margin so homes never reach the corners.
          p.homeX += p.vhomeX;
          p.homeY += p.vhomeY;
          if (p.homeX < 0.05) { p.homeX = 0.05; p.vhomeX = -p.vhomeX; }
          else if (p.homeX > 0.95) { p.homeX = 0.95; p.vhomeX = -p.vhomeX; }
          if (p.homeY < 0.05) { p.homeY = 0.05; p.vhomeY = -p.vhomeY; }
          else if (p.homeY > 0.95) { p.homeY = 0.95; p.vhomeY = -p.vhomeY; }

          // Spring force toward (drifting) home keeps the particle near it but
          // free to wander; beat kicks displace it transiently.
          p.vx += (p.homeX - p.x) * springK;
          p.vy += (p.homeY - p.y) * springK;

          // Outward kick from center on bass spikes.
          const dx = p.x - 0.5;
          const dy = p.y - 0.5;
          const dist = Math.sqrt(dx * dx + dy * dy) + 0.0001;
          const inv = 1 / dist;
          const falloff = 1 / (1 + dist * 5);
          p.vx += (dx * inv) * kickStrength * falloff;
          p.vy += (dy * inv) * kickStrength * falloff;

          p.vx *= drag;
          p.vy *= drag;

          p.x += p.vx;
          p.y += p.vy;

          const px = p.x * w, py = p.y * h;
          const r = p.r * dpr * (0.3 + bass * 2.8);
          const grad = ctx.createRadialGradient(px, py, 0, px, py, r * 4);
          grad.addColorStop(0, p.hue > 0.5 ? accent : accent2);
          grad.addColorStop(1, 'transparent');
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.arc(px, py, r * 4, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, [accent, accent2, spectrumRef, sensitivity, smoothing]);
  return <canvas ref={ref} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} />;
}

export function HiFiVizAmbient({ accent, accent2, spectrumRef, sensitivity = 1, smoothing = 0, paused }: VizProps) {
  const blobsRef = useRef<HTMLDivElement | null>(null);
  const gate = useAnimateGate(paused, 'ambient');
  useEffect(() => {
    const reader = makeSpectrumReader(48, spectrumRef, sensitivity, smoothing);
    let raf = 0;
    const tick = () => {
      if (gate.shouldDraw()) {
        reader.read();
        const bass = reader.bands.bass;
        const mid = reader.bands.mid;
        const el = blobsRef.current;
        if (el) {
          // Bass slowly inflates the blobs; mid gently nudges saturation.
          const scale = 1 + bass * 0.18;
          const sat = 1.2 + mid * 0.6;
          const blur = 2 + (1 - bass) * 4; // softer when quiet, sharper on bass
          el.style.transform = `scale(${scale})`;
          el.style.filter = `blur(${blur}px) saturate(${sat})`;
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [spectrumRef, sensitivity, smoothing]);
  return (
    <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', background: '#06080d' }}>
      <div ref={blobsRef} style={{
        position: 'absolute', inset: '-10%',
        background: `
          radial-gradient(ellipse 50% 40% at 25% 35%, ${accent}77, transparent 65%),
          radial-gradient(ellipse 45% 55% at 75% 60%, ${accent2}77, transparent 65%),
          radial-gradient(ellipse 35% 30% at 50% 85%, ${accent}55, transparent 70%),
          radial-gradient(ellipse 60% 45% at 15% 80%, ${accent2}33, transparent 70%)
        `,
        filter: 'blur(2px) saturate(1.2)',
        animation: 'amb-drift 22s ease-in-out infinite alternate',
        transition: 'transform 120ms ease-out, filter 200ms ease-out',
        willChange: 'transform, filter',
      }} />
      <style>{`
        @keyframes amb-drift {
          0% { translate: 0 0; }
          50% { translate: 3% -2%; }
          100% { translate: -2% 3%; }
        }
      `}</style>
    </div>
  );
}

export function HiFiVizSurface({ mode, accent, accent2, spectrumRef, sensitivity, smoothing, paused, track, playback, catalogRemoved }: { mode: VizMode; catalogRemoved: string[] } & VizProps) {
  // Register the active viz mode as the mounted surface; the HUD displays it
  // and spike snapshots include it under `vizMode`.
  useRegisterSurface(`viz:${mode}${paused ? ':paused' : ''}`);
  // Needed only for the `bundle:` fallback below (is this id actually
  // installed?), but this component already hosts a hook (useRegisterSurface
  // above), so it's the natural place for the check. `catalogRemoved` is a
  // prop, not read from the tweaks store here — useTweaks is instantiated
  // exactly once (App.tsx) and threaded down as props.
  const { styles: vizStyles, loaded: vizStylesLoaded } = useVizStyles(catalogRemoved);
  const props = { accent, accent2, spectrumRef, sensitivity, smoothing, paused, track, playback };
  // The core styles (bars/waveform/radial/particles/ambient) are eager and
  // never suspend. The "extra" styles are lazy-loaded chunks (see the `lazy()`
  // declarations above) — Suspense covers the brief gap while a chunk fetches
  // on first switch to that style. `fallback={null}` renders a blank frame in
  // that window rather than unmounting anything outside this component (the
  // VizOverlay chrome in VizHero is a sibling, not a Suspense descendant, so
  // it stays mounted throughout).
  const surface = (() => {
    switch (mode) {
      case 'bars':         return <HiFiVizBars {...props} />;
      case 'waveform':     return <HiFiVizWaveform {...props} />;
      case 'radial':       return <HiFiVizRadial {...props} />;
      case 'particles':    return <HiFiVizParticles {...props} />;
      case 'ambient':      return <HiFiVizAmbient {...props} />;
      case 'neonbars':     return <VizNeonBars {...props} />;
      case 'splitmirror':  return <VizSplitMirror {...props} />;
      case 'circular':     return <VizCircularPulse {...props} />;
      case 'tunnel':       return <VizWaveformTunnel {...props} />;
      case 'pixelled':     return <VizPixelLED {...props} />;
      case 'ribbon':       return <VizRibbon {...props} />;
      case 'vinyl':        return <VizVinyl {...props} />;
      case 'kaleidoscope': return <VizKaleidoscope {...props} />;
      case 'freqgrid':     return <VizFreqGrid {...props} />;
      case 'minimal':      return <VizMinimalDots {...props} />;
    case 'milkdrop':      return <VizMilkdrop {...props} />;
    case 'scripted':      return <VizScripted {...props} />;
    default: {
      // Installed marketplace visualizer: same sandbox runtime, no authoring
      // chrome. An unknown non-bundle mode falls back to Bars rather than
      // rendering a blank tile — and so does a `bundle:` mode that names a
      // style not currently installed (e.g. a saved selection for a style
      // that was just retired from the binary, before the user installs its
      // shop replacement). Handing an uninstalled id to SandboxVizSurface
      // would just surface its "visualizers_read" error banner instead.
      //
      // This has to be a three-state check, not a boolean. `vizStylesLoaded`
      // distinguishes "the visualizers_list invoke hasn't resolved yet" from
      // "it resolved and this id isn't in it" — an empty/builtins-only
      // catalog looks identical to "genuinely not installed" otherwise, and
      // t.vizMode can already be a `bundle:` mode on the very first render
      // (useTweaks's synchronous localStorage load runs before this effect
      // fires). Guessing either way during that window produces a visible
      // wrong-style flash: guess "absent" and an installed bundle style
      // flashes Bars before snapping to the sandbox; guess "present" and a
      // genuinely-uninstalled id flashes the sandbox's error banner. Do not
      // collapse this back to `bundleId && vizStyles.some(...)`.
      const bundleId = bundleIdOf(mode);
      if (bundleId === null) return <HiFiVizBars {...props} />;
      if (!vizStylesLoaded) return null; // not yet known — render nothing, not a guess
      return vizStyles.some((s) => s.id === mode)
        ? <SandboxVizSurface {...props} bundleId={bundleId} />
        : <HiFiVizBars {...props} />;
    }
    }
  })();
  return <Suspense fallback={null}>{surface}</Suspense>;
}

/** The 5 quick-select buttons in VizOverlay's top-left strip. Predates the
 *  unified catalog — VizOverlay filters this against `catalogRemoved` before
 *  rendering (see its `modes` computation) so a removed built-in visualizer
 *  stops being offered here too, the same as the V-cycle and gallery. */
const QUICK_MODES: { k: VizMode; label: string }[] = [
  { k: 'bars', label: 'Bars' },
  { k: 'waveform', label: 'Wave' },
  { k: 'radial', label: 'Radial' },
  { k: 'particles', label: 'Particle' },
  { k: 'ambient', label: 'Ambient' },
];

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
  track, mode, setMode, accent, accent2, playback, onConfigure, onToggleImmersive, immersive = false,
  videoEnabled = false, videoAvailable = false, onToggleVideo, catalogRemoved,
}: {
  track: Track;
  mode: VizMode;
  setMode: (m: VizMode) => void;
  accent: string;
  accent2: string;
  playback?: Playback | null;
  onConfigure?: () => void;
  onToggleImmersive?: () => void;
  immersive?: boolean;
  /** Whether the video embed is currently active. Drives the 📺 button highlight. */
  videoEnabled?: boolean;
  /** Whether the saved URL parses to a valid YouTube ID. Disables the 📺 button when false. */
  videoAvailable?: boolean;
  /** Called when the user clicks 📺 to flip video on/off. */
  onToggleVideo?: () => void;
  /** The catalog removal list — see state/removedContent.ts. */
  catalogRemoved: string[];
}) {
  const position = useLivePos(playback ?? null);
  const duration = playback?.duration ?? 0;
  const havePlayback = !!playback && duration > 0;
  const progressPct = havePlayback ? Math.min(100, (position / duration) * 100) : 0;
  const positionLabel = havePlayback ? fmtMMSS(position) : '—';
  const durationLabel = havePlayback ? fmtMMSS(duration) : '—';
  const playIcon = playback?.playing ? '⏸' : '⏵';
  // Filtered against catalogRemoved so a removed built-in doesn't stay
  // offered (and re-selectable) here even after it's gone from the V-cycle
  // and gallery — this hardcoded strip predates the unified catalog and
  // didn't consult the removal list until this fix.
  const modes = QUICK_MODES.filter((m) => !catalogRemoved.includes(catalogKey('visualizer', m.k)));
  const isOriginalMode = modes.some((m) => m.k === mode);
  // The merged catalog (not just BUILTIN_VIZ_STYLES) so an installed
  // `bundle:` style's label still shows in the "● Label" badge.
  const { styles: vizStyles, loaded: vizStylesLoaded } = useVizStyles(catalogRemoved);
  // Same tri-state reasoning as HiFiVizSurface's dispatch gate above:
  // `vizStyles` holds builtins only until the installed-bundle list
  // resolves, so an active `bundle:` style's badge would otherwise flash
  // absent for a tick before popping in. Gate the lookup on
  // `vizStylesLoaded` for bundle modes so that's a deliberate "not known
  // yet" rather than an accidental side effect of the merge — builtin
  // styles never depend on the async list, so their badge is unaffected.
  const styleEntry = (!isBundleMode(mode) || vizStylesLoaded)
    ? vizStyles.find((s) => s.id === mode)
    : undefined;
  return (
    <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
      <div style={{ padding: 18, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', pointerEvents: 'auto' }}>
        <div style={{ display: 'flex', gap: 4, padding: 4, background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(20px)', borderRadius: 10, border: '1px solid rgba(255,255,255,0.06)', alignItems: 'center' }}>
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
          <button onClick={onConfigure} style={{
            padding: '6px 12px', fontSize: 11, fontWeight: 500,
            background: 'transparent', color: 'rgba(255,255,255,0.6)',
            border: 'none', borderRadius: 6, cursor: 'pointer',
          }}>+ More</button>
          {!isOriginalMode && styleEntry && (
            <span style={{
              padding: '6px 10px', fontSize: 10, fontWeight: 600,
              background: `${accent}22`, color: accent,
              border: `1px solid ${accent}55`, borderRadius: 6,
              fontFamily: '"JetBrains Mono", ui-monospace, monospace',
              letterSpacing: '.05em',
              display: 'flex', alignItems: 'center', gap: 4,
            }}>● {styleEntry.label}</span>
          )}
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button onClick={onConfigure} style={overlayBtn} title="Browse all visualizers">⚙ Configure</button>
          <button
            onClick={videoAvailable ? onToggleVideo : undefined}
            disabled={!videoAvailable}
            title={
              videoAvailable
                ? (videoEnabled ? 'Switch back to visualizer' : 'Play video instead of visualizer')
                : 'Add a bookmark in Settings → System → Streaming bookmarks first'
            }
            style={{
              ...overlayBtn,
              background: videoEnabled ? `${accent}33` : overlayBtn.background,
              borderColor: videoEnabled ? `${accent}99` : (overlayBtn.borderColor as string | undefined),
              color: videoEnabled ? accent : (videoAvailable ? overlayBtn.color : 'rgba(255,255,255,0.3)'),
              cursor: videoAvailable ? 'pointer' : 'not-allowed',
            }}
          >📺</button>
          <button onClick={onToggleImmersive} style={overlayBtn} title={immersive ? 'Show overlay (Esc)' : 'Immersive mode'}>{immersive ? '⛶' : '⛶'}</button>
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

/** TEMP: live audio-pipeline HUD for validating that visualizers are actually
 *  reading real WASAPI loopback data. Reads spectrumRef directly each rAF
 *  (no React state churn). Remove once reactivity is verified. */
function AudioDebugHud({ spectrumRef, paused }: {
  spectrumRef?: MutableRefObject<SpectrumState>;
  paused?: boolean;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!spectrumRef) return;
    let raf = 0;
    let frameCount = 0;
    let lastFrameStamp = 0;
    let framesPerSec = 0;
    let lastBandsHash = -1;
    const tick = () => {
      const s = spectrumRef.current;
      const bands = s.bands;
      let bassSum = 0, midSum = 0, trebSum = 0;
      const N = bands.length;
      const lowN = Math.max(1, Math.floor(N * 0.125));
      const midEnd = Math.max(lowN + 1, Math.floor(N * 0.5));
      let bassCount = 0, midCount = 0, trebCount = 0;
      let max = 0;
      let nonZero = 0;
      // Hash to detect frames actually changing (catches "stuck at zero" vs "no frames").
      let hash = 0;
      for (let i = 0; i < N; i++) {
        const v = bands[i] ?? 0;
        hash = (hash * 31 + Math.floor(v * 1000)) | 0;
        if (v > 0.001) nonZero++;
        if (v > max) max = v;
        if (i < lowN) { bassSum += v; bassCount++; }
        else if (i < midEnd) { midSum += v; midCount++; }
        else { trebSum += v; trebCount++; }
      }
      // Track frames-per-second of *changing* spectrum data.
      if (hash !== lastBandsHash) {
        frameCount++;
        lastBandsHash = hash;
      }
      const now = performance.now();
      if (now - lastFrameStamp >= 1000) {
        framesPerSec = frameCount * 1000 / (now - lastFrameStamp);
        frameCount = 0;
        lastFrameStamp = now;
      }
      const bass = bassSum / Math.max(1, bassCount);
      const mid = midSum / Math.max(1, midCount);
      const treb = trebSum / Math.max(1, trebCount);
      const liveColor = s.live ? '#4ade80' : '#f87171';
      const fpsColor = framesPerSec > 5 ? '#4ade80' : framesPerSec > 0 ? '#fbbf24' : '#f87171';
      const levelColor = s.level > 0.02 ? '#4ade80' : '#fbbf24';
      const el = ref.current;
      if (el) {
        el.innerHTML = [
          `<div style="color:${liveColor}">live: ${s.live ? 'TRUE' : 'FALSE'}</div>`,
          `<div style="color:${fpsColor}">fps:  ${framesPerSec.toFixed(1)}</div>`,
          `<div style="color:${levelColor}">lvl:  ${s.level.toFixed(3)}</div>`,
          `<div>max:  ${max.toFixed(3)}</div>`,
          `<div>nz:   ${nonZero}/${N}</div>`,
          `<div>bass: ${bass.toFixed(3)}</div>`,
          `<div>mid:  ${mid.toFixed(3)}</div>`,
          `<div>treb: ${treb.toFixed(3)}</div>`,
          `<div style="color:${paused ? '#f87171' : '#4ade80'}">paused: ${paused ? 'YES' : 'no'}</div>`,
        ].join('');
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [spectrumRef, paused]);
  return (
    <div ref={ref} style={{
      position: 'absolute', top: 12, left: 12, zIndex: 5,
      padding: '8px 10px', borderRadius: 6,
      background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(8px)',
      border: '1px solid rgba(255,255,255,0.12)',
      color: 'rgba(255,255,255,0.85)',
      fontFamily: '"JetBrains Mono", ui-monospace, monospace',
      fontSize: 11, lineHeight: 1.45,
      pointerEvents: 'none',
      whiteSpace: 'pre',
    }} />
  );
}

export function VizHero({
  mode, setMode, accent, accent2, track, spectrumRef, playback,
  showArtBg = false, sensitivity = 1, smoothing = 0, lyricsOverlayEnabled = true,
  videoEnabled = false, videoCurrentUrl = null, videoBookmarks = [],
  videoAvailable = false, onToggleVideo, onNavigate, onExit, overlaysOpen = false,
  paused = false, onConfigure, audioDebug = false, catalogRemoved,
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
  sensitivity?: number;
  smoothing?: number;
  lyricsOverlayEnabled?: boolean;
  /** When true AND `videoAvailable`, replace the viz with the streaming browser. */
  videoEnabled?: boolean;
  /** URL currently loaded in the child webview, or null for the launchpad. */
  videoCurrentUrl?: string | null;
  /** Editable bookmark list shown on the launchpad. */
  videoBookmarks?: Bookmark[];
  /** True when there's at least one bookmark — the 📺 toggle is enabled. */
  videoAvailable?: boolean;
  /** Click handler for the overlay 📺 button. */
  onToggleVideo?: () => void;
  /** Sets `videoCurrentUrl` (called from launchpad cards or Home button). */
  onNavigate?: (url: string | null) => void;
  /** Sets `videoEnabled = false` (called from chrome ✕ and error states). */
  onExit?: () => void;
  /** True when any modal overlay is open (gallery / edit / switcher / onboarding) —
   *  forwarded to BrowserPlayer.suppress to hide the native webview. */
  overlaysOpen?: boolean;
  paused?: boolean;
  /** Called when the user clicks "⚙ Configure" or "+ More" — opens the viz gallery. */
  onConfigure?: () => void;
  /** When true, overlay the live audio-pipeline HUD (live/fps/level/bands)
   *  on the viz. Useful for diagnosing why a viz isn't reacting. */
  audioDebug?: boolean;
  /** The catalog removal list — see state/removedContent.ts. */
  catalogRemoved: string[];
}) {
  const [immersive, setImmersive] = useState(false);
  useEffect(() => {
    // Esc exits immersive mode without closing edit mode etc. — only handle when immersive is on.
    if (!immersive) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); setImmersive(false); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [immersive]);
  // Video takes over the tile only when explicitly enabled AND we have a
  // parseable URL. Both conditions are checked here (not just at render-time)
  // so the album-art backdrop and audio-debug HUD also know to step aside.
  const showVideo = videoEnabled && videoAvailable;
  return (
    <div style={{
      position: 'relative', overflow: 'hidden',
      width: '100%', height: '100%',
      borderRadius: 14,
      background: '#06070a',
      border: '1px solid rgba(255,255,255,0.05)',
      boxShadow: `0 0 32px -16px ${accent}66`,
    }}>
      {showArtBg && !showVideo && (
        <div style={{
          position: 'absolute', inset: '-8%',  // overscan so the blur edges don't show
          background: track.cover,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          filter: 'blur(24px) saturate(1.4) brightness(0.45)',
          transform: 'scale(1.12)',
          pointerEvents: 'none',
          zIndex: 0,
        }} />
      )}
      <div style={{ position: 'absolute', inset: 0, zIndex: 1 }}>
        {showVideo ? (
          <BrowserPlayer
            enabled={videoEnabled}
            currentUrl={videoCurrentUrl}
            bookmarks={videoBookmarks}
            onNavigate={onNavigate ?? (() => {})}
            onExit={onExit ?? (() => {})}
            suppress={overlaysOpen}
          />
        ) : (
          <HiFiVizSurface mode={mode} accent={accent} accent2={accent2} spectrumRef={spectrumRef} sensitivity={sensitivity} smoothing={smoothing} paused={paused} track={track} playback={playback} catalogRemoved={catalogRemoved} />
        )}
      </div>
      {!showVideo && (
        <div style={{
          position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 2,
          background: 'linear-gradient(180deg, rgba(0,0,0,0.5) 0%, transparent 18%, transparent 75%, rgba(0,0,0,0.55) 100%)',
        }} />
      )}
      {!showVideo && <LyricsOverlay accent={accent} playback={playback} enabled={lyricsOverlayEnabled} />}
      {!showVideo && audioDebug && <AudioDebugHud spectrumRef={spectrumRef} paused={paused} />}
      {/* VizOverlay (mode buttons + track info + immersive/📺 toggles) hides
       *  entirely when video mode is active. Otherwise its top button row
       *  draws over the BrowserPlayer's chrome bar at the same y-band, and
       *  its bottom track-info row gets covered by the native webview anyway —
       *  rendering it just produces visual overlap. The BrowserPlayer's chrome
       *  bar (🏠 Home + ✕ Exit) provides the controls the user needs while
       *  watching. */}
      {!immersive && !showVideo && (
        <div style={{ position: 'absolute', inset: 0, zIndex: 3, pointerEvents: 'none' }}>
          <VizOverlay
            track={track} mode={mode} setMode={setMode}
            accent={accent} accent2={accent2} playback={playback}
            onConfigure={onConfigure}
            onToggleImmersive={() => setImmersive(true)}
            immersive={immersive}
            videoEnabled={videoEnabled}
            videoAvailable={videoAvailable}
            onToggleVideo={onToggleVideo}
            catalogRemoved={catalogRemoved}
          />
        </div>
      )}
      {immersive && (
        <button
          onClick={() => setImmersive(false)}
          title="Show controls (Esc)"
          style={{
            position: 'absolute', top: 12, right: 12, zIndex: 4,
            width: 32, height: 32, borderRadius: 6,
            background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(20px)',
            border: '1px solid rgba(255,255,255,0.08)',
            color: 'rgba(255,255,255,0.7)', cursor: 'pointer', fontSize: 13,
          }}
        >✕</button>
      )}
    </div>
  );
}

/** GSMTC's reported position lags real audio by ~300-800ms because Spotify
 *  only pushes position to GSMTC at ~1Hz. Bumping the lyric position forward
 *  by a fixed amount compensates so lines hit on time instead of late. */
const LYRICS_FORWARD_OFFSET_SECS = 0.4;

/** Returns the active synced-line index, recomputed on a 200ms interval against
 *  interpolated playback position. Only setState when the index actually changes. */
function useCurrentLyricIndex(lines: import('../state/lyrics').LrcLine[], playback?: Playback | null): number {
  const [idx, setIdx] = useState(-1);
  useEffect(() => {
    if (!playback || lines.length === 0) { setIdx(-1); return; }
    const tick = () => {
      const elapsed = playback.playing ? (performance.now() - playback.syncedAt) / 1000 : 0;
      const pos = playback.positionAtSync + elapsed + LYRICS_FORWARD_OFFSET_SECS;
      const next = currentLineIndex(lines, pos);
      setIdx((prev) => (prev === next ? prev : next));
    };
    tick();
    const id = setInterval(tick, 200);
    return () => clearInterval(id);
  }, [playback, lines]);
  return idx;
}

export function LyricsOverlay({
  accent, playback, enabled,
}: {
  accent: string;
  playback?: Playback | null;
  enabled: boolean;
}) {
  const lyrics = useLyrics();
  const idx = useCurrentLyricIndex(lyrics.syncedLines, playback);
  const line = idx >= 0 ? lyrics.syncedLines[idx]?.text ?? '' : '';

  // Hide unless we have synced lyrics, the user enabled the overlay, and a
  // track is actively playing.
  if (!enabled) return null;
  if (lyrics.syncedLines.length === 0) return null;
  if (!playback?.playing) return null;
  if (!line) return null;

  return (
    <div
      key={idx}
      style={{
        position: 'absolute', top: 32, left: 0, right: 0,
        textAlign: 'center', pointerEvents: 'none',
        zIndex: 2,
        animation: 'lyricsFade 400ms ease-out',
      }}
    >
      <div style={{
        display: 'inline-block',
        padding: '6px 18px',
        fontSize: 28, fontWeight: 600,
        color: '#fff',
        textShadow: `0 0 24px ${accent}cc, 0 2px 8px rgba(0,0,0,0.85)`,
        letterSpacing: '-0.01em',
        maxWidth: '80%',
      }}>{line}</div>
      <style>{`
        @keyframes lyricsFade {
          from { opacity: 0; transform: translateY(-6px); }
          to   { opacity: 1; transform: translateY(0);    }
        }
      `}</style>
    </div>
  );
}

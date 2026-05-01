/** Performance debugging instrumentation.
 *
 * Goal: when GPU% spikes, identify the *root cause* by capturing what was
 * happening on the main thread and which surfaces were mounted at the moment
 * of the spike. Everything in this module is gated behind `enable()` so it
 * costs nothing in production unless the user flips the perfDebug tweak.
 *
 * Wiring summary:
 *   - useAnimateGate (viz.tsx) tags each draw with a name → `recordDraw(name)`
 *   - HiFiVizSurface registers the active viz name        → `registerSurface()`
 *   - VizGallery / EditOverlay / Onboarding can also register themselves
 *   - App.tsx pipes sysmon GPU samples in                  → `recordGpuSample()`
 *   - App.tsx pipes rAF-measured fps in                    → `recordFps()`
 *   - Window resize listener increments                    → `recordResize()`
 *   - PerformanceObserver('longtask') is set up on enable
 *   - ResizeObserver constructor is wrapped on enable so we count callback fires
 *
 * Output: a snapshot you can read live (HUD) or freeze when a spike fires.
 *
 * No React imports — this is a plain TS module. The HUD lives in PerfDebugHUD.tsx.
 */

import { useEffect } from 'react';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface LongTaskRecord {
  ts: number;             // performance.now() at task start
  duration: number;       // ms
  /** Most-recent draw name when the long task fired (heuristic attribution). */
  attributedTo: string | null;
}

export interface SpikeRecord {
  ts: number;             // performance.now() when detected
  wallTime: string;       // human-readable HH:MM:SS.mmm
  gpu: number;            // sample value (%, 0..~100 — or whatever NVML returns)
  baseline: number;       // rolling baseline at moment of spike
  delta: number;          // gpu - baseline
  fps: number;            // rAF rate at the time
  perfMode: string;
  vizMode: string;
  surfaces: string[];     // mounted surfaces at moment of spike
  /** Long tasks observed in the 2 seconds prior. */
  recentLongTasks: { duration: number; attributedTo: string | null }[];
  /** Window-resize and ResizeObserver fires in the 2 seconds prior. */
  resizesPrior: number;
  roFiresPrior: number;
  /** Top per-viz draw counts in the 2 seconds prior. */
  topDrawers: { name: string; count: number }[];
}

interface DrawWindowEntry {
  ts: number;
  name: string;
}

interface ResizeWindowEntry {
  ts: number;
  source: 'window' | 'resize-observer';
}

interface State {
  enabled: boolean;
  surfaces: Map<string, number>;        // name → mount count (allows duplicates)
  drawWindow: DrawWindowEntry[];        // last 5s of draws (for rate calc + topDrawers)
  longTasks: LongTaskRecord[];          // last 50
  spikes: SpikeRecord[];                // last 20
  gpuSamples: { ts: number; value: number }[];  // last 30s
  fps: number;                          // most recent rAF fps
  perfMode: string;
  vizMode: string;
  resizeWindow: ResizeWindowEntry[];    // last 5s
  /** Most-recent draw name — heuristic for long-task attribution. */
  lastDrawName: string | null;
  /** When was the GPU baseline last computed? */
  baseline: number;
  spikeThreshold: number;               // %-points over baseline that triggers
  spikeCooldownMs: number;              // suppress double-fires
  lastSpikeAt: number;
}

const state: State = {
  enabled: false,
  surfaces: new Map(),
  drawWindow: [],
  longTasks: [],
  spikes: [],
  gpuSamples: [],
  fps: 60,
  perfMode: 'unknown',
  vizMode: 'unknown',
  resizeWindow: [],
  lastDrawName: null,
  baseline: 0,
  spikeThreshold: 15,    // 15 %-points above rolling baseline → spike
  spikeCooldownMs: 1000, // don't fire more than once per second
  lastSpikeAt: 0,
};

// ─── Subscribers (HUD live updates) ───────────────────────────────────────────

type Listener = () => void;
const listeners = new Set<Listener>();

function notify(): void {
  for (const l of listeners) {
    try { l(); } catch (e) { console.warn('perf debug listener threw', e); }
  }
}

export function subscribe(cb: Listener): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

// ─── Long-task observer ──────────────────────────────────────────────────────

let longTaskObserver: PerformanceObserver | null = null;

function startLongTaskObserver(): void {
  if (longTaskObserver) return;
  if (typeof PerformanceObserver === 'undefined') return;
  // 'longtask' isn't supported in every webview, so guard.
  const supported = (PerformanceObserver as unknown as { supportedEntryTypes?: string[] })
    .supportedEntryTypes;
  if (supported && !supported.includes('longtask')) return;
  try {
    longTaskObserver = new PerformanceObserver((list) => {
      const entries = list.getEntries();
      for (const e of entries) {
        const rec: LongTaskRecord = {
          ts: e.startTime,
          duration: e.duration,
          attributedTo: state.lastDrawName,
        };
        state.longTasks.push(rec);
        if (state.longTasks.length > 50) state.longTasks.shift();
      }
      if (entries.length) notify();
    });
    longTaskObserver.observe({ entryTypes: ['longtask'] });
  } catch (e) {
    console.warn('longtask observer not available', e);
    longTaskObserver = null;
  }
}

function stopLongTaskObserver(): void {
  if (longTaskObserver) {
    longTaskObserver.disconnect();
    longTaskObserver = null;
  }
}

// ─── ResizeObserver wrap (counts callback fires globally) ────────────────────

let originalResizeObserver: typeof ResizeObserver | null = null;

function wrapResizeObserver(): void {
  if (originalResizeObserver) return;
  if (typeof window === 'undefined' || typeof window.ResizeObserver === 'undefined') return;
  originalResizeObserver = window.ResizeObserver;
  const Wrapped = function (this: ResizeObserver, cb: ResizeObserverCallback): ResizeObserver {
    const wrappedCb: ResizeObserverCallback = (entries, observer) => {
      // Each entry counts as one fire; this matches "how many resize events
      // are landing per second across all observers."
      const ts = performance.now();
      for (let i = 0; i < entries.length; i++) {
        state.resizeWindow.push({ ts, source: 'resize-observer' });
      }
      pruneResizeWindow();
      cb(entries, observer);
    };
    return new originalResizeObserver!(wrappedCb);
  } as unknown as typeof ResizeObserver;
  // Preserve prototype chain so `instanceof ResizeObserver` still works.
  Wrapped.prototype = originalResizeObserver.prototype;
  window.ResizeObserver = Wrapped;
}

function unwrapResizeObserver(): void {
  if (originalResizeObserver && typeof window !== 'undefined') {
    window.ResizeObserver = originalResizeObserver;
    originalResizeObserver = null;
  }
}

// ─── Window resize listener ──────────────────────────────────────────────────

let windowResizeListener: (() => void) | null = null;

function startWindowResizeListener(): void {
  if (windowResizeListener) return;
  if (typeof window === 'undefined') return;
  windowResizeListener = () => {
    state.resizeWindow.push({ ts: performance.now(), source: 'window' });
    pruneResizeWindow();
  };
  window.addEventListener('resize', windowResizeListener);
}

function stopWindowResizeListener(): void {
  if (windowResizeListener && typeof window !== 'undefined') {
    window.removeEventListener('resize', windowResizeListener);
    windowResizeListener = null;
  }
}

function pruneResizeWindow(): void {
  const cutoff = performance.now() - 5000;
  while (state.resizeWindow.length && state.resizeWindow[0]!.ts < cutoff) {
    state.resizeWindow.shift();
  }
}

// ─── Public API ──────────────────────────────────────────────────────────────

export function enable(): void {
  if (state.enabled) return;
  state.enabled = true;
  startLongTaskObserver();
  wrapResizeObserver();
  startWindowResizeListener();
  notify();
}

export function disable(): void {
  if (!state.enabled) return;
  state.enabled = false;
  stopLongTaskObserver();
  unwrapResizeObserver();
  stopWindowResizeListener();
  // Reset transient state so a re-enable starts fresh.
  state.surfaces.clear();
  state.drawWindow = [];
  state.longTasks = [];
  state.spikes = [];
  state.gpuSamples = [];
  state.resizeWindow = [];
  state.lastDrawName = null;
  state.baseline = 0;
  notify();
}

export function isEnabled(): boolean {
  return state.enabled;
}

/** Called from useAnimateGate every time shouldDraw() returns true. */
export function recordDraw(name: string): void {
  if (!state.enabled) return;
  const ts = performance.now();
  state.drawWindow.push({ ts, name });
  state.lastDrawName = name;
  // Keep last 5 seconds.
  const cutoff = ts - 5000;
  while (state.drawWindow.length && state.drawWindow[0]!.ts < cutoff) {
    state.drawWindow.shift();
  }
}

/** Called by useRegisterSurface when a surface mounts. Returns an unregister fn. */
function _registerSurface(name: string): () => void {
  const cur = state.surfaces.get(name) ?? 0;
  state.surfaces.set(name, cur + 1);
  notify();
  return () => {
    const c = state.surfaces.get(name) ?? 0;
    if (c <= 1) state.surfaces.delete(name);
    else state.surfaces.set(name, c - 1);
    notify();
  };
}

/** React hook that registers a "surface" (viz, overlay, etc.) for the
 *  duration of the component's mount. Cheap when perfDebug is off. */
export function useRegisterSurface(name: string): void {
  useEffect(() => {
    if (!state.enabled) return;
    return _registerSurface(name);
  }, [name]);
}

export function recordGpuSample(value: number | null | undefined): void {
  if (!state.enabled) return;
  if (value == null || !isFinite(value)) return;
  const ts = performance.now();
  state.gpuSamples.push({ ts, value });
  // Keep last 30s.
  const cutoff = ts - 30_000;
  while (state.gpuSamples.length && state.gpuSamples[0]!.ts < cutoff) {
    state.gpuSamples.shift();
  }
  // Update rolling baseline (median of last 10s, excluding the most recent
  // 2 to avoid pulling baseline up DURING a spike).
  const baselineCutoffMin = ts - 12_000;
  const baselineCutoffMax = ts - 2_000;
  const baselinePool = state.gpuSamples
    .filter((s) => s.ts >= baselineCutoffMin && s.ts <= baselineCutoffMax)
    .map((s) => s.value)
    .sort((a, b) => a - b);
  if (baselinePool.length >= 3) {
    state.baseline = baselinePool[Math.floor(baselinePool.length / 2)] ?? value;
  } else {
    state.baseline = value;
  }
  // Spike detection.
  const delta = value - state.baseline;
  if (delta >= state.spikeThreshold && ts - state.lastSpikeAt >= state.spikeCooldownMs) {
    captureSpike(ts, value, state.baseline, delta);
    state.lastSpikeAt = ts;
  }
  notify();
}

export function recordFps(fps: number): void {
  if (!state.enabled) return;
  state.fps = fps;
}

export function recordContext(perfMode: string, vizMode: string): void {
  state.perfMode = perfMode;
  state.vizMode = vizMode;
}

function captureSpike(ts: number, gpu: number, baseline: number, delta: number): void {
  const since = ts - 2000;
  const longTasksPrior = state.longTasks
    .filter((lt) => lt.ts >= since)
    .map((lt) => ({ duration: lt.duration, attributedTo: lt.attributedTo }));
  const resizesPrior = state.resizeWindow.filter(
    (r) => r.ts >= since && r.source === 'window',
  ).length;
  const roFiresPrior = state.resizeWindow.filter(
    (r) => r.ts >= since && r.source === 'resize-observer',
  ).length;
  // Aggregate draws by name in the 2s window for top-drawers attribution.
  const drawCounts = new Map<string, number>();
  for (const d of state.drawWindow) {
    if (d.ts < since) continue;
    drawCounts.set(d.name, (drawCounts.get(d.name) ?? 0) + 1);
  }
  const topDrawers = Array.from(drawCounts.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  const spike: SpikeRecord = {
    ts,
    wallTime: formatWallTime(),
    gpu,
    baseline,
    delta,
    fps: state.fps,
    perfMode: state.perfMode,
    vizMode: state.vizMode,
    surfaces: Array.from(state.surfaces.keys()),
    recentLongTasks: longTasksPrior,
    resizesPrior,
    roFiresPrior,
    topDrawers,
  };
  state.spikes.push(spike);
  if (state.spikes.length > 20) state.spikes.shift();
}

function formatWallTime(): string {
  const d = new Date();
  const pad = (n: number, w = 2) => n.toString().padStart(w, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}

export function clearSpikes(): void {
  state.spikes = [];
  notify();
}

// ─── Snapshot for HUD ─────────────────────────────────────────────────────────

export interface PerfSnapshot {
  enabled: boolean;
  surfaces: string[];
  drawRatesByName: { name: string; perSec: number }[];
  longTaskCountLast5s: number;
  longTaskMaxLast5s: number;
  resizesLast5s: number;
  roFiresLast5s: number;
  fps: number;
  perfMode: string;
  vizMode: string;
  gpuLatest: number | null;
  gpuBaseline: number;
  gpuSparkline: number[];
  spikes: SpikeRecord[];
}

export function getSnapshot(): PerfSnapshot {
  const now = performance.now();
  const since = now - 5000;
  // Per-name draw rate over last 5s, normalised to per-second.
  const counts = new Map<string, number>();
  for (const d of state.drawWindow) {
    if (d.ts < since) continue;
    counts.set(d.name, (counts.get(d.name) ?? 0) + 1);
  }
  const drawRatesByName = Array.from(counts.entries())
    .map(([name, c]) => ({ name, perSec: c / 5 }))
    .sort((a, b) => b.perSec - a.perSec);

  const longLast5 = state.longTasks.filter((lt) => lt.ts >= since);
  const longTaskMax = longLast5.reduce((m, lt) => Math.max(m, lt.duration), 0);

  const resizes = state.resizeWindow.filter((r) => r.ts >= since);
  const resizesLast5s = resizes.filter((r) => r.source === 'window').length;
  const roFiresLast5s = resizes.filter((r) => r.source === 'resize-observer').length;

  // Sparkline: bucket the last 30s of GPU samples into 30 buckets of ~1s.
  const sparkSince = now - 30_000;
  const buckets = new Array<number>(30).fill(0);
  const bucketCounts = new Array<number>(30).fill(0);
  for (const s of state.gpuSamples) {
    if (s.ts < sparkSince) continue;
    const idx = Math.min(29, Math.floor((s.ts - sparkSince) / 1000));
    buckets[idx] = (buckets[idx] ?? 0) + s.value;
    bucketCounts[idx] = (bucketCounts[idx] ?? 0) + 1;
  }
  const gpuSparkline = buckets.map((sum, i) => {
    const c = bucketCounts[i] ?? 0;
    return c > 0 ? sum / c : 0;
  });
  const gpuLatest = state.gpuSamples.length
    ? state.gpuSamples[state.gpuSamples.length - 1]!.value
    : null;

  return {
    enabled: state.enabled,
    surfaces: Array.from(state.surfaces.keys()),
    drawRatesByName,
    longTaskCountLast5s: longLast5.length,
    longTaskMaxLast5s: longTaskMax,
    resizesLast5s,
    roFiresLast5s,
    fps: state.fps,
    perfMode: state.perfMode,
    vizMode: state.vizMode,
    gpuLatest,
    gpuBaseline: state.baseline,
    gpuSparkline,
    spikes: state.spikes.slice(),
  };
}

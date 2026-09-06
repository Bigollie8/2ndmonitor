/** Long-running performance session log.
 *
 * `debug.ts` measures things live (draw names, mounted surfaces, GPU samples,
 * fps, long tasks, resize fires) but only keeps a few seconds of history —
 * enough to explain a spike, not enough to see how the app behaves over an
 * hour of idle, or which viz creeps up in cost after a mode change. This
 * module adds that history: a fixed-capacity ring buffer of periodic samples
 * plus the aggregation and export helpers the HUD uses.
 *
 * It is deliberately pure — no DOM, no React, no import of debug.ts — so the
 * whole thing runs under `tsx --test` in plain node. debug.ts owns the data
 * source: it builds each `PerfSample` from its own counters (there is NO
 * second measurement path here) and drives `SessionLog.tick()` from a
 * `setInterval` that exists only while perfDebug is enabled.
 *
 * Memory bound (the reason the buffer is a ring, not a growing array):
 *   - DEFAULT_INTERVAL_MS = 2000, DEFAULT_CAPACITY = 3600 → 2 hours retained.
 *   - A sample is ~14 scalar/short-string fields (~200 B shaped object) plus a
 *     surfaces array (typically 0–6 short names, ~150 B) and a topDrawers list
 *     (≤ MAX_TOP_DRAWERS small objects, ~250 B) → ~600 B typical, well under
 *     1 KB worst case. 3600 × 1 KB ≈ 3.5 MB absolute ceiling; ~2 MB typical.
 *   - Once full, the oldest sample is overwritten; nothing is ever appended
 *     beyond capacity. On perfDebug disable the whole buffer is dropped.
 */

// ─── Sample shape ────────────────────────────────────────────────────────────

export interface DrawCount {
  name: string;
  count: number;
}

export interface PerfSample {
  /** Epoch ms (Date.now()) when the sample was taken. */
  t: number;
  /** Mean GPU% of the sysmon samples that arrived since the previous sample;
   *  null when none arrived in the interval. */
  gpu: number | null;
  /** Max GPU% over the same window (null when none). */
  gpuMax: number | null;
  /** Most recent rAF-measured fps. */
  fps: number;
  perfMode: string;
  vizMode: string;
  /** Names of surfaces mounted at sample time (deduped). */
  surfaces: string[];
  /** Long tasks observed since the previous sample. */
  longTasks: number;
  /** Total long-task duration (ms) since the previous sample. */
  longTaskMs: number;
  /** Window `resize` events since the previous sample. */
  resizeFires: number;
  /** ResizeObserver callback entries since the previous sample. */
  roFires: number;
  /** Per-name draw counts since the previous sample, sorted desc, capped. */
  topDrawers: DrawCount[];
  /** `performance.memory.usedJSHeapSize` in bytes, or null if unavailable. */
  memory: number | null;
}

export const DEFAULT_INTERVAL_MS = 2000;
export const DEFAULT_CAPACITY = 3600; // 2 h at 2 s
/** Cap on per-sample topDrawers so a pathological viz set can't inflate a sample. */
export const MAX_TOP_DRAWERS = 8;

// ─── Ring buffer ─────────────────────────────────────────────────────────────

export class RingBuffer<T> {
  readonly capacity: number;
  private buf: (T | undefined)[];
  private head = 0; // index of the oldest element
  private count = 0;

  constructor(capacity: number) {
    if (!Number.isInteger(capacity) || capacity <= 0) {
      throw new RangeError(`RingBuffer capacity must be a positive integer, got ${capacity}`);
    }
    this.capacity = capacity;
    this.buf = new Array<T | undefined>(capacity);
  }

  get size(): number {
    return this.count;
  }

  /** Append; overwrites the oldest element once full. */
  push(item: T): void {
    if (this.count < this.capacity) {
      this.buf[(this.head + this.count) % this.capacity] = item;
      this.count++;
    } else {
      this.buf[this.head] = item;
      this.head = (this.head + 1) % this.capacity;
    }
  }

  /** Oldest → newest. */
  toArray(): T[] {
    const out: T[] = new Array(this.count);
    for (let i = 0; i < this.count; i++) {
      out[i] = this.buf[(this.head + i) % this.capacity] as T;
    }
    return out;
  }

  /** Newest element or undefined when empty. */
  last(): T | undefined {
    if (this.count === 0) return undefined;
    return this.buf[(this.head + this.count - 1) % this.capacity];
  }

  clear(): void {
    // Release references so the retained samples can be collected.
    this.buf = new Array<T | undefined>(this.capacity);
    this.head = 0;
    this.count = 0;
  }
}

// ─── Aggregation ─────────────────────────────────────────────────────────────

export interface Stats {
  n: number;
  min: number;
  avg: number;
  max: number;
  /** Nearest-rank 95th percentile. */
  p95: number;
}

/** min/avg/max/p95 over `pick(sample)`; null/non-finite picks are skipped.
 *  Returns null when nothing finite was picked. */
export function stats(samples: readonly PerfSample[], pick: (s: PerfSample) => number | null | undefined): Stats | null {
  const vals: number[] = [];
  for (const s of samples) {
    const v = pick(s);
    if (v != null && Number.isFinite(v)) vals.push(v);
  }
  if (vals.length === 0) return null;
  vals.sort((a, b) => a - b);
  let sum = 0;
  for (const v of vals) sum += v;
  const rank = Math.max(1, Math.ceil(0.95 * vals.length));
  return {
    n: vals.length,
    min: vals[0]!,
    avg: sum / vals.length,
    max: vals[vals.length - 1]!,
    p95: vals[rank - 1]!,
  };
}

/** Sum per-name draw counts across samples → top N by total draws. */
export function topDrawers(samples: readonly PerfSample[], n = 10): DrawCount[] {
  const totals = new Map<string, number>();
  for (const s of samples) {
    for (const d of s.topDrawers) {
      totals.set(d.name, (totals.get(d.name) ?? 0) + d.count);
    }
  }
  return sortCounts(totals).slice(0, n);
}

/** How many samples each surface was mounted in → top N by frequency. */
export function topSurfaces(samples: readonly PerfSample[], n = 10): DrawCount[] {
  const freq = new Map<string, number>();
  for (const s of samples) {
    for (const name of s.surfaces) {
      freq.set(name, (freq.get(name) ?? 0) + 1);
    }
  }
  return sortCounts(freq).slice(0, n);
}

/** Reduce a raw name→count map to a sorted, capped topDrawers list. Used by
 *  debug.ts when building a sample, and by the reducers above. */
export function sortCounts(counts: ReadonlyMap<string, number>, cap = Infinity): DrawCount[] {
  const list: DrawCount[] = [];
  for (const [name, count] of counts) {
    if (count > 0) list.push({ name, count });
  }
  list.sort((a, b) => b.count - a.count || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return cap === Infinity ? list : list.slice(0, cap);
}

export interface SessionSummary {
  samples: number;
  /** Time between the first and last sample, ms (0 for < 2 samples). */
  spanMs: number;
  gpu: Stats | null;
  fps: Stats | null;
  memory: Stats | null;
  longTaskCount: number;
  longTaskMs: number;
  resizeFires: number;
  roFires: number;
  topDrawers: DrawCount[];
  topSurfaces: DrawCount[];
}

export function summarize(samples: readonly PerfSample[]): SessionSummary {
  const first = samples[0];
  const last = samples[samples.length - 1];
  let longTaskCount = 0, longTaskMs = 0, resizeFires = 0, roFires = 0;
  for (const s of samples) {
    longTaskCount += s.longTasks;
    longTaskMs += s.longTaskMs;
    resizeFires += s.resizeFires;
    roFires += s.roFires;
  }
  return {
    samples: samples.length,
    spanMs: first && last && samples.length > 1 ? last.t - first.t : 0,
    gpu: stats(samples, (s) => s.gpu),
    fps: stats(samples, (s) => s.fps),
    memory: stats(samples, (s) => s.memory),
    longTaskCount,
    longTaskMs,
    resizeFires,
    roFires,
    topDrawers: topDrawers(samples, 5),
    topSurfaces: topSurfaces(samples, 5),
  };
}

/** `hh:mm` for a span in ms (hours are not wrapped, so 26 h → "26:00"). */
export function formatSpan(ms: number): string {
  const totalMin = Math.floor(Math.max(0, ms) / 60_000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
}

// ─── Serialisation ───────────────────────────────────────────────────────────

export interface PerfLogJSON {
  version: 1;
  intervalMs: number;
  capacity: number;
  /** ISO time the export was produced. */
  exportedAt: string;
  samples: PerfSample[];
}

export const CSV_COLUMNS = [
  't', 'iso', 'gpu', 'gpuMax', 'fps', 'perfMode', 'vizMode',
  'surfaceCount', 'surfaces', 'longTasks', 'longTaskMs',
  'resizeFires', 'roFires', 'topDrawers', 'memoryBytes',
] as const;

/** RFC 4180-style quoting: wrap when the value holds a comma, quote, CR or
 *  LF; double any embedded quotes. Plain values pass through untouched. */
export function csvEscape(v: string | number | null | undefined): string {
  if (v == null) return '';
  const s = String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** `name:count;name:count` — compact per-sample drawer cell. Names are
 *  sanitised so the two separators can't be confused with content. */
export function encodeDrawers(list: readonly DrawCount[]): string {
  return list
    .map((d) => `${d.name.replace(/[:;]/g, '_')}:${d.count}`)
    .join(';');
}

export function toCSV(samples: readonly PerfSample[]): string {
  const lines: string[] = [CSV_COLUMNS.join(',')];
  for (const s of samples) {
    lines.push([
      s.t,
      new Date(s.t).toISOString(),
      s.gpu == null ? '' : round(s.gpu, 2),
      s.gpuMax == null ? '' : round(s.gpuMax, 2),
      s.fps,
      s.perfMode,
      s.vizMode,
      s.surfaces.length,
      s.surfaces.map((n) => n.replace(/\|/g, '_')).join('|'),
      s.longTasks,
      round(s.longTaskMs, 1),
      s.resizeFires,
      s.roFires,
      encodeDrawers(s.topDrawers),
      s.memory == null ? '' : s.memory,
    ].map(csvEscape).join(','));
  }
  return lines.join('\n') + '\n';
}

function round(v: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(v * f) / f;
}

// ─── Session log (buffer + tick driver) ──────────────────────────────────────

export interface SessionLogOptions {
  /** Builds one sample from the live counters. Provided by debug.ts. */
  collect: () => PerfSample;
  capacity?: number;
  intervalMs?: number;
}

/** A ring of samples plus the `tick()` that fills it. Timer-agnostic so it is
 *  testable; `startSessionLog` adds the real `setInterval`. */
export class SessionLog {
  readonly capacity: number;
  readonly intervalMs: number;
  private readonly ring: RingBuffer<PerfSample>;
  private readonly collect: () => PerfSample;

  constructor(opts: SessionLogOptions) {
    this.capacity = opts.capacity ?? DEFAULT_CAPACITY;
    this.intervalMs = opts.intervalMs ?? DEFAULT_INTERVAL_MS;
    this.ring = new RingBuffer<PerfSample>(this.capacity);
    this.collect = opts.collect;
  }

  get size(): number {
    return this.ring.size;
  }

  /** Take one sample now. Collector errors are swallowed so a broken probe
   *  can't take the interval down with it. */
  tick(): void {
    let s: PerfSample;
    try {
      s = this.collect();
    } catch (e) {
      console.warn('perf session log collector threw', e);
      return;
    }
    this.ring.push(s);
  }

  samples(): PerfSample[] {
    return this.ring.toArray();
  }

  last(): PerfSample | undefined {
    return this.ring.last();
  }

  clear(): void {
    this.ring.clear();
  }

  summary(): SessionSummary {
    return summarize(this.samples());
  }

  toJSON(): PerfLogJSON {
    return {
      version: 1,
      intervalMs: this.intervalMs,
      capacity: this.capacity,
      exportedAt: new Date().toISOString(),
      samples: this.samples(),
    };
  }

  toJSONString(): string {
    return JSON.stringify(this.toJSON());
  }

  toCSV(): string {
    return toCSV(this.samples());
  }

  /** Rebuild a log from an export (oldest → newest preserved; extra samples
   *  beyond `capacity` wrap exactly as live sampling would). */
  static fromJSON(json: PerfLogJSON, collect: () => PerfSample = () => { throw new Error('no collector'); }): SessionLog {
    if (json.version !== 1) throw new Error(`unsupported perf log version ${String((json as { version: unknown }).version)}`);
    const log = new SessionLog({ collect, capacity: json.capacity, intervalMs: json.intervalMs });
    for (const s of json.samples) log.ring.push(s);
    return log;
  }
}

export interface RunningSessionLog {
  log: SessionLog;
  /** Stops the interval and drops every retained sample. */
  stop: () => void;
}

/** Start sampling on a `setInterval`. The first sample is taken after one
 *  interval (not immediately) so its "since last sample" deltas cover a full
 *  window. Call `stop()` on perfDebug disable — it clears the buffer too. */
export function startSessionLog(opts: SessionLogOptions): RunningSessionLog {
  const log = new SessionLog(opts);
  const id = setInterval(() => log.tick(), log.intervalMs);
  return {
    log,
    stop: () => {
      clearInterval(id);
      log.clear();
    },
  };
}

/** `performance.memory.usedJSHeapSize` where the runtime exposes it
 *  (Chromium/WebView2); null elsewhere. Safe to call under node. */
export function readUsedJSHeap(): number | null {
  if (typeof performance === 'undefined') return null;
  const mem = (performance as unknown as { memory?: { usedJSHeapSize?: unknown } }).memory;
  const v = mem?.usedJSHeapSize;
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

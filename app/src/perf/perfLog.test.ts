import test from 'node:test';
import assert from 'node:assert/strict';
import {
  RingBuffer,
  SessionLog,
  CSV_COLUMNS,
  DEFAULT_CAPACITY,
  DEFAULT_INTERVAL_MS,
  MAX_TOP_DRAWERS,
  csvEscape,
  encodeDrawers,
  formatSpan,
  readUsedJSHeap,
  sortCounts,
  stats,
  summarize,
  toCSV,
  topDrawers,
  topSurfaces,
  type PerfSample,
} from './perfLog';

function sample(over: Partial<PerfSample> = {}): PerfSample {
  return {
    t: 1_700_000_000_000,
    gpu: 10,
    gpuMax: 12,
    fps: 60,
    perfMode: 'balanced',
    vizMode: 'milkdrop',
    surfaces: ['viz:milkdrop'],
    longTasks: 0,
    longTaskMs: 0,
    resizeFires: 0,
    roFires: 0,
    topDrawers: [{ name: 'milkdrop', count: 60 }],
    memory: 50_000_000,
    ...over,
  };
}

// ─── Ring buffer ─────────────────────────────────────────────────────────────

test('ring buffer never exceeds capacity and keeps the newest samples in order after wrap', () => {
  const ring = new RingBuffer<number>(4);
  for (let i = 1; i <= 10; i++) {
    ring.push(i);
    assert.ok(ring.size <= 4, `size ${ring.size} exceeded capacity at push ${i}`);
  }
  assert.equal(ring.size, 4);
  // Oldest → newest, exactly the last four pushed.
  assert.deepEqual(ring.toArray(), [7, 8, 9, 10]);
  assert.equal(ring.last(), 10);
});

test('ring buffer before wrap returns everything pushed, in order', () => {
  const ring = new RingBuffer<string>(5);
  ring.push('a'); ring.push('b'); ring.push('c');
  assert.deepEqual(ring.toArray(), ['a', 'b', 'c']);
  assert.equal(ring.size, 3);
  assert.equal(ring.last(), 'c');
});

test('ring buffer stays ordered through several full wraps', () => {
  const ring = new RingBuffer<number>(3);
  for (let i = 0; i < 100; i++) ring.push(i);
  assert.deepEqual(ring.toArray(), [97, 98, 99]);
  ring.push(100);
  assert.deepEqual(ring.toArray(), [98, 99, 100]);
});

test('ring buffer clear releases everything and accepts new pushes', () => {
  const ring = new RingBuffer<number>(3);
  ring.push(1); ring.push(2); ring.push(3); ring.push(4);
  ring.clear();
  assert.equal(ring.size, 0);
  assert.deepEqual(ring.toArray(), []);
  assert.equal(ring.last(), undefined);
  ring.push(9);
  assert.deepEqual(ring.toArray(), [9]);
});

test('ring buffer rejects a non-positive capacity', () => {
  assert.throws(() => new RingBuffer(0), RangeError);
  assert.throws(() => new RingBuffer(-1), RangeError);
  assert.throws(() => new RingBuffer(1.5), RangeError);
});

test('default capacity and interval retain two hours', () => {
  assert.equal(DEFAULT_CAPACITY * DEFAULT_INTERVAL_MS, 2 * 60 * 60 * 1000);
});

// ─── Aggregation ─────────────────────────────────────────────────────────────

test('stats computes min/avg/max/p95 on known data', () => {
  // 1..100 → min 1, max 100, avg 50.5, nearest-rank p95 = value at rank 95.
  const samples = Array.from({ length: 100 }, (_, i) => sample({ gpu: i + 1 }));
  const s = stats(samples, (x) => x.gpu);
  assert.ok(s);
  assert.equal(s.n, 100);
  assert.equal(s.min, 1);
  assert.equal(s.max, 100);
  assert.equal(s.avg, 50.5);
  assert.equal(s.p95, 95);
});

test('stats ignores null and non-finite picks and returns null when nothing is left', () => {
  const samples = [
    sample({ gpu: null }),
    sample({ gpu: 20 }),
    sample({ gpu: Number.NaN }),
    sample({ gpu: 40 }),
  ];
  const s = stats(samples, (x) => x.gpu);
  assert.ok(s);
  assert.equal(s.n, 2);
  assert.equal(s.min, 20);
  assert.equal(s.max, 40);
  assert.equal(s.avg, 30);
  assert.equal(s.p95, 40);
  assert.equal(stats([sample({ gpu: null })], (x) => x.gpu), null);
  assert.equal(stats([], (x) => x.gpu), null);
});

test('stats p95 on a single value is that value', () => {
  const s = stats([sample({ fps: 42 })], (x) => x.fps);
  assert.ok(s);
  assert.deepEqual(s, { n: 1, min: 42, avg: 42, max: 42, p95: 42 });
});

test('topDrawers sums per-name counts across samples and ranks by total', () => {
  const samples = [
    sample({ topDrawers: [{ name: 'a', count: 5 }, { name: 'b', count: 1 }] }),
    sample({ topDrawers: [{ name: 'b', count: 10 }, { name: 'c', count: 2 }] }),
    sample({ topDrawers: [{ name: 'a', count: 3 }] }),
  ];
  assert.deepEqual(topDrawers(samples), [
    { name: 'b', count: 11 },
    { name: 'a', count: 8 },
    { name: 'c', count: 2 },
  ]);
  assert.deepEqual(topDrawers(samples, 1), [{ name: 'b', count: 11 }]);
  assert.deepEqual(topDrawers([]), []);
});

test('topSurfaces counts how many samples each surface was mounted in', () => {
  const samples = [
    sample({ surfaces: ['viz', 'gallery'] }),
    sample({ surfaces: ['viz'] }),
    sample({ surfaces: ['viz', 'onboarding'] }),
  ];
  assert.deepEqual(topSurfaces(samples), [
    { name: 'viz', count: 3 },
    { name: 'gallery', count: 1 },
    { name: 'onboarding', count: 1 },
  ]);
});

test('sortCounts drops zero counts, sorts desc then by name, and honours the cap', () => {
  const m = new Map<string, number>([['z', 2], ['a', 2], ['idle', 0], ['hot', 9]]);
  assert.deepEqual(sortCounts(m), [
    { name: 'hot', count: 9 },
    { name: 'a', count: 2 },
    { name: 'z', count: 2 },
  ]);
  assert.deepEqual(sortCounts(m, 2), [
    { name: 'hot', count: 9 },
    { name: 'a', count: 2 },
  ]);
  assert.ok(MAX_TOP_DRAWERS > 0);
});

test('summarize totals the counters and measures the span between first and last sample', () => {
  const t0 = 1_700_000_000_000;
  const samples = [
    sample({ t: t0, gpu: 10, fps: 60, longTasks: 1, longTaskMs: 80, resizeFires: 1, roFires: 2 }),
    sample({ t: t0 + 2000, gpu: 30, fps: 30, longTasks: 2, longTaskMs: 120, resizeFires: 0, roFires: 5 }),
    sample({ t: t0 + 4000, gpu: 20, fps: 60, longTasks: 0, longTaskMs: 0, resizeFires: 0, roFires: 0 }),
  ];
  const s = summarize(samples);
  assert.equal(s.samples, 3);
  assert.equal(s.spanMs, 4000);
  assert.equal(s.gpu?.avg, 20);
  assert.equal(s.gpu?.max, 30);
  assert.equal(s.fps?.avg, 50);
  assert.equal(s.longTaskCount, 3);
  assert.equal(s.longTaskMs, 200);
  assert.equal(s.resizeFires, 1);
  assert.equal(s.roFires, 7);
  assert.deepEqual(s.topDrawers, [{ name: 'milkdrop', count: 180 }]);
  assert.deepEqual(s.topSurfaces, [{ name: 'viz:milkdrop', count: 3 }]);
});

test('summarize of an empty or single-sample log has zero span and null stats where empty', () => {
  const empty = summarize([]);
  assert.equal(empty.samples, 0);
  assert.equal(empty.spanMs, 0);
  assert.equal(empty.gpu, null);
  assert.equal(empty.fps, null);
  const one = summarize([sample()]);
  assert.equal(one.samples, 1);
  assert.equal(one.spanMs, 0);
});

test('formatSpan renders hh:mm without wrapping hours', () => {
  assert.equal(formatSpan(0), '00:00');
  assert.equal(formatSpan(59_999), '00:00');
  assert.equal(formatSpan(60_000), '00:01');
  assert.equal(formatSpan(2 * 3_600_000 + 5 * 60_000), '02:05');
  assert.equal(formatSpan(26 * 3_600_000), '26:00');
  assert.equal(formatSpan(-5), '00:00');
});

// ─── CSV ─────────────────────────────────────────────────────────────────────

test('csvEscape quotes only when needed and doubles embedded quotes', () => {
  assert.equal(csvEscape('plain'), 'plain');
  assert.equal(csvEscape(12.5), '12.5');
  assert.equal(csvEscape(null), '');
  assert.equal(csvEscape(undefined), '');
  assert.equal(csvEscape('a,b'), '"a,b"');
  assert.equal(csvEscape('say "hi"'), '"say ""hi"""');
  assert.equal(csvEscape('line\nbreak'), '"line\nbreak"');
});

test('encodeDrawers produces name:count;name:count and sanitises separators in names', () => {
  assert.equal(encodeDrawers([{ name: 'a', count: 3 }, { name: 'b', count: 1 }]), 'a:3;b:1');
  assert.equal(encodeDrawers([{ name: 'x:y;z', count: 2 }]), 'x_y_z:2');
  assert.equal(encodeDrawers([]), '');
});

test('toCSV emits a header row plus one flattened row per sample', () => {
  const s = sample({
    t: Date.UTC(2026, 8, 6, 12, 0, 0),
    gpu: 12.3456,
    gpuMax: 20,
    surfaces: ['viz', 'gallery'],
    longTaskMs: 83.26,
    topDrawers: [{ name: 'a', count: 3 }, { name: 'b', count: 1 }],
    memory: 123456,
  });
  const csv = toCSV([s]);
  const lines = csv.split('\n');
  assert.equal(lines[0], CSV_COLUMNS.join(','));
  assert.equal(lines[1], [
    String(s.t), '2026-09-06T12:00:00.000Z', '12.35', '20', '60', 'balanced', 'milkdrop',
    '2', 'viz|gallery', '0', '83.3', '0', '0', 'a:3;b:1', '123456',
  ].join(','));
  assert.equal(lines[2], '', 'file ends with a trailing newline');
  assert.equal(lines.length, 3);
});

test('toCSV leaves null gpu/memory cells empty and escapes commas in mode names', () => {
  const csv = toCSV([sample({ gpu: null, gpuMax: null, memory: null, perfMode: 'custom, 30fps', surfaces: [], topDrawers: [] })]);
  const row = csv.split('\n')[1]!;
  assert.ok(row.includes('"custom, 30fps"'), row);
  const cells = row.split(',');
  // The quoted mode name holds one comma, so the raw split has one extra cell.
  assert.equal(cells.length, CSV_COLUMNS.length + 1);
  // gpu and gpuMax come right after the iso column.
  assert.equal(cells[2], '');
  assert.equal(cells[3], '');
  assert.equal(cells[cells.length - 1], '', 'memory cell empty');
});

test('toCSV of no samples is just the header', () => {
  assert.equal(toCSV([]), CSV_COLUMNS.join(',') + '\n');
});

// ─── SessionLog + JSON round-trip ────────────────────────────────────────────

test('SessionLog.tick pulls from the collector and wraps at capacity', () => {
  let i = 0;
  const log = new SessionLog({ capacity: 3, intervalMs: 2000, collect: () => sample({ t: ++i }) });
  assert.equal(log.size, 0);
  for (let k = 0; k < 5; k++) log.tick();
  assert.equal(log.size, 3);
  assert.deepEqual(log.samples().map((s) => s.t), [3, 4, 5]);
  assert.equal(log.last()?.t, 5);
  log.clear();
  assert.equal(log.size, 0);
});

test('SessionLog swallows a throwing collector instead of dying', () => {
  let calls = 0;
  const origWarn = console.warn;
  console.warn = () => {};
  try {
    const log = new SessionLog({
      capacity: 5,
      collect: () => {
        calls++;
        if (calls === 2) throw new Error('probe broke');
        return sample({ t: calls });
      },
    });
    log.tick(); log.tick(); log.tick();
    assert.deepEqual(log.samples().map((s) => s.t), [1, 3]);
  } finally {
    console.warn = origWarn;
  }
});

test('JSON export round-trips through fromJSON with order and metadata intact', () => {
  let i = 0;
  const log = new SessionLog({ capacity: 4, intervalMs: 5000, collect: () => sample({ t: ++i, gpu: i * 10 }) });
  for (let k = 0; k < 6; k++) log.tick();
  const text = log.toJSONString();
  const parsed = JSON.parse(text);
  assert.equal(parsed.version, 1);
  assert.equal(parsed.intervalMs, 5000);
  assert.equal(parsed.capacity, 4);
  assert.equal(typeof parsed.exportedAt, 'string');
  assert.equal(parsed.samples.length, 4);

  const back = SessionLog.fromJSON(parsed);
  assert.equal(back.capacity, 4);
  assert.equal(back.intervalMs, 5000);
  assert.deepEqual(back.samples(), log.samples());
  assert.deepEqual(back.summary(), log.summary());
  // A restored log is read-only unless given a collector.
  const origWarn = console.warn;
  console.warn = () => {};
  try {
    back.tick();
    assert.equal(back.size, 4);
  } finally {
    console.warn = origWarn;
  }
});

test('fromJSON rejects an unknown version', () => {
  assert.throws(
    () => SessionLog.fromJSON({ version: 2, intervalMs: 1, capacity: 1, exportedAt: '', samples: [] } as never),
    /unsupported perf log version 2/,
  );
});

test('SessionLog.toCSV and summary agree with the standalone helpers', () => {
  let i = 0;
  const log = new SessionLog({ capacity: 10, collect: () => sample({ t: 1000 * ++i }) });
  log.tick(); log.tick();
  assert.equal(log.toCSV(), toCSV(log.samples()));
  assert.deepEqual(log.summary(), summarize(log.samples()));
});

// ─── Purity / node-safety ────────────────────────────────────────────────────

test('module is DOM-free: readUsedJSHeap is null-or-number under node and nothing needs window', () => {
  assert.equal(typeof (globalThis as { window?: unknown }).window, 'undefined');
  const v = readUsedJSHeap();
  assert.ok(v === null || (typeof v === 'number' && Number.isFinite(v)));
});

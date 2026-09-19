/** Deterministic gate/observer audit through the production HUD store.
 * This is a simulated vsync trace, NOT a CPU/GPU benchmark. */
import { writeFileSync, unlinkSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { animateFrame, createAnimatePace } from '../src/state/animatePace';
import { paceFrame } from '../src/state/framePace';
import { idleFpsCap } from '../src/state/idlePace';
import * as after from '../src/perf/debug';
let now = 0;
Object.defineProperty(globalThis, 'performance', { value: { now: () => now }, configurable: true });
class Observer {
  static callbacks: (() => void)[] = [];
  constructor(cb: (...args: unknown[]) => void) { Observer.callbacks.push(() => cb([{}], this)); }
}
Object.defineProperty(globalThis, 'window', { value: {
  ResizeObserver: Observer, addEventListener() {}, removeEventListener() {},
}, configurable: true });
const beforePath = new URL('../src/perf/.audit-before.ts', import.meta.url);
writeFileSync(beforePath, execFileSync('git', ['show', '215f8c7:app/src/perf/debug.ts']));
const before = await import(beforePath.href);
try {
  const results: unknown[] = [];
  const sessionSamples: unknown[] = [];
  for (const [label, debug] of [['before', before], ['after', after]] as const) {
    for (const cap of [120, 60, 24]) {
      debug.enable();
      const state = createAnimatePace(0);
      const global = { nextDue: 0 }, idle = { nextDue: 0 };
      let lastLiveAt = 0;
      const idleDraws: number[] = [];
      for (let i = 0; i < 144 * 135; i++) {
        now = i * 1000 / 144;
        const live = now < 1000 || now >= 130000;
        let draw: boolean;
        if (label === 'after') draw = animateFrame(now, state, false, live, cap);
        else {
          if (live) lastLiveAt = now;
          const idleCap = live ? null : idleFpsCap(now - lastLiveAt);
          draw = (idleCap === null || paceFrame(now, idle, 1000 / idleCap)) && paceFrame(now, global, 1000 / cap);
        }
        if (draw) {
          debug.recordDraw('audit-viz');
          if (now >= 15000 && now < 20000) idleDraws.push(now);
        }
        if ([1439, 2879, 18719, 19439].includes(i)) {
          const snapshot = debug.getSnapshot();
          if (label === 'after') after.getSessionLog()!.tick();
          results.push({ label, cap, atMs: now, drawsPerSec: snapshot.drawRatesByName[0]?.perSec ?? 0 });
        }
      }
      const gaps = idleDraws.slice(1).map((time, i) => time - idleDraws[i]!);
      results.push({ label, cap, idleGapMinMs: Math.min(...gaps), idleGapMaxMs: Math.max(...gaps) });
      if (label === 'after') sessionSamples.push(...after.getSessionLog()!.samples());
      debug.disable();
    }
    Observer.callbacks = [];
    debug.enable();
    const RO = (window as unknown as { ResizeObserver: typeof Observer }).ResizeObserver;
    new RO(() => {});
    debug.disable();
    for (let i = 0; i < 100; i++) Observer.callbacks[0]!();
    results.push({ label, disabledObserverFires: debug.getSnapshot().roFiresLast5s });
  }
  const output = { baseline: '215f8c7', kind: 'deterministic simulated vsync through HUD; not hardware performance', vsyncHz: 144, results, sessionSamples };
  mkdirSync('../docs/performance', { recursive: true });
  writeFileSync('../docs/performance/2026-09-19-gate-measurements.json', JSON.stringify(output, null, 2));
  console.log(JSON.stringify(results, null, 2));
} finally { before.disable(); unlinkSync(beforePath); }

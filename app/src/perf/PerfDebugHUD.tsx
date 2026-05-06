/** Live performance-debug HUD.
 *
 * Renders a fixed-position panel in the top-right of the viewport. Subscribes
 * to the perf debug store and refreshes ~4Hz. Cheap to render — only rebuilds
 * when the store notifies. Hidden entirely unless `tweaks.perfDebug` is on.
 */

import { useEffect, useState } from 'react';
import {
  type PerfSnapshot,
  type SpikeRecord,
  getSnapshot,
  subscribe,
  clearSpikes,
} from './debug';
import { getVizMaxFps } from '../components/viz';

export function PerfDebugHUD() {
  const [snap, setSnap] = useState<PerfSnapshot>(() => getSnapshot());
  const [collapsed, setCollapsed] = useState(false);
  const [showSpikes, setShowSpikes] = useState(true);

  useEffect(() => {
    // Re-render on store notify, throttled by rAF so a burst of long tasks
    // doesn't itself cause re-render thrash.
    let pending = false;
    const refresh = () => {
      pending = false;
      setSnap(getSnapshot());
    };
    const unsub = subscribe(() => {
      if (pending) return;
      pending = true;
      requestAnimationFrame(refresh);
    });
    // Also refresh every 500ms even without notifies — keeps draw rates ticking
    // even when no spikes are firing.
    const id = setInterval(refresh, 500);
    return () => { unsub(); clearInterval(id); };
  }, []);

  if (!snap.enabled) return null;

  const gpuColor = (v: number | null) => {
    if (v == null) return '#94a3b8';
    if (v - snap.gpuBaseline >= 15) return '#fb7185';
    if (v - snap.gpuBaseline >= 8) return '#facc15';
    return '#4ade80';
  };

  const longTaskColor = snap.longTaskMaxLast5s >= 100
    ? '#fb7185'
    : snap.longTaskMaxLast5s >= 50
    ? '#facc15'
    : '#4ade80';

  // Sum of all per-viz draw rates over the last 5s — this is the actual
  // gated draw rate, which is what perfMode caps. If this exceeds the cap,
  // the gate is misconfigured. If it's far below, the viz is idle/paused.
  const drawsTotal = snap.drawRatesByName.reduce((s, d) => s + d.perSec, 0);
  const cap = getVizMaxFps();
  // rAF rate is your monitor refresh; cap-vs-rAF mismatch is normal and not
  // itself a strain source — the per-viz gate handles it. Color the rAF
  // value yellow if it's well above cap so it's clear that's expected.
  const rafColor = snap.fps >= 55 ? '#4ade80' : snap.fps >= 30 ? '#facc15' : '#fb7185';
  const drawColor =
    cap > 0 && drawsTotal > cap * 1.1 ? '#fb7185'
    : drawsTotal > 0 ? '#4ade80'
    : '#94a3b8';

  return (
    <div
      style={{
        position: 'fixed',
        top: 12,
        right: 12,
        width: collapsed ? 'auto' : 320,
        maxHeight: '90vh',
        overflowY: 'auto',
        zIndex: 9999,
        padding: 10,
        background: 'rgba(8,9,12,0.92)',
        backdropFilter: 'blur(8px)',
        border: '1px solid rgba(255,255,255,0.12)',
        borderRadius: 8,
        color: 'rgba(255,255,255,0.85)',
        fontFamily: '"JetBrains Mono", ui-monospace, monospace',
        fontSize: 10.5,
        lineHeight: 1.55,
        pointerEvents: 'auto',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: collapsed ? 0 : 8 }}>
        <span style={{ fontWeight: 700, color: '#a78bfa' }}>● PERF DEBUG</span>
        <div style={{ flex: 1 }} />
        <button
          onClick={() => setCollapsed((v) => !v)}
          style={hudBtn}
        >{collapsed ? '▸' : '▾'}</button>
      </div>

      {!collapsed && (
        <>
          {/* Top-line gauges */}
          <Row>
            <Gauge label="GPU" value={snap.gpuLatest != null ? `${snap.gpuLatest.toFixed(1)}%` : '—'} color={gpuColor(snap.gpuLatest)} />
            <Gauge label="base" value={`${snap.gpuBaseline.toFixed(1)}%`} color="#94a3b8" />
          </Row>

          {/* GPU sparkline (last 30s, 1s buckets) */}
          <Sparkline values={snap.gpuSparkline} />

          {/* rAF Hz (raw monitor refresh, unaffected by cap) vs draws/s
              (sum of all per-viz gated draws — what perfMode actually caps).
              Higher rAF than cap is NORMAL — it's your refresh rate, and the
              gate inside each viz tick bails when over the cap. */}
          <Row>
            <Gauge label="rAF Hz" value={snap.fps.toString()} color={rafColor} />
            <Gauge label="cap" value={cap > 0 ? cap.toString() : '∞'} color="#94a3b8" />
            <Gauge label="draws/s" value={drawsTotal.toFixed(0)} color={drawColor} />
          </Row>

          <Row>
            <Gauge label="mode" value={snap.perfMode} color="#a78bfa" />
            <Gauge label="viz" value={snap.vizMode} color="#a78bfa" />
          </Row>

          {/* Long-task summary */}
          <Section title="Long tasks (last 5s)">
            <Row>
              <Gauge label="count" value={snap.longTaskCountLast5s.toString()} color={longTaskColor} />
              <Gauge label="max" value={`${snap.longTaskMaxLast5s.toFixed(0)}ms`} color={longTaskColor} />
            </Row>
          </Section>

          <Section title="Resize fires (last 5s)">
            <Row>
              <Gauge label="window" value={snap.resizesLast5s.toString()} color={snap.resizesLast5s > 5 ? '#facc15' : '#94a3b8'} />
              <Gauge label="RO" value={snap.roFiresLast5s.toString()} color={snap.roFiresLast5s > 20 ? '#fb7185' : snap.roFiresLast5s > 10 ? '#facc15' : '#94a3b8'} />
            </Row>
          </Section>

          <Section title={`Mounted surfaces (${snap.surfaces.length})`}>
            <div style={{ color: 'rgba(255,255,255,0.65)', wordBreak: 'break-all' }}>
              {snap.surfaces.length ? snap.surfaces.join(' · ') : '—'}
            </div>
          </Section>

          <Section title="Per-viz draw rate (last 5s)">
            {snap.drawRatesByName.length === 0 ? (
              <div style={{ color: 'rgba(255,255,255,0.5)' }}>no draws recorded</div>
            ) : (
              snap.drawRatesByName.map((d) => (
                <div key={d.name} style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'rgba(255,255,255,0.7)' }}>{d.name}</span>
                  <span style={{ color: '#4ade80' }}>{d.perSec.toFixed(1)}/s</span>
                </div>
              ))
            )}
          </Section>

          <Section
            title={`Spikes (${snap.spikes.length})`}
            right={
              <>
                <button onClick={() => setShowSpikes((v) => !v)} style={hudBtn}>{showSpikes ? 'hide' : 'show'}</button>
                <button onClick={() => clearSpikes()} style={hudBtn}>clear</button>
              </>
            }
          >
            {showSpikes && (
              snap.spikes.length === 0 ? (
                <div style={{ color: 'rgba(255,255,255,0.5)' }}>none — try playing audio + changing perf mode</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {snap.spikes.slice().reverse().map((s, i) => (
                    <SpikeCard key={`${s.ts}-${i}`} spike={s} />
                  ))}
                </div>
              )
            )}
          </Section>
        </>
      )}
    </div>
  );
}

const hudBtn: React.CSSProperties = {
  background: 'rgba(255,255,255,0.06)',
  border: '1px solid rgba(255,255,255,0.1)',
  color: 'rgba(255,255,255,0.7)',
  fontFamily: 'inherit',
  fontSize: 10,
  padding: '2px 6px',
  borderRadius: 3,
  cursor: 'pointer',
  marginLeft: 4,
};

function Row({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4 }}>{children}</div>
  );
}

function Gauge({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={{
      flex: 1,
      padding: '4px 6px',
      background: 'rgba(255,255,255,0.03)',
      border: '1px solid rgba(255,255,255,0.06)',
      borderRadius: 4,
      display: 'flex', flexDirection: 'column', alignItems: 'flex-start',
    }}>
      <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.45)', textTransform: 'uppercase', letterSpacing: '.08em' }}>{label}</span>
      <span style={{ color, fontWeight: 700, fontSize: 12 }}>{value}</span>
    </div>
  );
}

function Section({ title, children, right }: { title: string; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div style={{ marginTop: 8 }}>
      <div style={{
        display: 'flex', alignItems: 'center',
        fontSize: 9, color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase', letterSpacing: '.08em',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
        paddingBottom: 2, marginBottom: 4,
      }}>
        <span style={{ flex: 1 }}>{title}</span>
        {right}
      </div>
      {children}
    </div>
  );
}

function Sparkline({ values }: { values: number[] }) {
  // Auto-scale to max so a baseline shift is visible. Floor at 30 so an idle
  // GPU doesn't render the noise as huge swings.
  const max = Math.max(30, ...values);
  const W = 300, H = 30;
  const stepX = W / Math.max(1, values.length - 1);
  return (
    <svg width={W} height={H} style={{ display: 'block', marginBottom: 4 }}>
      <rect x={0} y={0} width={W} height={H} fill="rgba(255,255,255,0.03)" />
      <polyline
        fill="none"
        stroke="#a78bfa"
        strokeWidth="1.5"
        points={values.map((v, i) => `${i * stepX},${H - (v / max) * (H - 2) - 1}`).join(' ')}
      />
    </svg>
  );
}

function SpikeCard({ spike }: { spike: SpikeRecord }) {
  const top = spike.topDrawers.slice(0, 3)
    .map((d) => `${d.name}×${d.count}`).join(' · ');
  return (
    <div style={{
      padding: 6,
      border: '1px solid rgba(251,113,133,0.3)',
      borderRadius: 4,
      background: 'rgba(251,113,133,0.05)',
      fontSize: 10,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
        <span style={{ color: '#fb7185', fontWeight: 700 }}>
          {spike.gpu.toFixed(1)}% (+{spike.delta.toFixed(1)})
        </span>
        <span style={{ color: 'rgba(255,255,255,0.5)' }}>{spike.wallTime}</span>
      </div>
      <div style={{ color: 'rgba(255,255,255,0.7)' }}>
        {spike.perfMode}/{spike.vizMode} · {spike.fps}fps
      </div>
      {spike.surfaces.length > 0 && (
        <div style={{ color: 'rgba(255,255,255,0.55)', wordBreak: 'break-all' }}>
          surfaces: {spike.surfaces.join(', ')}
        </div>
      )}
      {top && (
        <div style={{ color: 'rgba(255,255,255,0.55)' }}>
          drew: {top}
        </div>
      )}
      {(spike.recentLongTasks.length > 0 || spike.resizesPrior > 0 || spike.roFiresPrior > 0) && (
        <div style={{ color: 'rgba(255,255,255,0.55)' }}>
          prior 2s: {spike.recentLongTasks.length > 0 && (
            <span style={{ color: '#fb7185' }}>
              {spike.recentLongTasks.length} longtask{spike.recentLongTasks.length === 1 ? '' : 's'}
              {(() => {
                const max = spike.recentLongTasks.reduce((m, t) => Math.max(m, t.duration), 0);
                return ` (max ${max.toFixed(0)}ms)`;
              })()}
            </span>
          )}
          {spike.resizesPrior > 0 && <span> · {spike.resizesPrior} resize</span>}
          {spike.roFiresPrior > 0 && <span style={{ color: spike.roFiresPrior > 20 ? '#fb7185' : '#facc15' }}> · {spike.roFiresPrior} RO-fires</span>}
        </div>
      )}
      {spike.recentLongTasks.length > 0 && (
        <div style={{ color: 'rgba(255,255,255,0.45)', fontSize: 9 }}>
          longtask attribution: {Array.from(new Set(spike.recentLongTasks.map((t) => t.attributedTo ?? '?'))).join(', ')}
        </div>
      )}
    </div>
  );
}

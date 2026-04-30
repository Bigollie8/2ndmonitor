import React, { useEffect, useRef, useState, type MutableRefObject } from 'react';
import { getDensity } from '../data';
import type { Density, Track, SysmonHistory } from '../types';
import { type Playback, type SpectrumState, mediaControls } from '../state/tauri';

export function HFTile({
  title, badge, headRight, children, accent, density = 'regular', noHead, style, onClick,
}: {
  title?: React.ReactNode;
  badge?: React.ReactNode;
  headRight?: React.ReactNode;
  children?: React.ReactNode;
  accent?: string;
  density?: Density;
  noHead?: boolean;
  style?: React.CSSProperties;
  onClick?: () => void;
}) {
  const D = getDensity(density);
  return (
    <div onClick={onClick} style={{
      background: 'rgba(22,24,30,0.78)',
      backdropFilter: 'blur(20px) saturate(140%)',
      WebkitBackdropFilter: 'blur(20px) saturate(140%)',
      border: '1px solid rgba(255,255,255,0.06)',
      borderRadius: 14,
      overflow: 'hidden',
      position: 'relative',
      display: 'flex',
      flexDirection: 'column',
      boxShadow: accent ? `0 0 0 1px ${accent}33, 0 0 30px -8px ${accent}55` : '0 8px 24px -8px rgba(0,0,0,0.4)',
      ...style,
    }}>
      {!noHead && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: `${D.headerPad}px ${D.pad}px`,
          fontSize: 10, color: 'rgba(255,255,255,0.55)',
          letterSpacing: '0.08em', textTransform: 'uppercase', fontWeight: 600,
          flexShrink: 0,
        }}>
          <span style={{ flex: 1 }}>{title}</span>
          {badge}
          {headRight}
        </div>
      )}
      <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>{children}</div>
    </div>
  );
}

export function Sparkline({ data, color, height = 28, width = '100%' }: { data: number[]; color: string; height?: number | string; width?: number | string }) {
  if (data.length < 2) return null;
  const pts = data.map((v, i) => `${(i / (data.length - 1)) * 100},${100 - v * 100}`).join(' ');
  return (
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ width, height, display: 'block' }}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="2" vectorEffect="non-scaling-stroke" />
      <polyline points={`0,100 ${pts} 100,100`} fill={color} opacity="0.12" />
    </svg>
  );
}

const iconBtn = (): React.CSSProperties => ({
  background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.08)',
  color: 'rgba(255,255,255,0.85)', width: 28, height: 28, borderRadius: 999,
  display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
  fontSize: 11, padding: 0,
});

// ── Discord ──────────────────────────────────────────────────────────────────
export function DiscordTile({ density, accent }: { density: Density; accent: string }) {
  const messages = [
    { user: 'maya',  color: '#fb7185', time: '14:28', text: 'pushed the new viz preset, take a look when you get a sec' },
    { user: 'me',    color: accent,    time: '14:29', text: 'omw — the radial mode looks unreal' },
    { user: 'alex',  color: '#60a5fa', time: '14:31', text: 'also the bass response is way better now 🔥' },
    { user: 'jules', color: '#a78bfa', time: '14:32', text: 'shipping the build today still?' },
  ];
  return (
    <HFTile title="Discord — # design-log" density={density}
            badge={<span style={{ background: '#22c55e', width: 6, height: 6, borderRadius: 999 }} />}
            headRight={<span style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)' }}>4 online</span>}
            style={{ height: '100%' }}>
      <div style={{ display: 'flex', height: '100%' }}>
        <div style={{ width: 44, padding: '8px 0', display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'center', borderRight: '1px solid rgba(255,255,255,0.05)', background: 'rgba(0,0,0,0.2)' }}>
          {[
            { c: accent, active: true, l: 'D' },
            { c: '#fb7185', l: 'P' },
            { c: '#60a5fa', l: 'M' },
            { c: '#a78bfa', l: 'A' },
            { c: '#facc15', l: 'G' },
          ].map((s, i) => (
            <div key={i} style={{
              width: 30, height: 30,
              borderRadius: s.active ? 9 : 999,
              background: s.active ? `linear-gradient(135deg, ${accent}, ${accent}aa)` : 'rgba(255,255,255,0.07)',
              border: s.active ? 'none' : '1px solid rgba(255,255,255,0.08)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: s.active ? '#000' : 'rgba(255,255,255,0.7)',
              fontSize: 12, fontWeight: 700,
              boxShadow: s.active ? `0 0 16px ${accent}66` : 'none',
            }}>{s.l}</div>
          ))}
        </div>
        <div style={{ width: 130, padding: '10px 8px', borderRight: '1px solid rgba(255,255,255,0.05)' }}>
          <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 8, padding: '0 6px' }}>Channels</div>
          {[
            { n: '# general' },
            { n: '# design-log', active: true, unread: 2 },
            { n: '# eng' },
            { n: '# random' },
            { n: '# music', unread: 5 },
          ].map((c) => (
            <div key={c.n} style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '5px 8px', fontSize: 11.5, color: c.active ? '#fff' : 'rgba(255,255,255,0.6)',
              background: c.active ? 'rgba(255,255,255,0.06)' : 'transparent',
              borderRadius: 5, marginBottom: 1,
            }}>
              <span>{c.n}</span>
              {c.unread != null && <span style={{ background: accent, color: '#000', fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 6 }}>{c.unread}</span>}
            </div>
          ))}
        </div>
        <div style={{ flex: 1, padding: 12, display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0, overflow: 'hidden' }}>
          {messages.map((m, i) => (
            <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
              <div style={{ width: 26, height: 26, borderRadius: 999, background: m.color + '33', border: `1px solid ${m.color}66`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: m.color, fontSize: 11, fontWeight: 700, flexShrink: 0 }}>
                {m.user[0].toUpperCase()}
              </div>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                  <span style={{ fontSize: 11.5, fontWeight: 600, color: m.color }}>{m.user}</span>
                  <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)' }}>{m.time}</span>
                </div>
                <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.85)', lineHeight: 1.45 }}>{m.text}</div>
              </div>
            </div>
          ))}
          <div style={{ flex: 1 }} />
          <div style={{ background: 'rgba(0,0,0,0.3)', borderRadius: 8, padding: '8px 10px', fontSize: 11, color: 'rgba(255,255,255,0.4)', border: '1px solid rgba(255,255,255,0.05)' }}>
            Message # design-log
          </div>
        </div>
      </div>
    </HFTile>
  );
}

// ── Spotify ──────────────────────────────────────────────────────────────────
function formatMMSS(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) return '0:00';
  const total = Math.floor(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/** Estimate "now" position from the last GSMTC sync, ticking 1Hz when playing. */
function useLivePosition(playback: Playback | null): number {
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

export function SpotifyTile({ density, accent, accent2, track, onPick: _onPick, playback, spectrumRef }: {
  density: Density;
  accent: string;
  accent2: string;
  track: Track;
  onPick: (t: Track) => void;
  playback?: Playback | null;
  spectrumRef?: MutableRefObject<SpectrumState>;
}) {
  const position = useLivePosition(playback ?? null);
  const duration = playback?.duration ?? 0;
  const havePlayback = !!playback && duration > 0;
  const progressPct = havePlayback ? Math.min(100, (position / duration) * 100) : 0;
  const positionLabel = havePlayback ? formatMMSS(position) : '—';
  const durationLabel = havePlayback ? formatMMSS(duration) : '—';
  const liveBadgeColor = playback?.playing ? '#22c55e' : accent;
  const liveBadgeText = playback ? (playback.playing ? '● LIVE' : '⏸ PAUSED') : '● LIVE';
  return (
    <HFTile title="Now playing" density={density}
            badge={<span style={{ fontSize: 9, color: liveBadgeColor, padding: '2px 6px', borderRadius: 4, background: liveBadgeColor + '15', border: `1px solid ${liveBadgeColor}33`, letterSpacing: '.05em' }}>{liveBadgeText}</span>}
            style={{ height: '100%' }}>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        {/* Big album art — fills the available height while staying square */}
        <div style={{
          flex: '1 1 auto',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: '12px 12px 8px', minHeight: 0, overflow: 'hidden',
        }}>
          <div style={{
            aspectRatio: '1 / 1',
            maxWidth: 'min(100%, 230px)',
            maxHeight: '100%',
            width: '100%',
            borderRadius: 12,
            background: track.cover,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
            boxShadow: `0 14px 44px ${accent}66, 0 0 0 1px rgba(255,255,255,0.04)`,
            position: 'relative',
            overflow: 'hidden',
          }}>
            {/* Soft inner-light overlay only when the cover is procedural (no real art). */}
            {!track.cover.startsWith('center') && (
              <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(circle at 30% 30%, rgba(255,255,255,0.28), transparent 60%)' }} />
            )}
          </div>
        </div>

        {/* Track info */}
        <div style={{ padding: '0 14px', flexShrink: 0, textAlign: 'center' }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{track.title}</div>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.7)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{track.artist}</div>
          {track.album && (
            <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{track.album}</div>
          )}
        </div>

        {/* Progress + time */}
        <div style={{ padding: '10px 14px 6px', flexShrink: 0 }}>
          <div style={{ height: 3, background: 'rgba(255,255,255,0.1)', borderRadius: 2, position: 'relative', overflow: 'hidden' }}>
            <div style={{
              position: 'absolute', left: 0, top: 0, bottom: 0, width: `${progressPct}%`,
              background: `linear-gradient(90deg, ${accent2}, ${accent})`,
              borderRadius: 2,
              transition: havePlayback ? 'width 0.25s linear' : 'none',
            }} />
            <div style={{
              position: 'absolute', left: `${progressPct}%`, top: '50%', transform: 'translate(-50%,-50%)',
              width: 9, height: 9, background: '#fff', borderRadius: 999,
              boxShadow: `0 0 8px ${accent}`,
              transition: havePlayback ? 'left 0.25s linear' : 'none',
            }} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'rgba(255,255,255,0.4)', fontFamily: '"JetBrains Mono", ui-monospace, monospace', marginTop: 4 }}>
            <span>{positionLabel}</span><span>{durationLabel}</span>
          </div>
        </div>

        {/* Controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, justifyContent: 'center', padding: '4px 0 8px', flexShrink: 0 }}>
          <button title="Previous" onClick={() => mediaControls.previous()} style={{ ...iconBtn(), width: 32, height: 32 }}>⏮</button>
          <button
            title={playback?.playing ? 'Pause' : 'Play'}
            onClick={() => mediaControls.togglePlayPause()}
            style={{ ...iconBtn(), width: 44, height: 44, background: '#fff', color: '#000', borderRadius: 999, fontSize: 16 }}
          >{playback?.playing ? '⏸' : '⏵'}</button>
          <button title="Next" onClick={() => mediaControls.next()} style={{ ...iconBtn(), width: 32, height: 32 }}>⏭</button>
        </div>

        {/* Mini reactive visualizer fills the previous dead space at the bottom */}
        {spectrumRef && <SpotifyMiniViz accent={accent} accent2={accent2} spectrumRef={spectrumRef} />}
      </div>
    </HFTile>
  );
}

function SpotifyMiniViz({ accent, accent2, spectrumRef }: {
  accent: string;
  accent2: string;
  spectrumRef: MutableRefObject<SpectrumState>;
}) {
  const COUNT = 36;
  const refs = useRef<(HTMLDivElement | null)[]>([]);
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const bands = spectrumRef.current.bands;
      const live = spectrumRef.current.live;
      const level = spectrumRef.current.level;
      for (let i = 0; i < COUNT; i++) {
        let h: number;
        if (live && bands.length > 0) {
          // Map across the energetic lower-mid range (same trick as the
          // viz hero waveform — the highest bands are usually silent).
          const t_norm = i / (COUNT - 1);
          const biased = Math.pow(t_norm, 1.4);
          const maxBand = Math.floor(bands.length * 0.7);
          const idx = Math.min(maxBand - 1, Math.floor(biased * maxBand));
          h = Math.max(0.05, Math.min(1, (bands[idx] ?? 0) * 0.65 + level * 0.35 + 0.05));
        } else {
          h = 0.08;
        }
        const el = refs.current[i];
        if (el) el.style.transform = `scaleY(${h})`;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [spectrumRef]);
  return (
    <div style={{
      display: 'flex', alignItems: 'flex-end', gap: 2,
      height: 36, padding: '4px 12px 8px',
      borderTop: '1px solid rgba(255,255,255,0.05)',
      flexShrink: 0,
    }}>
      {Array.from({ length: COUNT }).map((_, i) => (
        <div key={i} ref={(el) => { refs.current[i] = el; }} style={{
          flex: 1, height: '100%', transformOrigin: 'bottom',
          background: `linear-gradient(180deg, ${accent} 0%, ${accent2} 100%)`,
          borderRadius: '1px 1px 0 0',
          opacity: 0.85,
          filter: `drop-shadow(0 0 4px ${accent}55)`,
          transform: 'scaleY(0.05)',
          transition: 'background 0.4s, opacity 0.4s',
        }} />
      ))}
    </div>
  );
}

// ── Today calendar ───────────────────────────────────────────────────────────
export function CalendarTile({ density, accent }: { density: Density; accent: string }) {
  const events = [
    { time: '15:00', title: 'Standup', dur: '15m', color: '#22c55e', soon: true },
    { time: '16:00', title: 'Focus block · viz tuning', dur: '90m', color: accent },
    { time: '17:30', title: 'Design review w/ Maya', dur: '45m', color: '#fb7185' },
  ];
  return (
    <HFTile title="Today · Apr 29" density={density}
            headRight={<span style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)' }}>4 events</span>}
            style={{ height: '100%' }}>
      <div style={{ position: 'absolute', inset: 0, padding: 10, display: 'flex', flexDirection: 'column', gap: 6, overflow: 'hidden' }}>
        {events.map((e, i) => (
          <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <div style={{ width: 3, height: 28, background: e.color, borderRadius: 2, flexShrink: 0, boxShadow: e.soon ? `0 0 8px ${e.color}` : 'none' }} />
            <div style={{ minWidth: 50, fontSize: 11, fontFamily: '"JetBrains Mono", ui-monospace, monospace', color: e.soon ? '#fff' : 'rgba(255,255,255,0.6)' }}>{e.time}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.title}</div>
              <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)' }}>{e.dur}{e.soon && ' · in 28 min'}</div>
            </div>
          </div>
        ))}
      </div>
    </HFTile>
  );
}

// ── Notes ────────────────────────────────────────────────────────────────────
export function NotesTile({ density, accent }: { density: Density; accent: string }) {
  return (
    <HFTile title="Notes" density={density}
            headRight={<span style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)' }}>scratch.md · auto-save</span>}
            style={{ height: '100%' }}>
      <div style={{ position: 'absolute', inset: 0, padding: 10, fontSize: 11, color: 'rgba(255,255,255,0.85)', lineHeight: 1.5, fontFamily: '"JetBrains Mono", ui-monospace, monospace', overflow: 'hidden' }}>
        <div style={{ color: accent, marginBottom: 6 }}># todo</div>
        <div>☑ <s style={{ color: 'rgba(255,255,255,0.4)' }}>fix peak-hold decay</s></div>
        <div>☐ try particle count up to 200</div>
        <div>☐ ship preset import/export</div>
        <div style={{ marginTop: 12, color: accent }}># questions</div>
        <div style={{ color: 'rgba(255,255,255,0.7)' }}>– WebGPU stable enough by Q3?</div>
        <div style={{ color: 'rgba(255,255,255,0.7)' }}>– lazy-init for plugins?</div>
      </div>
    </HFTile>
  );
}

// ── Web tile (Linear) ────────────────────────────────────────────────────────
export function WebTile({ density, accent, url, title }: { density: Density; accent: string; url: string; title: string }) {
  return (
    <HFTile title={title} density={density}
            headRight={<span style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', fontFamily: '"JetBrains Mono", ui-monospace, monospace' }}>{url}</span>}
            style={{ height: '100%' }}>
      <div style={{ position: 'absolute', inset: 0, padding: 10, display: 'flex', flexDirection: 'column', gap: 6, overflow: 'hidden' }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', paddingBottom: 6, borderBottom: '1px solid rgba(255,255,255,0.06)', flexShrink: 0 }}>
          <div style={{ width: 22, height: 22, borderRadius: 5, background: `linear-gradient(135deg, ${accent}, ${accent}88)` }} />
          <div style={{ fontSize: 12, fontWeight: 600 }}>Linear · Inbox</div>
          <div style={{ flex: 1 }} />
          <span style={{ fontSize: 10, color: accent, padding: '2px 6px', background: accent + '15', borderRadius: 4 }}>3 new</span>
        </div>
        {[
          { p: 'M2-441', t: 'Visualizer ambient idle drop', s: 'In Progress', c: '#facc15' },
          { p: 'M2-442', t: 'Top processes drilldown', s: 'Todo', c: '#94a3b8' },
          { p: 'M2-438', t: 'WebView2 shared env', s: 'In Review', c: accent },
        ].map((t) => (
          <div key={t.p} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '6px 4px' }}>
            <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', fontFamily: '"JetBrains Mono", ui-monospace, monospace', minWidth: 50 }}>{t.p}</span>
            <span style={{ fontSize: 12, flex: 1, color: '#fff' }}>{t.t}</span>
            <span style={{ fontSize: 10, color: t.c, padding: '2px 6px', background: t.c + '15', borderRadius: 3 }}>{t.s}</span>
          </div>
        ))}
      </div>
    </HFTile>
  );
}

// ── Sysmon ───────────────────────────────────────────────────────────────────
export function SysMonTile({ density, accent, accent2, history }: { density: Density; accent: string; accent2: string; history: SysmonHistory }) {
  const Cell = ({ k, v, sub, data, color }: { k: string; v: string; sub: string; data: number[]; color: string }) => (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6, padding: '0 14px', borderRight: '1px solid rgba(255,255,255,0.05)' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: '.08em', fontFamily: '"JetBrains Mono", ui-monospace, monospace' }}>{k}</span>
        <span style={{ fontSize: 18, fontWeight: 700, color: '#fff', fontFamily: '"JetBrains Mono", ui-monospace, monospace', lineHeight: 1 }}>{v}</span>
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>
        <Sparkline data={data} color={color} height="100%" />
      </div>
      <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)' }}>{sub}</div>
    </div>
  );
  const top = history.latest.top.length > 0
    ? history.latest.top.slice(0, 4)
    : [
        { name: 'chrome.exe', cpu: 12.4 },
        { name: 'Hub.exe', cpu: 1.2 },
        { name: 'Discord.exe', cpu: 3.1 },
        { name: 'Code.exe', cpu: 4.7 },
      ];
  return (
    <HFTile title="System · live" density={density}
            headRight={<span style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)' }}>1Hz · Ryzen 7 / RTX 4070</span>}
            style={{ height: '100%' }}>
      <div style={{ display: 'flex', height: '100%', padding: '8px 0', minHeight: 0 }}>
        <Cell k="CPU" v={history.latest.cpu_pct_text} sub={history.latest.cpu_sub} data={history.cpu} color={accent} />
        <Cell k="RAM" v={history.latest.ram_text} sub={history.latest.ram_sub} data={history.ram} color={accent2} />
        <Cell k="GPU" v={history.latest.gpu_pct_text} sub={history.latest.gpu_sub} data={history.gpu} color="#facc15" />
        <Cell k="NET" v={history.latest.net_text} sub={history.latest.net_sub} data={history.net} color="#22c55e" />
        <div style={{ flex: 0.9, display: 'flex', flexDirection: 'column', gap: 4, padding: '0 14px', justifyContent: 'center' }}>
          <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: '.08em' }}>Top processes</div>
          {top.map((p, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10.5, fontFamily: '"JetBrains Mono", ui-monospace, monospace', color: i === 1 ? accent : 'rgba(255,255,255,0.7)' }}>
              <span>{p.name}</span><span>{p.cpu.toFixed(1)}%</span>
            </div>
          ))}
        </div>
      </div>
    </HFTile>
  );
}

// ── Clock ────────────────────────────────────────────────────────────────────
export function ClockTile({ density, accent, accent2 }: { density: Density; accent: string; accent2: string }) {
  const [time, setTime] = React.useState(() => new Date());
  React.useEffect(() => {
    const id = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  const hh = String(time.getHours()).padStart(2, '0');
  const mm = String(time.getMinutes()).padStart(2, '0');
  const ss = String(time.getSeconds()).padStart(2, '0');
  return (
    <HFTile title="Now" density={density}
            headRight={<span style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)' }}>Knoxville</span>}
            style={{ height: '100%' }}>
      <div style={{ padding: 12, height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', minHeight: 0, overflow: 'hidden' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
            <span style={{ fontSize: 44, fontWeight: 700, fontFamily: '"JetBrains Mono", ui-monospace, monospace', letterSpacing: '-0.04em', lineHeight: 0.9, color: '#fff' }}>{hh}:{mm}</span>
            <span style={{ fontSize: 18, fontWeight: 500, fontFamily: '"JetBrains Mono", ui-monospace, monospace', color: accent, lineHeight: 1 }}>:{ss}</span>
          </div>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', marginTop: 6 }}>
            {time.toLocaleDateString(undefined, { weekday: 'short', month: 'long', day: 'numeric' })} · Week {weekNumber(time)}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 36, height: 36, borderRadius: 999, background: `linear-gradient(135deg, ${accent2}, ${accent})`, position: 'relative', overflow: 'hidden', flexShrink: 0 }}>
            <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(circle at 30% 30%, rgba(255,255,255,0.4), transparent 60%)' }} />
          </div>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: '#fff', fontFamily: '"JetBrains Mono", ui-monospace, monospace' }}>62°</div>
            <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.5)' }}>partly cloudy · feels 60°</div>
          </div>
        </div>
      </div>
    </HFTile>
  );
}

function weekNumber(d: Date): number {
  const onejan = new Date(d.getFullYear(), 0, 1);
  return Math.ceil(((d.getTime() - onejan.getTime()) / 86400000 + onejan.getDay() + 1) / 7);
}

// ── Up next strip ────────────────────────────────────────────────────────────
export function UpNextTile({ density, accent }: { density: Density; accent: string }) {
  return (
    <HFTile title="Up next" density={density}
            headRight={<span style={{ fontSize: 10, color: '#22c55e' }}>● in 28m</span>}
            style={{ height: '100%' }}>
      <div style={{ padding: 12, height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', minHeight: 0, overflow: 'hidden' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <span style={{ fontSize: 10, color: '#22c55e', textTransform: 'uppercase', letterSpacing: '.08em', fontWeight: 700 }}>● Standup</span>
            <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', fontFamily: '"JetBrains Mono", ui-monospace, monospace' }}>15:00 — 15:15</span>
          </div>
          <div style={{ fontSize: 14, fontWeight: 500, color: '#fff', marginBottom: 12 }}>Daily standup · Design</div>
          <div style={{ display: 'flex', marginBottom: 10 }}>
            {['#fb7185', '#60a5fa', '#a78bfa', accent].map((c, i) => (
              <div key={i} style={{ width: 22, height: 22, borderRadius: 999, background: c + '33', border: '2px solid #16181c', marginLeft: i ? -6 : 0, fontSize: 10, color: c, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700 }}>
                {['M', 'A', 'J', 'Y'][i]}
              </div>
            ))}
            <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.5)', alignSelf: 'center', marginLeft: 8 }}>4 attendees</span>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button style={{ flex: 1, background: accent, color: '#000', border: 'none', borderRadius: 6, padding: '8px 10px', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>Join Zoom</button>
          <button style={{ background: 'rgba(255,255,255,0.06)', color: '#fff', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 6, padding: '8px 10px', fontSize: 11, cursor: 'pointer' }}>Snooze</button>
        </div>
      </div>
    </HFTile>
  );
}

// Shared sketchy wireframe primitives + tokens.
// Mid-fi: clean lines, real typography, mostly grayscale, accent color reserved for the visualizer.

const WF = {
  // Hub canvas tokens
  bg: '#0e0f12',          // hub background (very dark, slightly cool)
  bgPanel: '#16181c',     // tile/panel base
  bgPanelHi: '#1c1f24',   // tile header / hover
  border: '#2a2e36',
  borderHi: '#3a4150',
  ink: '#e6e8ec',         // primary text
  ink2: '#aab0bc',        // secondary
  ink3: '#6b7280',        // tertiary / placeholder
  rule: '#23262d',

  // Accent — reserved for visualizer + selection states
  accent: '#7cf5d4',      // mint-cyan (looks "audio/spectrum")
  accent2: '#a78bfa',     // violet (gradient pair w/ accent)
  accentDim: 'rgba(124,245,212,0.25)',

  // Status / data
  ok: '#7cf5d4',
  warn: '#f5b97c',
  bad: '#f57c8a',

  // Typography
  fontUi: '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
  fontMono: '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace',
  // Sketchy/handwritten font for annotations only — wireframe vibe
  fontHand: '"Caveat", "Bradley Hand", cursive',
};

// One-time global wireframe CSS
if (typeof document !== 'undefined' && !document.getElementById('wf-styles')) {
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&family=Caveat:wght@500;700&display=swap';
  document.head.appendChild(link);

  const s = document.createElement('style');
  s.id = 'wf-styles';
  s.textContent = `
    .wf-hub { font-family: ${WF.fontUi}; color: ${WF.ink}; background: ${WF.bg}; }
    .wf-hub * { box-sizing: border-box; }
    .wf-tile {
      background: ${WF.bgPanel};
      border: 1px solid ${WF.border};
      border-radius: 10px;
      overflow: hidden;
      position: relative;
      display: flex;
      flex-direction: column;
    }
    .wf-tile-head {
      display: flex; align-items: center; gap: 8px;
      padding: 8px 10px;
      border-bottom: 1px solid ${WF.rule};
      font-size: 11px; color: ${WF.ink2};
      letter-spacing: 0.04em; text-transform: uppercase;
      flex-shrink: 0;
    }
    .wf-tile-body { flex: 1; min-height: 0; position: relative; }
    .wf-dot { width: 6px; height: 6px; border-radius: 999px; background: ${WF.ink3}; flex-shrink: 0; }
    .wf-dot.ok { background: ${WF.ok}; }
    .wf-dot.warn { background: ${WF.warn}; }
    .wf-dot.bad { background: ${WF.bad}; }
    .wf-rule { height: 1px; background: ${WF.rule}; }
    .wf-chip {
      display: inline-flex; align-items: center; gap: 6px;
      padding: 3px 8px; border-radius: 999px;
      background: ${WF.bgPanelHi}; border: 1px solid ${WF.border};
      font-size: 11px; color: ${WF.ink2};
    }
    .wf-btn {
      display: inline-flex; align-items: center; gap: 6px;
      padding: 6px 10px; border-radius: 6px;
      background: ${WF.bgPanelHi}; border: 1px solid ${WF.border};
      color: ${WF.ink}; font-size: 12px; font-family: inherit; cursor: pointer;
    }
    .wf-btn.primary { background: ${WF.accent}; color: #0a0a0a; border-color: transparent; font-weight: 600; }
    .wf-btn.ghost { background: transparent; }
    .wf-input {
      background: ${WF.bg}; border: 1px solid ${WF.border}; border-radius: 6px;
      color: ${WF.ink}; padding: 6px 8px; font-size: 12px; font-family: inherit;
      width: 100%;
    }
    .wf-hand { font-family: ${WF.fontHand}; font-size: 16px; color: ${WF.accent}; }
    .wf-mono { font-family: ${WF.fontMono}; }
    .wf-anno {
      position: absolute; pointer-events: none; z-index: 5;
      font-family: ${WF.fontHand}; color: ${WF.accent}; font-size: 18px;
      line-height: 1.1;
    }
    .wf-anno-arrow {
      stroke: ${WF.accent}; fill: none; stroke-width: 1.5; stroke-linecap: round;
    }
    /* Sketchy bg grid for the hub canvas */
    .wf-grid-bg {
      background-image:
        linear-gradient(${WF.rule} 1px, transparent 1px),
        linear-gradient(90deg, ${WF.rule} 1px, transparent 1px);
      background-size: 40px 40px;
      background-position: -1px -1px;
    }
    .wf-scroll::-webkit-scrollbar { width: 6px; height: 6px; }
    .wf-scroll::-webkit-scrollbar-thumb { background: ${WF.border}; border-radius: 3px; }
    .wf-scroll::-webkit-scrollbar-track { background: transparent; }
  `;
  document.head.appendChild(s);
}

// ── Tile chrome ─────────────────────────────────────────────────────────────
function Tile({ title, icon, badge, children, style, headRight, noHead, accent }) {
  return (
    <div className="wf-tile" style={{
      ...(accent ? { boxShadow: `0 0 0 1px ${WF.accentDim}, 0 0 24px -8px ${WF.accentDim}` } : null),
      ...style,
    }}>
      {!noHead && (
        <div className="wf-tile-head">
          {icon && <span style={{ opacity: 0.7 }}>{icon}</span>}
          <span style={{ flex: 1 }}>{title}</span>
          {badge}
          {headRight}
        </div>
      )}
      <div className="wf-tile-body">{children}</div>
    </div>
  );
}

// ── Discord-ish web tile ────────────────────────────────────────────────────
function DiscordTile({ style }) {
  const channels = ['# general', '# random', '# dev-log', '# music', '# announcements'];
  const dms = [
    { name: 'alex', status: 'ok', last: 'shipping the build today' },
    { name: 'maya', status: 'warn', last: 'see the perf graph?' },
    { name: 'sam', status: 'ok', last: 'lol' },
    { name: 'jules', status: '', last: 'wfh tomorrow' },
  ];
  return (
    <Tile title="Discord — web" icon="◆" style={style}
          badge={<span className="wf-chip" style={{ fontSize: 10 }}>web tile</span>}>
      <div style={{ display: 'flex', height: '100%' }}>
        {/* server rail */}
        <div style={{ width: 40, padding: '8px 0', display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'center', borderRight: `1px solid ${WF.rule}`, background: '#101216' }}>
          {[0,1,2,3,4].map(i => (
            <div key={i} style={{ width: 26, height: 26, borderRadius: i===0?8:999, background: WF.bgPanelHi, border: i===0?`2px solid ${WF.accent}`:`1px solid ${WF.border}` }} />
          ))}
        </div>
        {/* channels */}
        <div style={{ width: 110, padding: 8, borderRight: `1px solid ${WF.rule}` }}>
          <div style={{ fontSize: 10, color: WF.ink3, textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 6 }}>channels</div>
          {channels.map((c, i) => (
            <div key={c} style={{
              padding: '4px 6px', fontSize: 11, color: i === 2 ? WF.ink : WF.ink2,
              background: i === 2 ? WF.bgPanelHi : 'transparent', borderRadius: 4, marginBottom: 2,
            }}>{c}</div>
          ))}
        </div>
        {/* messages */}
        <div style={{ flex: 1, padding: 10, display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
          {dms.map((m, i) => (
            <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
              <div style={{ width: 22, height: 22, borderRadius: 999, background: WF.bgPanelHi, border: `1px solid ${WF.border}`, flexShrink: 0, position: 'relative' }}>
                {m.status && <span className={`wf-dot ${m.status}`} style={{ position: 'absolute', bottom: -1, right: -1, border: `2px solid ${WF.bgPanel}`, width: 8, height: 8 }} />}
              </div>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 11, color: WF.ink, fontWeight: 600 }}>{m.name}</div>
                <div style={{ fontSize: 11, color: WF.ink2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.last}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </Tile>
  );
}

// ── Spotify / Now playing ───────────────────────────────────────────────────
function SpotifyTile({ style, compact }) {
  return (
    <Tile title="Now playing" icon="♪" style={style}
          badge={<span className="wf-chip" style={{ fontSize: 10 }}>Spotify</span>}>
      <div style={{ padding: 12, display: 'flex', gap: 12, alignItems: 'center', height: '100%' }}>
        <div style={{
          width: compact ? 56 : 72, height: compact ? 56 : 72, borderRadius: 6, flexShrink: 0,
          background: `linear-gradient(135deg, ${WF.accent2}, ${WF.accent})`,
          position: 'relative', overflow: 'hidden',
        }}>
          <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(circle at 30% 30%, rgba(255,255,255,.3), transparent 60%)' }} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>Midnight City</div>
          <div style={{ fontSize: 11, color: WF.ink2, marginBottom: 8 }}>M83 · Hurry Up, We're Dreaming</div>
          {/* progress */}
          <div style={{ height: 3, background: WF.rule, borderRadius: 2, position: 'relative', marginBottom: 6 }}>
            <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: '38%', background: WF.accent, borderRadius: 2 }} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: WF.ink3, fontFamily: WF.fontMono }}>
            <span>1:32</span><span>4:03</span>
          </div>
        </div>
        {!compact && (
          <div style={{ display: 'flex', gap: 6, color: WF.ink2 }}>
            <span style={{ fontSize: 16 }}>⏮</span>
            <span style={{ fontSize: 18, color: WF.ink }}>⏵</span>
            <span style={{ fontSize: 16 }}>⏭</span>
          </div>
        )}
      </div>
    </Tile>
  );
}

// ── YouTube / video tile ────────────────────────────────────────────────────
function YouTubeTile({ style, label }) {
  return (
    <Tile title={label || 'YouTube'} icon="▶" style={style}
          badge={<span className="wf-chip" style={{ fontSize: 10 }}>web tile</span>}>
      <div style={{
        position: 'absolute', inset: 0,
        background: `
          radial-gradient(ellipse at 30% 40%, rgba(124,245,212,0.08), transparent 50%),
          radial-gradient(ellipse at 70% 60%, rgba(167,139,250,0.08), transparent 50%),
          #0a0c10
        `,
      }}>
        {/* fake video silhouette */}
        <svg width="100%" height="100%" viewBox="0 0 200 120" preserveAspectRatio="xMidYMid slice" style={{ position: 'absolute', inset: 0 }}>
          <path d="M30 100 Q60 60 100 70 T180 50 L180 120 L30 120 Z" fill={WF.bgPanelHi} opacity="0.6" />
          <circle cx="140" cy="35" r="10" fill={WF.warn} opacity="0.4" />
        </svg>
        {/* play button */}
        <div style={{
          position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%,-50%)',
          width: 44, height: 44, borderRadius: 999,
          background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.2)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', backdropFilter: 'blur(4px)',
        }}>
          <div style={{ width: 0, height: 0, borderLeft: '12px solid white', borderTop: '7px solid transparent', borderBottom: '7px solid transparent', marginLeft: 4 }} />
        </div>
        {/* progress bar */}
        <div style={{ position: 'absolute', bottom: 8, left: 8, right: 8, height: 2, background: 'rgba(255,255,255,0.2)' }}>
          <div style={{ width: '62%', height: '100%', background: '#ff0033' }} />
        </div>
      </div>
    </Tile>
  );
}

// ── Clock / weather / calendar ──────────────────────────────────────────────
function ClockTile({ style, compact }) {
  return (
    <Tile noHead style={style}>
      <div style={{ padding: 14, height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontSize: compact ? 32 : 44, fontWeight: 700, lineHeight: 1, fontFamily: WF.fontMono, letterSpacing: '-.02em' }}>
            14:32
          </div>
          <div style={{ fontSize: 11, color: WF.ink2, marginTop: 4 }}>Wed · Apr 29</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 28, height: 28, borderRadius: 999, background: `linear-gradient(135deg, ${WF.warn}, ${WF.bad})`, opacity: 0.7 }} />
            <div>
              <div style={{ fontSize: 14, fontWeight: 600 }}>62°</div>
              <div style={{ fontSize: 10, color: WF.ink3 }}>partly cloudy</div>
            </div>
          </div>
          <div style={{ fontSize: 10, color: WF.ink3, textAlign: 'right' }}>
            <div>standup · 15:00</div>
            <div style={{ color: WF.ink2 }}>focus block · 16:00</div>
          </div>
        </div>
      </div>
    </Tile>
  );
}

// ── System monitor (compact + standard) ─────────────────────────────────────
function Sparkline({ data, color, height = 28, width = '100%' }) {
  const pts = data.map((v, i) => `${(i / (data.length - 1)) * 100},${100 - v * 100}`).join(' ');
  return (
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ width, height, display: 'block' }}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="2" vectorEffect="non-scaling-stroke" />
      <polyline points={`0,100 ${pts} 100,100`} fill={color} opacity="0.12" />
    </svg>
  );
}

const SAMPLE_CPU = [0.3,0.4,0.35,0.5,0.6,0.45,0.55,0.7,0.6,0.5,0.4,0.55,0.65,0.5,0.45,0.6,0.7,0.65,0.55,0.5];
const SAMPLE_RAM = [0.4,0.42,0.41,0.43,0.45,0.44,0.46,0.48,0.47,0.5,0.52,0.51,0.5,0.52,0.55,0.54,0.56,0.55,0.57,0.58];
const SAMPLE_GPU = [0.1,0.2,0.5,0.8,0.6,0.4,0.3,0.5,0.7,0.85,0.9,0.7,0.55,0.4,0.3,0.45,0.6,0.7,0.5,0.35];
const SAMPLE_NET = [0.2,0.5,0.3,0.4,0.6,0.8,0.5,0.3,0.4,0.5,0.7,0.6,0.5,0.4,0.3,0.5,0.6,0.4,0.3,0.5];

function SysMonTile({ style, mode = 'standard' }) {
  const rows = [
    { k: 'CPU', v: '23%', sub: '4.1 GHz · 58°C', data: SAMPLE_CPU, color: WF.accent },
    { k: 'RAM', v: '14.2 / 32 GB', sub: '44%', data: SAMPLE_RAM, color: WF.accent2 },
    { k: 'GPU', v: '41%', sub: '6.1 / 12 GB · 64°C', data: SAMPLE_GPU, color: WF.warn },
    { k: 'NET', v: '↓ 8.2 ↑ 0.4 MB/s', sub: 'Wi-Fi', data: SAMPLE_NET, color: WF.ok },
  ];
  return (
    <Tile title="System monitor" icon="▤" style={style}
          badge={<span className="wf-chip" style={{ fontSize: 10 }}>{mode}</span>}>
      <div style={{ padding: mode === 'compact' ? 8 : 12, display: 'flex', flexDirection: 'column', gap: mode === 'compact' ? 6 : 10, height: '100%' }}>
        {rows.map(r => (
          <div key={r.k} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 36, fontSize: 10, color: WF.ink2, fontFamily: WF.fontMono, letterSpacing: '.05em' }}>{r.k}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <Sparkline data={r.data} color={r.color} height={mode === 'compact' ? 16 : 24} />
            </div>
            <div style={{ textAlign: 'right', minWidth: 90 }}>
              <div style={{ fontSize: 11, fontWeight: 600, fontFamily: WF.fontMono }}>{r.v}</div>
              <div style={{ fontSize: 10, color: WF.ink3 }}>{r.sub}</div>
            </div>
          </div>
        ))}
      </div>
    </Tile>
  );
}

// ── Generic web tile placeholder ────────────────────────────────────────────
function WebTile({ url, title, style }) {
  return (
    <Tile title={title || 'Web tile'} icon="◐" style={style}
          headRight={<span style={{ fontSize: 10, color: WF.ink3, fontFamily: WF.fontMono }}>{url || 'about:blank'}</span>}>
      <div style={{
        position: 'absolute', inset: 0,
        background: `repeating-linear-gradient(45deg, transparent 0 12px, ${WF.rule} 12px 13px)`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: WF.ink3, fontSize: 12,
      }}>
        <div style={{ background: WF.bgPanel, padding: '6px 10px', border: `1px dashed ${WF.border}`, borderRadius: 4, fontFamily: WF.fontHand, fontSize: 16, color: WF.ink2 }}>
          embed: {url || 'arbitrary URL'}
        </div>
      </div>
    </Tile>
  );
}

// ── Audio visualizer renderers (mini, no audio — purely visual) ─────────────
function VizBars({ count = 48, animated = true, accent = WF.accent }) {
  // Static-ish bars with a fake "spectrum" envelope.
  const heights = React.useMemo(() => {
    return Array.from({ length: count }, (_, i) => {
      const x = i / count;
      // bass-heavy envelope + noise
      const env = Math.pow(1 - x, 1.4) * 0.7 + 0.15;
      const noise = (Math.sin(i * 1.7) + Math.cos(i * 0.9 + 2)) * 0.12;
      return Math.max(0.05, Math.min(1, env + noise));
    });
  }, [count]);
  return (
    <svg width="100%" height="100%" viewBox={`0 0 ${count * 4} 100`} preserveAspectRatio="none" style={{ display: 'block' }}>
      <defs>
        <linearGradient id={`vbg-${count}`} x1="0" y1="1" x2="0" y2="0">
          <stop offset="0" stopColor={accent} stopOpacity="0.4" />
          <stop offset="1" stopColor={accent} stopOpacity="1" />
        </linearGradient>
      </defs>
      {heights.map((h, i) => (
        <rect key={i} x={i * 4 + 0.6} y={100 - h * 100} width={2.8} height={h * 100} fill={`url(#vbg-${count})`} rx="0.5">
          {animated && <animate attributeName="height" values={`${h*100};${(h*0.4+0.05)*100};${h*100}`} dur={`${1 + (i % 5) * 0.2}s`} repeatCount="indefinite" />}
          {animated && <animate attributeName="y" values={`${100 - h*100};${100 - (h*0.4+0.05)*100};${100 - h*100}`} dur={`${1 + (i % 5) * 0.2}s`} repeatCount="indefinite" />}
        </rect>
      ))}
    </svg>
  );
}

function VizWaveform({ accent = WF.accent, animated = true }) {
  const pts = React.useMemo(() => {
    const N = 120;
    return Array.from({ length: N }, (_, i) => {
      const x = (i / (N - 1)) * 100;
      const y = 50 + Math.sin(i * 0.3) * 18 * Math.sin(i * 0.07) + Math.sin(i * 0.9) * 4;
      return `${x},${y}`;
    }).join(' ');
  }, []);
  return (
    <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" style={{ display: 'block' }}>
      <polyline points={pts} fill="none" stroke={accent} strokeWidth="1.4" vectorEffect="non-scaling-stroke" />
      <polyline points={pts} fill="none" stroke={accent} strokeWidth="3" vectorEffect="non-scaling-stroke" opacity="0.25" filter="blur(2px)" />
    </svg>
  );
}

function VizRadial({ accent = WF.accent }) {
  const N = 64;
  const bars = Array.from({ length: N }, (_, i) => {
    const x = i / N;
    const env = 0.4 + Math.sin(x * Math.PI * 4) * 0.25 + Math.sin(x * Math.PI * 13) * 0.1;
    return Math.max(0.1, Math.min(1, env));
  });
  return (
    <svg width="100%" height="100%" viewBox="-50 -50 100 100" style={{ display: 'block' }}>
      <circle r="14" fill="none" stroke={accent} strokeOpacity="0.3" strokeWidth="0.5" />
      {bars.map((h, i) => {
        const a = (i / N) * Math.PI * 2;
        const r1 = 16, r2 = 16 + h * 22;
        const x1 = Math.cos(a) * r1, y1 = Math.sin(a) * r1;
        const x2 = Math.cos(a) * r2, y2 = Math.sin(a) * r2;
        return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke={accent} strokeWidth="1.2" strokeLinecap="round" opacity={0.5 + h * 0.5} />;
      })}
    </svg>
  );
}

function VizParticles({ accent = WF.accent }) {
  const pts = React.useMemo(() => Array.from({ length: 80 }, () => ({
    x: Math.random() * 100, y: Math.random() * 100, r: 0.3 + Math.random() * 1.6, o: 0.3 + Math.random() * 0.7,
  })), []);
  return (
    <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" style={{ display: 'block', background: 'radial-gradient(circle at 50% 50%, rgba(124,245,212,0.08), transparent 60%)' }}>
      {pts.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r={p.r} fill={accent} opacity={p.o} />
      ))}
    </svg>
  );
}

function VizAmbient({ accent = WF.accent, accent2 = WF.accent2 }) {
  return (
    <div style={{
      width: '100%', height: '100%',
      background: `radial-gradient(ellipse 60% 50% at 30% 40%, ${accent}55, transparent 70%),
                   radial-gradient(ellipse 50% 60% at 70% 60%, ${accent2}55, transparent 70%),
                   radial-gradient(ellipse 40% 30% at 50% 80%, ${accent}33, transparent 70%),
                   #060810`,
      filter: 'blur(0.5px) saturate(1.1)',
    }} />
  );
}

function Visualizer({ mode = 'bars', accent = WF.accent, animated = true, ...rest }) {
  if (mode === 'bars') return <VizBars accent={accent} animated={animated} {...rest} />;
  if (mode === 'waveform') return <VizWaveform accent={accent} animated={animated} {...rest} />;
  if (mode === 'radial') return <VizRadial accent={accent} {...rest} />;
  if (mode === 'particles') return <VizParticles accent={accent} {...rest} />;
  if (mode === 'ambient') return <VizAmbient accent={accent} {...rest} />;
  return null;
}

function VizTile({ style, mode = 'bars', dominant }) {
  return (
    <Tile
      title={dominant ? null : `Visualizer · ${mode}`}
      icon={dominant ? null : '≣'}
      noHead={dominant}
      accent
      style={style}
      badge={!dominant && <span className="wf-chip" style={{ fontSize: 10, color: WF.accent, borderColor: WF.accentDim }}>● live</span>}
    >
      <div style={{ position: 'absolute', inset: 0 }}>
        <Visualizer mode={mode} />
      </div>
    </Tile>
  );
}

// Annotation helper — handwritten label w/ optional arrow
function Anno({ x, y, children, arrow }) {
  return (
    <div className="wf-anno" style={{ left: x, top: y }}>
      {children}
      {arrow && (
        <svg width="60" height="40" style={{ position: 'absolute', left: arrow.dx ?? 60, top: arrow.dy ?? -10, overflow: 'visible' }}>
          <path
            d={arrow.path || 'M5 5 Q 30 30 55 25'}
            className="wf-anno-arrow"
            markerEnd="url(#wf-arrow)"
          />
          <defs>
            <marker id="wf-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto">
              <path d="M0 0 L10 5 L0 10 z" fill={WF.accent} />
            </marker>
          </defs>
        </svg>
      )}
    </div>
  );
}

// Export to global so other Babel scripts can use them
Object.assign(window, {
  WF, Tile, DiscordTile, SpotifyTile, YouTubeTile, ClockTile,
  Sparkline, SysMonTile, WebTile,
  Visualizer, VizBars, VizWaveform, VizRadial, VizParticles, VizAmbient, VizTile,
  Anno,
});

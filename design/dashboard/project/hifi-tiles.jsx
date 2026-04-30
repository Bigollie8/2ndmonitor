// Hi-fi Layout C tiles: rich Discord, Spotify, Calendar, Notes, custom web tile,
// detailed sysmon, big clock + weather, full viz overlay (track + controls + mode switcher).

// Density-aware spacing
function getDensity(d) {
  if (d === 'compact') return { gap: 10, pad: 10, headerPad: 8, fontTitle: 11, fontBody: 11 };
  if (d === 'spacious') return { gap: 18, pad: 16, headerPad: 12, fontTitle: 13, fontBody: 13 };
  return { gap: 14, pad: 13, headerPad: 10, fontTitle: 12, fontBody: 12 };
}

// ─────────────────────────────────────────────────────────────────────────────
// HiFi Tile chrome
// ─────────────────────────────────────────────────────────────────────────────
function HFTile({ title, badge, headRight, children, accent, density = 'regular', noHead, style, onClick }) {
  const D = getDensity(density);
  return (
    <div onClick={onClick} style={{
      background: 'rgba(22,24,30,0.78)',
      backdropFilter: 'blur(20px) saturate(140%)',
      WebkitBackdropFilter: 'blur(20px) saturate(140%)',
      border: `1px solid rgba(255,255,255,0.06)`,
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

// ─────────────────────────────────────────────────────────────────────────────
// Discord HiFi
// ─────────────────────────────────────────────────────────────────────────────
function DiscordHiFi({ density, accent }) {
  const D = getDensity(density);
  const messages = [
    { user: 'maya', color: '#fb7185', time: '14:28', text: 'pushed the new viz preset, take a look when you get a sec', mine: false },
    { user: 'me', color: accent, time: '14:29', text: 'omw — the radial mode looks unreal', mine: true },
    { user: 'alex', color: '#60a5fa', time: '14:31', text: 'also the bass response is way better now 🔥', mine: false },
    { user: 'jules', color: '#a78bfa', time: '14:32', text: 'shipping the build today still?', mine: false },
  ];
  return (
    <HFTile title="Discord — # design-log" density={density}
            badge={<span style={{ background: '#22c55e', width: 6, height: 6, borderRadius: 999 }} />}
            headRight={<span style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)' }}>4 online</span>}
            style={{ height: '100%' }}>
      <div style={{ display: 'flex', height: '100%' }}>
        {/* server rail */}
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
        {/* channels */}
        <div style={{ width: 130, padding: '10px 8px', borderRight: '1px solid rgba(255,255,255,0.05)' }}>
          <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 8, padding: '0 6px' }}>Channels</div>
          {[
            { n: '# general' },
            { n: '# design-log', active: true, unread: 2 },
            { n: '# eng' },
            { n: '# random' },
            { n: '# music', unread: 5 },
          ].map(c => (
            <div key={c.n} style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '5px 8px', fontSize: 11.5, color: c.active ? '#fff' : 'rgba(255,255,255,0.6)',
              background: c.active ? 'rgba(255,255,255,0.06)' : 'transparent',
              borderRadius: 5, marginBottom: 1,
            }}>
              <span>{c.n}</span>
              {c.unread && <span style={{ background: accent, color: '#000', fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 6 }}>{c.unread}</span>}
            </div>
          ))}
        </div>
        {/* messages */}
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

// ─────────────────────────────────────────────────────────────────────────────
// Spotify HiFi (Now Playing)
// ─────────────────────────────────────────────────────────────────────────────
function SpotifyHiFi({ density, accent, accent2, track, onPick }) {
  return (
    <HFTile title="Now playing · Spotify" density={density}
            badge={<span style={{ fontSize: 9, color: accent, padding: '2px 6px', borderRadius: 4, background: accent + '15', border: `1px solid ${accent}33`, letterSpacing: '.05em' }}>● LIVE</span>}
            style={{ height: '100%' }}>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', padding: 12, gap: 10, minHeight: 0 }}>
        {/* Album art */}
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', flexShrink: 0 }}>
          <div style={{
            width: 64, height: 64, borderRadius: 8, flexShrink: 0,
            background: track.cover, position: 'relative', overflow: 'hidden',
            boxShadow: `0 8px 24px ${accent}55`,
          }}>
            <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(circle at 30% 30%, rgba(255,255,255,0.3), transparent 60%)' }} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{track.title}</div>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.6)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{track.artist}</div>
            <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', marginTop: 2 }}>{track.album}</div>
          </div>
        </div>
        {/* Progress */}
        <div>
          <div style={{ height: 3, background: 'rgba(255,255,255,0.1)', borderRadius: 2, position: 'relative', overflow: 'hidden' }}>
            <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: '38%', background: `linear-gradient(90deg, ${accent2}, ${accent})`, borderRadius: 2 }} />
            <div style={{ position: 'absolute', left: '38%', top: '50%', transform: 'translate(-50%,-50%)', width: 9, height: 9, background: '#fff', borderRadius: 999, boxShadow: `0 0 8px ${accent}` }} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'rgba(255,255,255,0.4)', fontFamily: 'JetBrains Mono, ui-monospace, monospace', marginTop: 4 }}>
            <span>1:32</span><span>4:03</span>
          </div>
        </div>
        {/* Controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, justifyContent: 'center' }}>
          <button style={iconBtn()}>⇄</button>
          <button style={iconBtn()}>⏮</button>
          <button style={{ ...iconBtn(), width: 36, height: 36, background: '#fff', color: '#000', borderRadius: 999, fontSize: 14 }}>⏵</button>
          <button style={iconBtn()}>⏭</button>
          <button style={iconBtn()}>↺</button>
        </div>
        {/* Up next */}
        <div style={{ borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: 8, marginTop: 'auto', minHeight: 0, overflow: 'hidden' }}>
          <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 6 }}>Up next · pick to remix accent</div>
          {TRACKS.filter(t => t.title !== track.title).slice(0, 2).map(t => (
            <div key={t.title} onClick={() => onPick(t)} style={{
              display: 'flex', gap: 8, alignItems: 'center', padding: '4px 4px', borderRadius: 5, cursor: 'pointer',
            }}
            onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.05)'}
            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
            >
              <div style={{ width: 22, height: 22, borderRadius: 4, background: t.cover, flexShrink: 0 }} />
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 11, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.title}</div>
                <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.artist}</div>
              </div>
              <div style={{ width: 8, height: 8, borderRadius: 999, background: t.accent, boxShadow: `0 0 6px ${t.accent}` }} />
            </div>
          ))}
        </div>
      </div>
    </HFTile>
  );
}

const iconBtn = () => ({
  background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.08)',
  color: 'rgba(255,255,255,0.85)', width: 28, height: 28, borderRadius: 999,
  display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
  fontSize: 11, padding: 0,
});

// Track palette — each track ships an accent pair (theme-linked)
const TRACKS = [
  { title: 'Midnight City', artist: 'M83', album: 'Hurry Up, We\'re Dreaming',
    cover: 'linear-gradient(135deg, #f97316, #ec4899)',
    accent: '#fb923c', accent2: '#ec4899' },
  { title: 'Strobe', artist: 'deadmau5', album: 'For Lack of a Better Name',
    cover: 'linear-gradient(135deg, #1e3a8a, #06b6d4)',
    accent: '#06b6d4', accent2: '#3b82f6' },
  { title: 'Time', artist: 'Hans Zimmer', album: 'Inception OST',
    cover: 'linear-gradient(135deg, #1f2937, #6b7280)',
    accent: '#94a3b8', accent2: '#cbd5e1' },
  { title: 'Lateralus', artist: 'TOOL', album: 'Lateralus',
    cover: 'linear-gradient(135deg, #7c2d12, #facc15)',
    accent: '#facc15', accent2: '#f59e0b' },
  { title: 'Resonance', artist: 'HOME', album: 'Odyssey',
    cover: 'linear-gradient(135deg, #be185d, #6d28d9)',
    accent: '#a78bfa', accent2: '#ec4899' },
];

// ─────────────────────────────────────────────────────────────────────────────
// Calendar HiFi
// ─────────────────────────────────────────────────────────────────────────────
function CalendarHiFi({ density, accent }) {
  const events = [
    { time: '15:00', title: 'Standup', dur: '15m', color: '#22c55e', soon: true },
    { time: '16:00', title: 'Focus block · viz tuning', dur: '90m', color: accent },
    { time: '17:30', title: 'Design review w/ Maya', dur: '45m', color: '#fb7185' },
    { time: '19:00', title: 'Pickleball', dur: '60m', color: '#facc15' },
  ];
  return (
    <HFTile title="Today · Apr 29" density={density}
            headRight={<span style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)' }}>4 events</span>}
            style={{ height: '100%' }}>
      <div style={{ position: 'absolute', inset: 0, padding: 10, display: 'flex', flexDirection: 'column', gap: 6, overflow: 'hidden' }}>
        {events.slice(0, 3).map((e, i) => (
          <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <div style={{ width: 3, height: 28, background: e.color, borderRadius: 2, flexShrink: 0, boxShadow: e.soon ? `0 0 8px ${e.color}` : 'none' }} />
            <div style={{ minWidth: 50, fontSize: 11, fontFamily: 'JetBrains Mono, ui-monospace, monospace', color: e.soon ? '#fff' : 'rgba(255,255,255,0.6)' }}>{e.time}</div>
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

// ─────────────────────────────────────────────────────────────────────────────
// Notes scratchpad
// ─────────────────────────────────────────────────────────────────────────────
function NotesHiFi({ density, accent }) {
  return (
    <HFTile title="Notes" density={density}
            headRight={<span style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)' }}>scratch.md · auto-save</span>}
            style={{ height: '100%' }}>
      <div style={{ position: 'absolute', inset: 0, padding: 10, fontSize: 11, color: 'rgba(255,255,255,0.85)', lineHeight: 1.5, fontFamily: 'JetBrains Mono, ui-monospace, monospace', overflow: 'hidden' }}>
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

// ─────────────────────────────────────────────────────────────────────────────
// Custom web tile placeholder
// ─────────────────────────────────────────────────────────────────────────────
function WebHiFi({ density, accent, url, title }) {
  return (
    <HFTile title={title || 'Web tile'} density={density}
            headRight={<span style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', fontFamily: 'JetBrains Mono, ui-monospace, monospace' }}>{url}</span>}
            style={{ height: '100%' }}>
      <div style={{ position: 'absolute', inset: 0, padding: 10, display: 'flex', flexDirection: 'column', gap: 6, overflow: 'hidden' }}>
        {/* Fake page content */}
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
        ].map(t => (
          <div key={t.p} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '6px 4px' }}>
            <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', fontFamily: 'JetBrains Mono, ui-monospace, monospace', minWidth: 50 }}>{t.p}</span>
            <span style={{ fontSize: 12, flex: 1, color: '#fff' }}>{t.t}</span>
            <span style={{ fontSize: 10, color: t.c, padding: '2px 6px', background: t.c + '15', borderRadius: 3 }}>{t.s}</span>
          </div>
        ))}
      </div>
    </HFTile>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Sysmon HiFi — bottom strip
// ─────────────────────────────────────────────────────────────────────────────
function SysMonHiFi({ density, accent, accent2 }) {
  const [data, setData] = React.useState(() => ({
    cpu: Array.from({ length: 40 }, (_, i) => 0.2 + Math.sin(i * 0.3) * 0.15 + Math.random() * 0.15),
    ram: Array.from({ length: 40 }, () => 0.4 + Math.random() * 0.1),
    gpu: Array.from({ length: 40 }, (_, i) => 0.3 + Math.sin(i * 0.5) * 0.2 + Math.random() * 0.15),
    net: Array.from({ length: 40 }, () => Math.random() * 0.6),
  }));
  React.useEffect(() => {
    const id = setInterval(() => {
      setData(d => ({
        cpu: [...d.cpu.slice(1), Math.max(0.05, Math.min(1, d.cpu[d.cpu.length-1] + (Math.random()-0.5)*0.15))],
        ram: [...d.ram.slice(1), Math.max(0.05, Math.min(1, d.ram[d.ram.length-1] + (Math.random()-0.5)*0.04))],
        gpu: [...d.gpu.slice(1), Math.max(0.05, Math.min(1, d.gpu[d.gpu.length-1] + (Math.random()-0.5)*0.2))],
        net: [...d.net.slice(1), Math.random() * 0.7],
      }));
    }, 1000);
    return () => clearInterval(id);
  }, []);
  const Cell = ({ k, v, sub, data, color }) => (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6, padding: '0 14px', borderRight: '1px solid rgba(255,255,255,0.05)' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: '.08em', fontFamily: 'JetBrains Mono, ui-monospace, monospace' }}>{k}</span>
        <span style={{ fontSize: 18, fontWeight: 700, color: '#fff', fontFamily: 'JetBrains Mono, ui-monospace, monospace', lineHeight: 1 }}>{v}</span>
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>
        <Sparkline data={data} color={color} height="100%" />
      </div>
      <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)' }}>{sub}</div>
    </div>
  );
  return (
    <HFTile title="System · live" density={density}
            headRight={<span style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)' }}>1Hz · Ryzen 7 / RTX 4070</span>}
            style={{ height: '100%' }}>
      <div style={{ display: 'flex', height: '100%', padding: '8px 0', minHeight: 0 }}>
        <Cell k="CPU" v="23%" sub="4.1 GHz · 58°C" data={data.cpu} color={accent} />
        <Cell k="RAM" v="14.2G" sub="44% of 32 GB" data={data.ram} color={accent2} />
        <Cell k="GPU" v="41%" sub="6.1G · 64°C" data={data.gpu} color="#facc15" />
        <Cell k="NET" v="↓8.2" sub="↑0.4 MB/s · Wi-Fi" data={data.net} color="#22c55e" />
        <div style={{ flex: 0.9, display: 'flex', flexDirection: 'column', gap: 4, padding: '0 14px', justifyContent: 'center' }}>
          <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: '.08em' }}>Top processes</div>
          {[
            ['chrome.exe', '12.4%'],
            ['Hub.exe', '1.2%', accent],
            ['Discord.exe', '3.1%'],
            ['Code.exe', '4.7%'],
          ].map(([n, v, col], i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10.5, fontFamily: 'JetBrains Mono, ui-monospace, monospace', color: col || 'rgba(255,255,255,0.7)' }}>
              <span>{n}</span><span>{v}</span>
            </div>
          ))}
        </div>
      </div>
    </HFTile>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Clock HiFi — bottom strip
// ─────────────────────────────────────────────────────────────────────────────
function ClockHiFi({ density, accent, accent2 }) {
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
            headRight={<span style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)' }}>San Francisco</span>}
            style={{ height: '100%' }}>
      <div style={{ padding: 12, height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', minHeight: 0, overflow: 'hidden' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
            <span style={{ fontSize: 44, fontWeight: 700, fontFamily: 'JetBrains Mono, ui-monospace, monospace', letterSpacing: '-0.04em', lineHeight: 0.9, color: '#fff' }}>{hh}:{mm}</span>
            <span style={{ fontSize: 18, fontWeight: 500, fontFamily: 'JetBrains Mono, ui-monospace, monospace', color: accent, lineHeight: 1 }}>:{ss}</span>
          </div>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', marginTop: 6 }}>
            Wed · April 29 · Week 18
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 36, height: 36, borderRadius: 999, background: `linear-gradient(135deg, ${accent2}, ${accent})`, position: 'relative', overflow: 'hidden', flexShrink: 0 }}>
            <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(circle at 30% 30%, rgba(255,255,255,0.4), transparent 60%)' }} />
          </div>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: '#fff', fontFamily: 'JetBrains Mono, ui-monospace, monospace' }}>62°</div>
            <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.5)' }}>partly cloudy · feels 60°</div>
          </div>
        </div>
      </div>
    </HFTile>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Calendar HiFi for bottom strip (compact)
// ─────────────────────────────────────────────────────────────────────────────
function CalendarStripHiFi({ density, accent }) {
  return (
    <HFTile title="Up next" density={density}
            headRight={<span style={{ fontSize: 10, color: '#22c55e' }}>● in 28m</span>}
            style={{ height: '100%' }}>
      <div style={{ padding: 12, height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', minHeight: 0, overflow: 'hidden' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <span style={{ fontSize: 10, color: '#22c55e', textTransform: 'uppercase', letterSpacing: '.08em', fontWeight: 700 }}>● Standup</span>
            <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', fontFamily: 'JetBrains Mono, ui-monospace, monospace' }}>15:00 — 15:15</span>
          </div>
          <div style={{ fontSize: 14, fontWeight: 500, color: '#fff', marginBottom: 12 }}>Daily standup · Design</div>
          <div style={{ display: 'flex', gap: -6, marginBottom: 10 }}>
            {['#fb7185', '#60a5fa', '#a78bfa', accent].map((c, i) => (
              <div key={i} style={{ width: 22, height: 22, borderRadius: 999, background: c + '33', border: '2px solid #16181c', marginLeft: i ? -6 : 0, fontSize: 10, color: c, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700 }}>
                {['M','A','J','Y'][i]}
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

// ─────────────────────────────────────────────────────────────────────────────
// Visualizer overlay — full chrome with track + controls + mode switcher
// ─────────────────────────────────────────────────────────────────────────────
function VizOverlay({ track, mode, setMode, accent, accent2 }) {
  return (
    <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
      {/* Top: mode switcher + status */}
      <div style={{ padding: 18, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', pointerEvents: 'auto' }}>
        <div style={{ display: 'flex', gap: 4, padding: 4, background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(20px)', borderRadius: 10, border: '1px solid rgba(255,255,255,0.06)' }}>
          {[
            { k: 'bars', label: 'Bars' },
            { k: 'waveform', label: 'Wave' },
            { k: 'radial', label: 'Radial' },
            { k: 'particles', label: 'Particle' },
            { k: 'ambient', label: 'Ambient' },
          ].map(m => (
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
          <button style={overlayBtn()}>⚙ Configure</button>
          <button style={overlayBtn()}>⛶</button>
        </div>
      </div>

      {/* Bottom: track + controls */}
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
            <button style={overlayBtn()}>⏮</button>
            <button style={{ ...overlayBtn(), width: 44, height: 44, background: '#fff', color: '#000', borderRadius: 999, fontSize: 16 }}>⏵</button>
            <button style={overlayBtn()}>⏭</button>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 280 }}>
            <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.5)', fontFamily: 'JetBrains Mono, ui-monospace, monospace' }}>1:32</span>
            <div style={{ flex: 1, height: 3, background: 'rgba(255,255,255,0.15)', borderRadius: 2, position: 'relative', overflow: 'hidden' }}>
              <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: '38%', background: `linear-gradient(90deg, ${accent2}, ${accent})`, borderRadius: 2 }} />
            </div>
            <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.5)', fontFamily: 'JetBrains Mono, ui-monospace, monospace' }}>4:03</span>
          </div>
        </div>
      </div>
    </div>
  );
}

const overlayBtn = () => ({
  background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(20px)',
  border: '1px solid rgba(255,255,255,0.08)',
  color: 'rgba(255,255,255,0.85)', padding: '7px 12px', borderRadius: 8,
  cursor: 'pointer', fontSize: 11, fontWeight: 500,
  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
});

Object.assign(window, {
  HFTile, getDensity, TRACKS,
  DiscordHiFi, SpotifyHiFi, CalendarHiFi, NotesHiFi, WebHiFi,
  SysMonHiFi, ClockHiFi, CalendarStripHiFi, VizOverlay,
});

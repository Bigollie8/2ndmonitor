// Profile switcher · Settings · Onboarding

// ─────────────────────────────────────────────────────────────────────────────
// LAYOUT PROFILE SWITCHER — command-palette-ish overlay
// ─────────────────────────────────────────────────────────────────────────────
function ProfileSwitcher({ scale = 0.5 }) {
  const profiles = [
    { name: 'Work', key: '⌘ 1', tiles: 7, hot: 'now', desc: 'Comms left, telemetry right, viz dim',
      preview: <MiniLayoutA />, on: true },
    { name: 'Gaming', key: '⌘ 2', tiles: 4, hot: '', desc: 'Voice + viz fullscreen + minimal sysmon',
      preview: <MiniLayoutGaming /> },
    { name: 'Chill', key: '⌘ 3', tiles: 3, hot: '', desc: 'Ambient viz + now playing + clock',
      preview: <MiniLayoutChill /> },
    { name: 'Focus', key: '⌘ 4', tiles: 2, hot: '', desc: 'Single web tile + sysmon · zero distraction',
      preview: <MiniLayoutFocus /> },
  ];
  return (
    <HubFrame scale={scale}>
      {/* Dimmed hub behind */}
      <div style={{ position: 'absolute', inset: 0, opacity: 0.25 }}>
        <div style={{ position: 'absolute', inset: 16, display: 'grid', gridTemplateColumns: '720px 1fr 540px', gridTemplateRows: '1fr 360px', gap: 14 }}>
          <DiscordTile style={{ gridRow: '1 / span 2', gridColumn: 1 }} />
          <YouTubeTile style={{ gridRow: 1, gridColumn: 2 }} />
          <ClockTile style={{ gridRow: 1, gridColumn: 3 }} />
          <VizTile mode="bars" dominant style={{ gridRow: 2, gridColumn: '2 / span 2' }} />
        </div>
      </div>
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(6px)' }} />

      <div style={{
        position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%,-50%)',
        width: 1500, background: WF.bgPanel, border: `1px solid ${WF.border}`, borderRadius: 16,
        boxShadow: '0 40px 100px rgba(0,0,0,0.6)', overflow: 'hidden',
      }}>
        <div style={{ padding: '16px 20px', borderBottom: `1px solid ${WF.rule}`, display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ color: WF.ink3 }}>↕</span>
          <input className="wf-input" placeholder="Switch layout profile…" style={{ flex: 1, border: 'none', background: 'transparent', fontSize: 16 }} />
          <span className="wf-chip">⎋ close</span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 14, padding: 18 }}>
          {profiles.map(p => (
            <div key={p.name} style={{
              background: p.on ? WF.bgPanelHi : WF.bg,
              border: `1px solid ${p.on ? WF.borderHi : WF.border}`,
              borderRadius: 12, padding: 14, display: 'grid', gridTemplateColumns: '220px 1fr', gap: 14, alignItems: 'center',
              boxShadow: p.on ? `0 0 0 1px ${WF.accentDim}` : 'none',
            }}>
              <div style={{ aspectRatio: '16 / 9', background: '#060810', borderRadius: 8, border: `1px solid ${WF.rule}`, overflow: 'hidden', position: 'relative' }}>
                {p.preview}
              </div>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <span style={{ fontSize: 17, fontWeight: 600 }}>{p.name}</span>
                  {p.hot && <span className="wf-chip" style={{ fontSize: 10, color: WF.accent, borderColor: WF.accentDim }}>● active</span>}
                </div>
                <div style={{ fontSize: 12, color: WF.ink2, marginBottom: 10 }}>{p.desc}</div>
                <div style={{ fontSize: 11, color: WF.ink3, display: 'flex', gap: 14, fontFamily: WF.fontMono }}>
                  <span>{p.tiles} tiles</span>
                  <span>{p.key}</span>
                </div>
              </div>
            </div>
          ))}
          {/* New profile card */}
          <div style={{ background: WF.bg, border: `1px dashed ${WF.border}`, borderRadius: 12, padding: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, color: WF.ink2, fontSize: 13, gridColumn: '1 / span 2' }}>
            ＋ Save current layout as new profile
          </div>
        </div>
        <div style={{ padding: '12px 20px', borderTop: `1px solid ${WF.rule}`, display: 'flex', gap: 14, fontSize: 11, color: WF.ink3, fontFamily: WF.fontMono }}>
          <span>↑↓ navigate</span><span>↵ apply</span><span>⇧↵ duplicate</span><span>⌫ delete</span>
        </div>
      </div>
    </HubFrame>
  );
}

function MiniLayoutA() {
  return (
    <div style={{ position: 'absolute', inset: 4, display: 'grid', gridTemplateColumns: '1fr 1.4fr 0.8fr', gridTemplateRows: '1fr 1.2fr', gap: 3 }}>
      <div style={{ gridRow: '1 / span 2', background: WF.bgPanel, border: `1px solid ${WF.border}`, borderRadius: 3 }} />
      <div style={{ gridRow: 1, background: WF.bgPanel, border: `1px solid ${WF.border}`, borderRadius: 3 }} />
      <div style={{ gridRow: 1, background: WF.bgPanel, border: `1px solid ${WF.border}`, borderRadius: 3 }} />
      <div style={{ gridRow: 2, gridColumn: '2 / span 2', background: '#06080c', border: `1px solid ${WF.accentDim}`, borderRadius: 3, overflow: 'hidden' }}>
        <Visualizer mode="bars" animated={false} />
      </div>
    </div>
  );
}
function MiniLayoutGaming() {
  return (
    <div style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}>
      <Visualizer mode="particles" />
      <div style={{ position: 'absolute', top: 6, left: 6, width: 60, height: 24, background: 'rgba(0,0,0,0.5)', borderRadius: 3 }} />
      <div style={{ position: 'absolute', top: 6, right: 6, width: 80, height: 24, background: 'rgba(0,0,0,0.5)', borderRadius: 3 }} />
    </div>
  );
}
function MiniLayoutChill() {
  return (
    <div style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}>
      <Visualizer mode="ambient" />
      <div style={{ position: 'absolute', bottom: 8, left: '50%', transform: 'translateX(-50%)', width: 100, height: 22, background: 'rgba(0,0,0,0.5)', borderRadius: 11 }} />
    </div>
  );
}
function MiniLayoutFocus() {
  return (
    <div style={{ position: 'absolute', inset: 4, display: 'grid', gridTemplateColumns: '1fr 0.4fr', gap: 3 }}>
      <div style={{ background: WF.bgPanel, border: `1px solid ${WF.border}`, borderRadius: 3 }} />
      <div style={{ background: WF.bgPanel, border: `1px solid ${WF.border}`, borderRadius: 3 }} />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SETTINGS / PREFERENCES — full page, sidebar nav
// ─────────────────────────────────────────────────────────────────────────────
function SettingsPage({ scale = 0.5 }) {
  const sections = [
    { g: 'General', items: ['Startup & display', 'Hotkeys', 'Appearance'] },
    { g: 'Tiles', items: ['Web tiles · WebView2', 'Native apps', 'Plugins'] },
    { g: 'Performance', items: ['Budget targets', 'Idle behavior'] },
    { g: 'Audio', items: ['Capture source', 'Per-app audio (beta)'] },
    { g: 'Data', items: ['Backup & sync', 'About'] },
  ];
  return (
    <HubFrame scale={scale}>
      <div style={{ position: 'absolute', top: 14, left: 16, right: 16, bottom: 16, display: 'grid', gridTemplateColumns: '300px 1fr', gap: 16 }}>
        {/* Sidebar */}
        <div style={{ background: WF.bgPanel, border: `1px solid ${WF.border}`, borderRadius: 12, padding: 16, display: 'flex', flexDirection: 'column', gap: 4, overflowY: 'auto' }}>
          <div style={{ fontSize: 17, fontWeight: 600, padding: '6px 10px', marginBottom: 8 }}>Settings</div>
          {sections.map(s => (
            <div key={s.g}>
              <div style={{ fontSize: 10, color: WF.ink3, textTransform: 'uppercase', letterSpacing: '.06em', padding: '12px 10px 6px' }}>{s.g}</div>
              {s.items.map((item, i) => (
                <div key={item} style={{
                  padding: '8px 10px', borderRadius: 6,
                  background: (s.g === 'Performance' && i === 0) ? WF.bgPanelHi : 'transparent',
                  color: (s.g === 'Performance' && i === 0) ? WF.ink : WF.ink2,
                  fontSize: 13,
                  borderLeft: (s.g === 'Performance' && i === 0) ? `2px solid ${WF.accent}` : '2px solid transparent',
                }}>{item}</div>
              ))}
            </div>
          ))}
        </div>
        {/* Body — Performance · Budget targets */}
        <div style={{ background: WF.bgPanel, border: `1px solid ${WF.border}`, borderRadius: 12, padding: '24px 28px', overflowY: 'auto' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 4 }}>
            <span style={{ fontSize: 13, color: WF.ink3 }}>Performance</span>
            <span style={{ color: WF.ink3 }}>·</span>
            <span style={{ fontSize: 13, color: WF.ink2 }}>Budget targets</span>
          </div>
          <div style={{ fontSize: 26, fontWeight: 600, marginBottom: 6 }}>Performance budget</div>
          <div style={{ fontSize: 13, color: WF.ink2, marginBottom: 24, maxWidth: 700 }}>
            Hard limits the hub will respect. When a tile would push the budget over,
            it auto-degrades: visualizer drops to 30 fps, tiles outside the active layout
            unload, and process polling rate falls back. Measured over 60s on this machine.
          </div>

          {/* Budget table */}
          <div style={{ background: WF.bg, border: `1px solid ${WF.rule}`, borderRadius: 10, overflow: 'hidden', marginBottom: 24 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', padding: '10px 16px', borderBottom: `1px solid ${WF.rule}`, fontSize: 10, color: WF.ink3, textTransform: 'uppercase', letterSpacing: '.06em', fontFamily: WF.fontMono }}>
              <span>metric</span><span>idle</span><span>visualizer active</span><span>full layout</span>
            </div>
            {[
              { k: 'CPU', v: ['< 1%', '< 3%', '< 5%'], cur: '1.2%', pct: 0.24 },
              { k: 'RAM', v: ['< 100 MB', '< 150 MB', '< 250 MB'], cur: '142 MB', pct: 0.57 },
              { k: 'GPU', v: ['< 1%', '< 5%', '< 8%'], cur: '3%', pct: 0.38 },
            ].map(r => (
              <div key={r.k} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', padding: '14px 16px', borderBottom: `1px solid ${WF.rule}`, alignItems: 'center', fontFamily: WF.fontMono, fontSize: 12, color: WF.ink }}>
                <div>
                  <div style={{ color: WF.ink, fontWeight: 600 }}>{r.k}</div>
                  <div style={{ color: WF.ok, fontSize: 11 }}>now: {r.cur}</div>
                </div>
                {r.v.map((v, i) => (
                  <div key={i} style={{ color: WF.ink2 }}>{v}</div>
                ))}
              </div>
            ))}
          </div>

          {/* Knobs */}
          <SettingRow label="Auto-degrade when over budget" desc="Drop visualizer to 30 fps and pause off-screen tiles."><Toggle on /></SettingRow>
          <SettingRow label="Idle detection" desc="With no audio + no input, drop visualizer to ambient mode."><Pills items={['Off', '1 min', '5 min', '15 min']} active={2} /></SettingRow>
          <SettingRow label="Sampling rate (system metrics)" desc="Higher = smoother graphs, more CPU."><Pills items={['0.5 Hz', '1 Hz', '2 Hz']} active={1} mono /></SettingRow>
          <SettingRow label="Shared WebView2 environment" desc="Single process for all web tiles. Recommended."><Toggle on /></SettingRow>
          <SettingRow label="Lazy tile init" desc="Tiles in inactive profiles don't load until switched to."><Toggle on /></SettingRow>
          <SettingRow label="Telemetry" desc="No usage data is collected. This setting is for transparency."><Toggle on={false} /></SettingRow>
        </div>
      </div>
    </HubFrame>
  );
}

function SettingRow({ label, desc, children }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 16, alignItems: 'center', padding: '16px 0', borderBottom: `1px solid ${WF.rule}` }}>
      <div>
        <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 2 }}>{label}</div>
        <div style={{ fontSize: 12, color: WF.ink3 }}>{desc}</div>
      </div>
      <div>{children}</div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// EMPTY STATE / FIRST-LAUNCH ONBOARDING
// ─────────────────────────────────────────────────────────────────────────────
function OnboardingPage({ scale = 0.5 }) {
  return (
    <HubFrame scale={scale} hideChrome>
      <div style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}>
        <Visualizer mode="ambient" />
      </div>
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(6,8,14,0.55)' }} />

      <div style={{ position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%,-50%)', width: 1300, textAlign: 'center' }}>
        <div style={{ width: 60, height: 60, borderRadius: 14, background: `linear-gradient(135deg, ${WF.accent}, ${WF.accent2})`, margin: '0 auto 24px', boxShadow: `0 0 40px ${WF.accentDim}` }} />
        <div style={{ fontSize: 44, fontWeight: 700, marginBottom: 12, letterSpacing: '-.02em' }}>
          Welcome to your second monitor
        </div>
        <div style={{ fontSize: 16, color: WF.ink2, maxWidth: 720, margin: '0 auto 40px', lineHeight: 1.5 }}>
          One configurable, always-on hub. Pick a starter layout — you can change everything later,
          or start from a blank canvas.
        </div>

        {/* Starter layouts */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 32 }}>
          {[
            { name: 'Work', desc: 'Comms · viz · sysmon', preview: <MiniLayoutA />, recommended: true },
            { name: 'Gaming', desc: 'Voice · viz · perf', preview: <MiniLayoutGaming /> },
            { name: 'Chill', desc: 'Ambient · now playing', preview: <MiniLayoutChill /> },
            { name: 'Blank', desc: 'Build your own', preview: <BlankCanvas /> },
          ].map(s => (
            <div key={s.name} style={{
              background: WF.bgPanel, border: `1px solid ${s.recommended ? WF.borderHi : WF.border}`,
              borderRadius: 12, padding: 14, textAlign: 'left',
              boxShadow: s.recommended ? `0 0 0 1px ${WF.accentDim}` : 'none',
              position: 'relative',
            }}>
              {s.recommended && (
                <span style={{ position: 'absolute', top: -10, left: 14, background: WF.accent, color: '#0a0a0a', fontSize: 10, fontWeight: 600, padding: '3px 8px', borderRadius: 4 }}>recommended</span>
              )}
              <div style={{ aspectRatio: '16 / 9', background: '#060810', borderRadius: 8, marginBottom: 10, position: 'relative', overflow: 'hidden', border: `1px solid ${WF.rule}` }}>
                {s.preview}
              </div>
              <div style={{ fontSize: 14, fontWeight: 600 }}>{s.name}</div>
              <div style={{ fontSize: 11, color: WF.ink3 }}>{s.desc}</div>
            </div>
          ))}
        </div>

        {/* Steps strip */}
        <div style={{ display: 'flex', gap: 10, justifyContent: 'center', marginBottom: 28 }}>
          {[
            { s: '1', label: 'Pick a layout', on: true },
            { s: '2', label: 'Connect accounts', on: false },
            { s: '3', label: 'Tune visualizer', on: false },
            { s: '4', label: 'Set hotkeys', on: false },
          ].map(x => (
            <div key={x.s} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{
                width: 22, height: 22, borderRadius: 999,
                background: x.on ? WF.accent : 'transparent',
                color: x.on ? '#0a0a0a' : WF.ink3,
                border: x.on ? 'none' : `1px solid ${WF.border}`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 11, fontWeight: 600,
              }}>{x.s}</div>
              <span style={{ fontSize: 12, color: x.on ? WF.ink : WF.ink3 }}>{x.label}</span>
              {x.s !== '4' && <span style={{ width: 24, height: 1, background: WF.rule, marginLeft: 4 }} />}
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
          <button className="wf-btn ghost">Skip · start blank</button>
          <button className="wf-btn primary">Continue with Work →</button>
        </div>
        <div style={{ fontSize: 11, color: WF.ink3, marginTop: 24 }}>
          ⌘ + E to enter edit mode anytime · all layouts are reconfigurable
        </div>
      </div>
    </HubFrame>
  );
}

function BlankCanvas() {
  return (
    <div className="wf-grid-bg" style={{ position: 'absolute', inset: 0, background: WF.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', color: WF.ink3, fontSize: 14 }}>
      ＋
    </div>
  );
}

Object.assign(window, {
  ProfileSwitcher, MiniLayoutA, MiniLayoutGaming, MiniLayoutChill, MiniLayoutFocus,
  SettingsPage, SettingRow, OnboardingPage, BlankCanvas,
});

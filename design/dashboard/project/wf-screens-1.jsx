// Visualizer config (full-screen page) + System monitor drilldown + Tile picker

// ─────────────────────────────────────────────────────────────────────────────
// VIZ CONFIG — Full-screen page. Big preview left, modes/settings right.
// ─────────────────────────────────────────────────────────────────────────────
function VizConfigPage({ scale = 0.5 }) {
  return (
    <HubFrame scale={scale}>
      {/* Top bar — breadcrumb */}
      <div style={{ position: 'absolute', top: 14, left: 16, right: 16, display: 'flex', alignItems: 'center', gap: 12, zIndex: 5 }}>
        <button className="wf-btn ghost">← Back to hub</button>
        <span style={{ color: WF.ink3, fontSize: 13 }}>›</span>
        <span style={{ fontSize: 13, color: WF.ink2 }}>Visualizer settings</span>
        <div style={{ flex: 1 }} />
        <button className="wf-btn">Import preset</button>
        <button className="wf-btn">Export preset</button>
        <button className="wf-btn primary">Save preset</button>
      </div>

      <div style={{ position: 'absolute', top: 60, left: 16, right: 16, bottom: 16, display: 'grid', gridTemplateColumns: '1.6fr 1fr', gap: 16 }}>
        {/* Preview side */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minHeight: 0 }}>
          <div style={{
            flex: 1, borderRadius: 14, border: `1px solid ${WF.border}`,
            background: '#060810', position: 'relative', overflow: 'hidden',
          }}>
            <Visualizer mode="bars" />
            {/* Preview chrome */}
            <div style={{ position: 'absolute', top: 14, left: 14, display: 'flex', gap: 6 }}>
              <span className="wf-chip" style={{ background: 'rgba(0,0,0,0.4)' }}>● Preview</span>
              <span className="wf-chip" style={{ background: 'rgba(0,0,0,0.4)' }}>Live audio</span>
            </div>
            <div style={{ position: 'absolute', bottom: 14, left: 14, right: 14, display: 'flex', gap: 8, justifyContent: 'space-between', alignItems: 'flex-end' }}>
              <div>
                <div className="wf-mono" style={{ fontSize: 11, color: WF.ink3 }}>now playing</div>
                <div style={{ fontSize: 13, color: WF.ink }}>Midnight City — M83</div>
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button className="wf-btn ghost" style={{ background: 'rgba(0,0,0,0.4)' }}>↻ Resync</button>
                <button className="wf-btn ghost" style={{ background: 'rgba(0,0,0,0.4)' }}>⛶ Fullscreen</button>
              </div>
            </div>
          </div>
          {/* Mode strip */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 10 }}>
            {[
              { name: 'Bars', mode: 'bars' },
              { name: 'Waveform', mode: 'waveform' },
              { name: 'Radial', mode: 'radial' },
              { name: 'Particles', mode: 'particles' },
              { name: 'Ambient', mode: 'ambient' },
            ].map((m, i) => (
              <div key={m.name} style={{
                aspectRatio: '16 / 9',
                background: '#060810',
                borderRadius: 10,
                border: `2px solid ${i === 0 ? WF.accent : WF.border}`,
                position: 'relative', overflow: 'hidden',
              }}>
                <Visualizer mode={m.mode} animated={false} />
                <div style={{
                  position: 'absolute', bottom: 0, left: 0, right: 0,
                  padding: '6px 10px', fontSize: 11, color: WF.ink, fontWeight: 600,
                  background: 'linear-gradient(180deg, transparent, rgba(0,0,0,0.6))',
                }}>{m.name}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Settings side */}
        <div style={{ background: WF.bgPanel, border: `1px solid ${WF.border}`, borderRadius: 14, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: '16px 20px', borderBottom: `1px solid ${WF.rule}` }}>
            <div style={{ fontSize: 17, fontWeight: 600 }}>Bars</div>
            <div style={{ fontSize: 12, color: WF.ink3 }}>Classic spectrum analyzer · "lo-fi sunset" preset</div>
          </div>
          <div style={{ flex: 1, overflowY: 'auto', padding: '8px 0' }}>
            <CfgSection title="Color">
              <CfgRow label="Type">
                <Pills items={['Solid', 'Gradient', 'Reactive', 'Theme']} active={1} />
              </CfgRow>
              <CfgRow label="Stops">
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <Swatch color={WF.accent2} />
                  <Swatch color={WF.accent} />
                  <Swatch color="#f5b97c" />
                  <span style={{ fontSize: 11, color: WF.ink3, marginLeft: 4 }}>+ add stop</span>
                </div>
              </CfgRow>
              <CfgRow label="Gradient angle"><Slider value={0.25} hint="90°" /></CfgRow>
            </CfgSection>
            <CfgSection title="Response">
              <CfgRow label="Sensitivity"><Slider value={0.6} hint="0.6" /></CfgRow>
              <CfgRow label="Smoothing"><Slider value={0.7} hint="0.7" /></CfgRow>
              <CfgRow label="FFT size">
                <Pills items={['512', '1024', '2048', '4096']} active={2} mono />
              </CfgRow>
              <CfgRow label="Frequency focus">
                <Pills items={['Full', 'Bass', 'Mid', 'Treble']} active={0} />
              </CfgRow>
            </CfgSection>
            <CfgSection title="Bars (mode-specific)">
              <CfgRow label="Bar count"><Slider value={0.4} hint="48" /></CfgRow>
              <CfgRow label="Bar width"><Slider value={0.55} hint="3px" /></CfgRow>
              <CfgRow label="Peak hold"><Toggle on /></CfgRow>
              <CfgRow label="Mirror"><Toggle on={false} /></CfgRow>
            </CfgSection>
            <CfgSection title="Background">
              <CfgRow label="Type">
                <Pills items={['Transparent', 'Solid', 'Animated']} active={0} />
              </CfgRow>
              <CfgRow label="Glow / bloom"><Slider value={0.3} hint="30%" /></CfgRow>
            </CfgSection>
            <CfgSection title="Performance">
              <CfgRow label="Target fps">
                <Pills items={['30', '60', 'Auto']} active={2} mono />
              </CfgRow>
              <CfgRow label="Pause when off-screen"><Toggle on /></CfgRow>
              <CfgRow label="Drop to ambient when idle">
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <Toggle on /><span style={{ fontSize: 11, color: WF.ink3 }}>after 5 min</span>
                </div>
              </CfgRow>
              <CfgRow label="Estimated cost">
                <div style={{ fontSize: 11, color: WF.ink2 }}>
                  <span className="wf-mono" style={{ color: WF.ok }}>2.1% CPU</span> · <span className="wf-mono" style={{ color: WF.ok }}>4% GPU</span>
                </div>
              </CfgRow>
            </CfgSection>
          </div>
          <div style={{ padding: 16, borderTop: `1px solid ${WF.rule}`, display: 'flex', gap: 10 }}>
            <button className="wf-btn ghost" style={{ flex: 1 }}>Reset to defaults</button>
            <button className="wf-btn primary" style={{ flex: 1 }}>Apply</button>
          </div>
        </div>
      </div>

      {/* preset rail bottom */}
      <div style={{ position: 'absolute', bottom: 60, left: 16, right: 16 + 36, display: 'flex', gap: 10, alignItems: 'center', pointerEvents: 'none' }}>
      </div>
    </HubFrame>
  );
}

function CfgSection({ title, children }) {
  return (
    <div style={{ padding: '16px 20px', borderBottom: `1px solid ${WF.rule}` }}>
      <div style={{ fontSize: 11, color: WF.ink3, textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 12 }}>{title}</div>
      {children}
    </div>
  );
}
function CfgRow({ label, children }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '140px 1fr', alignItems: 'center', gap: 16, marginBottom: 12 }}>
      <span style={{ fontSize: 12, color: WF.ink2 }}>{label}</span>
      <div>{children}</div>
    </div>
  );
}
function Pills({ items, active, mono }) {
  return (
    <div style={{ display: 'flex', gap: 4, background: WF.bg, padding: 3, borderRadius: 6, border: `1px solid ${WF.border}`, width: 'fit-content' }}>
      {items.map((t, i) => (
        <div key={t} style={{
          padding: '5px 10px', fontSize: 11,
          fontFamily: mono ? WF.fontMono : 'inherit',
          background: i === active ? WF.bgPanelHi : 'transparent',
          color: i === active ? WF.ink : WF.ink3,
          border: `1px solid ${i === active ? WF.border : 'transparent'}`,
          borderRadius: 4,
        }}>{t}</div>
      ))}
    </div>
  );
}
function Swatch({ color }) {
  return <div style={{ width: 22, height: 22, borderRadius: 5, background: color, border: `1px solid ${WF.border}` }} />;
}

// ─────────────────────────────────────────────────────────────────────────────
// SYSTEM MONITOR DRILLDOWN — Detailed mode w/ all metrics
// ─────────────────────────────────────────────────────────────────────────────
function SysMonDrilldown({ scale = 0.5 }) {
  return (
    <HubFrame scale={scale}>
      <div style={{ position: 'absolute', top: 14, left: 16, right: 16, bottom: 16, display: 'grid', gridTemplateColumns: '1fr', gridTemplateRows: 'auto 1fr', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button className="wf-btn ghost">← Back</button>
          <span style={{ fontSize: 18, fontWeight: 600 }}>System monitor · detailed</span>
          <div style={{ flex: 1 }} />
          <Pills items={['Compact', 'Standard', 'Detailed']} active={2} />
          <Pills items={['0.5 Hz', '1 Hz', '2 Hz']} active={1} mono />
          <button className="wf-btn">Export CSV</button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gridTemplateRows: '1fr 1fr', gap: 14, minHeight: 0 }}>
          <BigGraph title="CPU" value="23%" sub="Ryzen 7 7800X3D · 8C/16T · 4.1 GHz · 58°C" data={SAMPLE_CPU} color={WF.accent}
            sub2={[
              ['per-core', null],
              ...Array.from({ length: 8 }, (_, i) => [`C${i}`, `${(15 + i * 4) % 60}%`]),
            ]}
          />
          <BigGraph title="RAM" value="14.2 / 32 GB" sub="DDR5 6000 · swap unused" data={SAMPLE_RAM} color={WF.accent2}
            sub2={[
              ['total', '32.0 GB'],
              ['used', '14.2 GB'],
              ['cached', '6.7 GB'],
              ['available', '17.8 GB'],
              ['swap', '0 / 16 GB'],
            ]}
          />
          <BigGraph title="GPU" value="41%" sub="RTX 4070 · 6.1 / 12 GB · 64°C · 142W" data={SAMPLE_GPU} color={WF.warn}
            sub2={[
              ['util', '41%'],
              ['vram', '6.1 / 12 GB'],
              ['temp', '64°C'],
              ['power', '142 / 200 W'],
              ['clock', '2640 MHz'],
            ]}
          />
          <ProcessTable />
        </div>
      </div>
    </HubFrame>
  );
}

function BigGraph({ title, value, sub, data, color, sub2 }) {
  return (
    <div style={{ background: WF.bgPanel, border: `1px solid ${WF.border}`, borderRadius: 12, padding: 18, display: 'flex', flexDirection: 'column', gap: 12, minHeight: 0 }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12 }}>
        <div>
          <div style={{ fontSize: 11, color: WF.ink3, textTransform: 'uppercase', letterSpacing: '.06em' }}>{title}</div>
          <div style={{ fontSize: 28, fontWeight: 700, fontFamily: WF.fontMono, lineHeight: 1 }}>{value}</div>
        </div>
        <div style={{ fontSize: 11, color: WF.ink3, paddingBottom: 4 }}>{sub}</div>
        <div style={{ flex: 1 }} />
        <div style={{ fontSize: 10, color: WF.ink3, textAlign: 'right', fontFamily: WF.fontMono }}>
          <div>min 8% · avg 22% · max 71%</div>
          <div>last 60s</div>
        </div>
      </div>
      <div style={{ flex: 1, minHeight: 80 }}>
        <Sparkline data={data} color={color} height="100%" />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(60px, 1fr))', gap: 6, fontSize: 10, fontFamily: WF.fontMono, color: WF.ink2 }}>
        {sub2 && sub2.map(([k, v], i) => (
          <div key={i} style={{ background: WF.bg, border: `1px solid ${WF.rule}`, borderRadius: 4, padding: '4px 6px', display: 'flex', justifyContent: 'space-between', gap: 4 }}>
            <span style={{ color: WF.ink3 }}>{k}</span>
            <span style={{ color: WF.ink }}>{v}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ProcessTable() {
  const procs = [
    { name: 'chrome.exe', cpu: '12.4%', ram: '2.1 GB', gpu: '8%' },
    { name: 'Hub.exe', cpu: '1.2%', ram: '142 MB', gpu: '3%' },
    { name: 'Discord.exe', cpu: '3.1%', ram: '480 MB', gpu: '1%' },
    { name: 'Spotify.exe', cpu: '0.8%', ram: '210 MB', gpu: '0%' },
    { name: 'Code.exe', cpu: '4.7%', ram: '1.4 GB', gpu: '0%' },
    { name: 'explorer.exe', cpu: '0.3%', ram: '85 MB', gpu: '0%' },
  ];
  return (
    <div style={{ background: WF.bgPanel, border: `1px solid ${WF.border}`, borderRadius: 12, padding: 18, display: 'flex', flexDirection: 'column', gap: 10, minHeight: 0 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
        <span style={{ fontSize: 11, color: WF.ink3, textTransform: 'uppercase', letterSpacing: '.06em' }}>Top processes</span>
        <Pills items={['by CPU', 'by RAM', 'by GPU']} active={0} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr', fontSize: 10, color: WF.ink3, padding: '4px 0', borderBottom: `1px solid ${WF.rule}`, fontFamily: WF.fontMono, textTransform: 'uppercase', letterSpacing: '.04em' }}>
        <span>process</span><span>cpu</span><span>ram</span><span>gpu</span>
      </div>
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {procs.map((p, i) => (
          <div key={i} style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr', fontSize: 12, padding: '8px 0', borderBottom: `1px solid ${WF.rule}` }}>
            <span style={{ color: WF.ink }}>{p.name}</span>
            <span className="wf-mono" style={{ color: WF.ink2 }}>{p.cpu}</span>
            <span className="wf-mono" style={{ color: WF.ink2 }}>{p.ram}</span>
            <span className="wf-mono" style={{ color: WF.ink2 }}>{p.gpu}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TILE PICKER — modal drawer w/ categorized tile types
// ─────────────────────────────────────────────────────────────────────────────
function TilePicker({ scale = 0.5 }) {
  return (
    <HubFrame scale={scale} editMode>
      {/* Dimmed hub behind */}
      <div style={{ position: 'absolute', inset: 0, opacity: 0.35 }}>
        <div style={{ position: 'absolute', inset: 16, display: 'grid', gridTemplateColumns: '720px 1fr 540px', gridTemplateRows: '1fr 360px', gap: 14 }}>
          <DiscordTile style={{ gridRow: '1 / span 2', gridColumn: 1 }} />
          <YouTubeTile style={{ gridRow: 1, gridColumn: 2 }} />
          <ClockTile style={{ gridRow: 1, gridColumn: 3 }} />
          <VizTile mode="bars" dominant style={{ gridRow: 2, gridColumn: '2 / span 2' }} />
        </div>
      </div>
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.5)' }} />

      {/* Modal */}
      <div style={{
        position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%,-50%)',
        width: 1600, height: 1100,
        background: WF.bgPanel, border: `1px solid ${WF.border}`, borderRadius: 16,
        boxShadow: '0 40px 100px rgba(0,0,0,0.6)',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }}>
        <div style={{ padding: '20px 24px', borderBottom: `1px solid ${WF.rule}`, display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 18, fontWeight: 600 }}>Add tile</div>
            <div style={{ fontSize: 12, color: WF.ink3 }}>Pick a tile type — drag to position, or place in the highlighted slot</div>
          </div>
          <input className="wf-input" placeholder="Search tiles…" style={{ width: 280 }} />
          <button className="wf-btn ghost">✕</button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '220px 1fr', flex: 1, minHeight: 0 }}>
          {/* Categories */}
          <div style={{ borderRight: `1px solid ${WF.rule}`, padding: 14, display: 'flex', flexDirection: 'column', gap: 4 }}>
            {[
              { c: 'All', n: 24, on: true },
              { c: 'Web', n: 8 },
              { c: 'Native apps', n: 6 },
              { c: 'Widgets', n: 7 },
              { c: 'Visualizers', n: 5 },
              { c: 'System', n: 4 },
              { c: 'Plugins', n: 3 },
              { c: 'My presets', n: 2 },
            ].map(c => (
              <div key={c.c} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', borderRadius: 6, background: c.on ? WF.bgPanelHi : 'transparent', color: c.on ? WF.ink : WF.ink2, fontSize: 13 }}>
                <span>{c.c}</span>
                <span style={{ fontSize: 11, color: WF.ink3 }}>{c.n}</span>
              </div>
            ))}
          </div>
          {/* Grid */}
          <div style={{ padding: 20, overflowY: 'auto' }}>
            <div style={{ fontSize: 11, color: WF.ink3, textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 12 }}>Visualizers</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12, marginBottom: 28 }}>
              {[
                { name: 'Bars', mode: 'bars', desc: 'Spectrum analyzer' },
                { name: 'Waveform', mode: 'waveform', desc: 'Oscilloscope' },
                { name: 'Radial', mode: 'radial', desc: 'Bars wrapped circular' },
                { name: 'Particles', mode: 'particles', desc: 'GPU particle system' },
                { name: 'Ambient', mode: 'ambient', desc: 'Slow gradients' },
              ].map(t => (
                <PickerCard key={t.name} title={t.name} desc={t.desc}>
                  <Visualizer mode={t.mode} animated={false} />
                </PickerCard>
              ))}
            </div>

            <div style={{ fontSize: 11, color: WF.ink3, textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 12 }}>Web tiles</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12, marginBottom: 28 }}>
              {[
                { name: 'Discord', host: 'discord.com' },
                { name: 'Slack', host: 'app.slack.com' },
                { name: 'Spotify', host: 'open.spotify.com' },
                { name: 'YouTube', host: 'youtube.com' },
                { name: 'Custom URL', host: 'arbitrary' },
              ].map(t => (
                <PickerCard key={t.name} title={t.name} desc={t.host}>
                  <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: WF.ink3, fontSize: 22 }}>◐</div>
                </PickerCard>
              ))}
            </div>

            <div style={{ fontSize: 11, color: WF.ink3, textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 12 }}>Widgets</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12 }}>
              {[
                { name: 'Now playing', desc: 'Spotify Web API' },
                { name: 'Discord status', desc: 'RPC over IPC' },
                { name: 'Clock', desc: 'Local time' },
                { name: 'Weather', desc: 'OpenWeather' },
                { name: 'Calendar', desc: 'iCal feed' },
                { name: 'System monitor', desc: 'CPU · RAM · GPU' },
                { name: 'Notes', desc: 'Markdown scratchpad' },
              ].map(t => (
                <PickerCard key={t.name} title={t.name} desc={t.desc} />
              ))}
            </div>
          </div>
        </div>
        <div style={{ padding: 14, borderTop: `1px solid ${WF.rule}`, display: 'flex', gap: 10, alignItems: 'center' }}>
          <span className="wf-chip">⌘ K to search</span>
          <span style={{ fontSize: 12, color: WF.ink3 }}>1 selected · YouTube</span>
          <div style={{ flex: 1 }} />
          <button className="wf-btn ghost">Cancel</button>
          <button className="wf-btn primary">Place tile →</button>
        </div>
      </div>
    </HubFrame>
  );
}

function PickerCard({ title, desc, children }) {
  return (
    <div style={{ background: WF.bg, border: `1px solid ${WF.border}`, borderRadius: 10, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      <div style={{ aspectRatio: '16 / 10', borderBottom: `1px solid ${WF.rule}`, background: '#06080c' }}>
        {children}
      </div>
      <div style={{ padding: 10 }}>
        <div style={{ fontSize: 13, fontWeight: 600 }}>{title}</div>
        <div style={{ fontSize: 11, color: WF.ink3 }}>{desc}</div>
      </div>
    </div>
  );
}

Object.assign(window, { VizConfigPage, SysMonDrilldown, TilePicker, BigGraph, ProcessTable, PickerCard, Pills });

// Hub layout variations + edit mode — Frame component renders a 2560x1440 hub canvas.
// Each artboard scales the 2560x1440 canvas down via CSS transform.

function HubFrame({ children, width = 2560, height = 1440, scale = 1, chrome = true, profileName = 'Work', editMode = false, hideChrome = false }) {
  return (
    <div style={{ width: width * scale, height: height * scale, overflow: 'hidden', background: '#000' }}>
      <div className="wf-hub" style={{
        width, height,
        transform: `scale(${scale})`, transformOrigin: 'top left',
        position: 'relative',
        background: WF.bg,
      }}>
        {chrome && <HubChrome profileName={profileName} editMode={editMode} hideChrome={hideChrome} />}
        <div style={{ position: 'absolute', inset: chrome ? '36px 0 28px 0' : 0 }}>
          {children}
        </div>
        {chrome && <HubFooter />}
      </div>
    </div>
  );
}

function HubChrome({ profileName, editMode, hideChrome }) {
  if (hideChrome) return null;
  return (
    <div style={{
      position: 'absolute', top: 0, left: 0, right: 0, height: 36,
      background: 'rgba(14,15,18,0.85)', backdropFilter: 'blur(8px)',
      borderBottom: `1px solid ${WF.rule}`,
      display: 'flex', alignItems: 'center', padding: '0 14px', gap: 14,
      fontSize: 12, color: WF.ink2, zIndex: 10,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ width: 14, height: 14, borderRadius: 4, background: `linear-gradient(135deg, ${WF.accent}, ${WF.accent2})` }} />
        <span style={{ color: WF.ink, fontWeight: 600 }}>Hub</span>
      </div>
      <div style={{ width: 1, height: 16, background: WF.rule }} />
      {/* profile pills */}
      <div style={{ display: 'flex', gap: 4 }}>
        {['Work', 'Gaming', 'Chill'].map(p => (
          <div key={p} style={{
            padding: '4px 10px', borderRadius: 5, fontSize: 11,
            background: p === profileName ? WF.bgPanelHi : 'transparent',
            color: p === profileName ? WF.ink : WF.ink3,
            border: p === profileName ? `1px solid ${WF.border}` : '1px solid transparent',
          }}>{p}</div>
        ))}
        <div style={{ padding: '4px 8px', fontSize: 11, color: WF.ink3 }}>+</div>
      </div>
      <div style={{ flex: 1 }} />
      {editMode && (
        <span className="wf-chip" style={{ background: WF.accentDim, color: WF.accent, borderColor: 'transparent' }}>● editing</span>
      )}
      <span style={{ fontSize: 11, color: WF.ink3 }}>monitor 2 · 2560×1440</span>
      <span style={{ fontSize: 11, color: WF.ink3, fontFamily: WF.fontMono }}>14:32</span>
    </div>
  );
}

function HubFooter() {
  return (
    <div style={{
      position: 'absolute', bottom: 0, left: 0, right: 0, height: 28,
      borderTop: `1px solid ${WF.rule}`, background: 'rgba(14,15,18,0.85)',
      display: 'flex', alignItems: 'center', padding: '0 14px', gap: 14,
      fontSize: 11, color: WF.ink3, zIndex: 10,
    }}>
      <span>● 7 tiles</span>
      <span>CPU 1.2%</span>
      <span>RAM 142 MB</span>
      <span>GPU 3%</span>
      <div style={{ flex: 1 }} />
      <span>⌘ + E edit · ⌘ + 1/2/3 profile · ⌘ + K command</span>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// VARIATION A — Asymmetric viz-dominant. Big visualizer fills bottom-right,
// comm rail on left, telemetry top-right.
// ─────────────────────────────────────────────────────────────────────────────
function HubLayoutA({ scale = 0.5 }) {
  return (
    <HubFrame scale={scale} profileName="Work">
      <div style={{ position: 'absolute', inset: 16, display: 'grid',
        gridTemplateColumns: '720px 1fr 540px',
        gridTemplateRows: '1fr 360px',
        gap: 14,
      }}>
        <DiscordTile style={{ gridRow: '1 / span 2', gridColumn: 1 }} />
        <YouTubeTile label="YouTube · long form" style={{ gridRow: 1, gridColumn: 2 }} />
        <div style={{ gridRow: 1, gridColumn: 3, display: 'grid', gridTemplateRows: '180px 1fr', gap: 14 }}>
          <ClockTile />
          <SpotifyTile />
        </div>
        <VizTile mode="bars" dominant style={{ gridRow: 2, gridColumn: '2 / span 2' }} />
      </div>
      <Anno x={1530} y={780}>flagship visualizer<br/>fills lower 2/3</Anno>
      <Anno x={70} y={70}>comms always-on<br/>left rail</Anno>
    </HubFrame>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// VARIATION B — Bento box, viz center, tiles tightly packed around it.
// ─────────────────────────────────────────────────────────────────────────────
function HubLayoutB({ scale = 0.5 }) {
  return (
    <HubFrame scale={scale} profileName="Work">
      <div style={{ position: 'absolute', inset: 16, display: 'grid',
        gridTemplateColumns: '380px 1fr 1fr 380px',
        gridTemplateRows: '260px 1fr 220px',
        gap: 12,
      }}>
        <ClockTile style={{ gridRow: 1, gridColumn: 1 }} />
        <SpotifyTile style={{ gridRow: 1, gridColumn: '2 / span 2' }} />
        <SysMonTile mode="standard" style={{ gridRow: 1, gridColumn: 4 }} />

        <DiscordTile style={{ gridRow: '2 / span 2', gridColumn: 1 }} />
        <VizTile mode="radial" dominant style={{ gridRow: 2, gridColumn: '2 / span 2' }} />
        <YouTubeTile style={{ gridRow: '2 / span 2', gridColumn: 4 }} />

        <WebTile url="discord.com/channels/@me" title="Slack" style={{ gridRow: 3, gridColumn: 2 }} />
        <WebTile url="cal.com" title="Calendar" style={{ gridRow: 3, gridColumn: 3 }} />
      </div>
      <Anno x={1100} y={600}>bento — viz at the<br/>center of gravity</Anno>
    </HubFrame>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// VARIATION C — Sidebar + main canvas. Comms rail left, focused content right.
// ─────────────────────────────────────────────────────────────────────────────
function HubLayoutC({ scale = 0.5 }) {
  return (
    <HubFrame scale={scale} profileName="Work">
      <div style={{ position: 'absolute', inset: 16, display: 'grid',
        gridTemplateColumns: '440px 1fr',
        gridTemplateRows: '1fr',
        gap: 14,
      }}>
        {/* left rail: stacked comms */}
        <div style={{ display: 'grid', gridTemplateRows: '1fr 1fr 220px', gap: 14 }}>
          <DiscordTile />
          <WebTile url="web.whatsapp.com" title="WhatsApp" />
          <SpotifyTile />
        </div>
        {/* right: viz hero + telemetry strip */}
        <div style={{ display: 'grid', gridTemplateRows: '1fr 320px', gap: 14 }}>
          <VizTile mode="ambient" dominant />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 14 }}>
            <SysMonTile mode="standard" />
            <YouTubeTile label="Background loop" />
            <ClockTile />
          </div>
        </div>
      </div>
      <Anno x={520} y={60}>ambient mode — low-distraction<br/>default for working</Anno>
    </HubFrame>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// VARIATION D — Minimal/ambient. Viz fullscreen, tiles fade in as glass overlays
// at the edges. Most "left running" friendly.
// ─────────────────────────────────────────────────────────────────────────────
function HubLayoutD({ scale = 0.5 }) {
  return (
    <HubFrame scale={scale} profileName="Chill" hideChrome>
      <div style={{ position: 'absolute', inset: 0 }}>
        <Visualizer mode="ambient" />
      </div>
      {/* Floating glass tiles */}
      <div style={{ position: 'absolute', top: 24, left: 24, right: 24, display: 'flex', gap: 14, justifyContent: 'space-between' }}>
        <GlassTile style={{ width: 320 }}>
          <div style={{ padding: 14 }}>
            <div style={{ fontSize: 36, fontWeight: 700, fontFamily: WF.fontMono }}>14:32</div>
            <div style={{ fontSize: 11, color: WF.ink2 }}>Wed · Apr 29 · 62°F</div>
          </div>
        </GlassTile>
        <GlassTile style={{ width: 360 }}>
          <div style={{ padding: 12, display: 'flex', gap: 10, alignItems: 'center' }}>
            <div style={{ width: 48, height: 48, borderRadius: 6, background: `linear-gradient(135deg, ${WF.accent2}, ${WF.accent})` }} />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>Midnight City</div>
              <div style={{ fontSize: 11, color: WF.ink2 }}>M83</div>
              <div style={{ height: 2, background: 'rgba(255,255,255,0.15)', marginTop: 6, borderRadius: 1 }}>
                <div style={{ width: '38%', height: '100%', background: WF.accent }} />
              </div>
            </div>
          </div>
        </GlassTile>
        <GlassTile style={{ width: 320 }}>
          <div style={{ padding: 12, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, fontSize: 11, color: WF.ink2, fontFamily: WF.fontMono }}>
            <div>CPU<br/><span style={{ color: WF.ink, fontSize: 16, fontWeight: 600 }}>23%</span></div>
            <div>RAM<br/><span style={{ color: WF.ink, fontSize: 16, fontWeight: 600 }}>44%</span></div>
            <div>GPU<br/><span style={{ color: WF.ink, fontSize: 16, fontWeight: 600 }}>41%</span></div>
            <div>NET<br/><span style={{ color: WF.ink, fontSize: 16, fontWeight: 600 }}>8.2</span></div>
          </div>
        </GlassTile>
      </div>
      {/* Bottom dock */}
      <div style={{ position: 'absolute', bottom: 24, left: '50%', transform: 'translateX(-50%)' }}>
        <GlassTile>
          <div style={{ padding: '10px 16px', display: 'flex', gap: 14, alignItems: 'center', fontSize: 12, color: WF.ink2 }}>
            <span style={{ color: WF.accent }}>● ambient</span>
            <span>3 unread · Discord</span>
            <span style={{ color: WF.ink3 }}>|</span>
            <span>standup in 28 min</span>
            <span style={{ color: WF.ink3 }}>|</span>
            <span>hover to reveal tiles</span>
          </div>
        </GlassTile>
      </div>
      <Anno x={1100} y={760}>fullscreen ambient · glass tiles<br/>fade in on hover · "left running"</Anno>
    </HubFrame>
  );
}

function GlassTile({ children, style }) {
  return (
    <div style={{
      background: 'rgba(20,22,28,0.55)', backdropFilter: 'blur(20px)',
      border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12,
      boxShadow: '0 8px 40px rgba(0,0,0,0.4)',
      ...style,
    }}>
      {children}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// EDIT MODE — Figma-style. Toolbar top, properties panel right, tile selected
// with handles + grid overlay.
// ─────────────────────────────────────────────────────────────────────────────
function HubEditMode({ scale = 0.5 }) {
  return (
    <HubFrame scale={scale} editMode>
      {/* Edit toolbar */}
      <div style={{
        position: 'absolute', top: 12, left: 14, display: 'flex', gap: 4,
        background: WF.bgPanelHi, border: `1px solid ${WF.border}`, borderRadius: 8,
        padding: 4, zIndex: 6,
      }}>
        {[
          { ic: '↖', label: 'Select', active: true },
          { ic: '▢', label: 'Tile' },
          { ic: '▦', label: 'Group' },
          { ic: '✎', label: 'Comment' },
        ].map((t, i) => (
          <div key={i} style={{
            display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px',
            background: t.active ? WF.accent : 'transparent',
            color: t.active ? '#0a0a0a' : WF.ink2,
            borderRadius: 5, fontSize: 12, fontWeight: t.active ? 600 : 400,
          }}>
            <span>{t.ic}</span>{t.label}
          </div>
        ))}
        <div style={{ width: 1, background: WF.rule, margin: '4px 4px' }} />
        <div style={{ padding: '6px 10px', color: WF.ink2, fontSize: 12 }}>↶</div>
        <div style={{ padding: '6px 10px', color: WF.ink2, fontSize: 12 }}>↷</div>
        <div style={{ width: 1, background: WF.rule, margin: '4px 4px' }} />
        <div style={{ padding: '6px 10px', color: WF.ink2, fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ color: WF.ink }}>Snap</span>
          <span style={{ width: 24, height: 14, background: WF.accent, borderRadius: 7, position: 'relative' }}>
            <span style={{ position: 'absolute', right: 1, top: 1, width: 12, height: 12, background: '#0a0a0a', borderRadius: 999 }} />
          </span>
        </div>
        <div style={{ padding: '6px 10px', color: WF.ink2, fontSize: 12 }}>Grid 40px</div>
      </div>

      {/* Add-tile FAB */}
      <div style={{
        position: 'absolute', top: 12, right: 460, zIndex: 6,
        display: 'flex', gap: 6,
      }}>
        <button className="wf-btn">＋ Add tile</button>
        <button className="wf-btn primary">Done</button>
      </div>

      {/* Grid overlay */}
      <div style={{ position: 'absolute', inset: 16, right: 460 }} className="wf-grid-bg">
        {/* Tiles in edit mode — selected tile has accent outline + handles */}
        <div style={{ position: 'absolute', left: 0, top: 0, width: 700, height: 600 }}>
          <DiscordTile style={{ width: '100%', height: '100%' }} />
        </div>
        <div style={{ position: 'absolute', left: 720, top: 0, width: 800, height: 380 }}>
          <YouTubeTile style={{ width: '100%', height: '100%' }} />
        </div>
        <div style={{ position: 'absolute', left: 1540, top: 0, width: 480, height: 180 }}>
          <ClockTile style={{ width: '100%', height: '100%' }} />
        </div>
        <div style={{ position: 'absolute', left: 1540, top: 200, width: 480, height: 180 }}>
          <SpotifyTile style={{ width: '100%', height: '100%' }} />
        </div>

        {/* SELECTED — visualizer w/ handles */}
        <div style={{ position: 'absolute', left: 720, top: 400, width: 1300, height: 940 - 400 }}>
          <VizTile mode="bars" dominant style={{ width: '100%', height: '100%' }} />
          <SelectionHandles />
        </div>

        {/* Smart guides */}
        <div style={{ position: 'absolute', left: 720, top: 0, bottom: 0, width: 1, background: WF.accent, opacity: 0.6 }} />
        <div style={{ position: 'absolute', left: 720, top: 380, width: 1300, height: 1, background: WF.accent, opacity: 0.6 }} />
        <span style={{ position: 'absolute', left: 1380, top: 384, fontSize: 11, color: WF.accent, fontFamily: WF.fontMono }}>1300 × 540</span>
      </div>

      {/* Properties panel */}
      <PropertiesPanel />
    </HubFrame>
  );
}

function SelectionHandles() {
  const handle = { position: 'absolute', width: 10, height: 10, background: WF.bg, border: `2px solid ${WF.accent}`, borderRadius: 2, zIndex: 4 };
  return (
    <>
      <div style={{ position: 'absolute', inset: -2, border: `2px solid ${WF.accent}`, pointerEvents: 'none', borderRadius: 12 }} />
      <div style={{ ...handle, left: -7, top: -7 }} />
      <div style={{ ...handle, right: -7, top: -7 }} />
      <div style={{ ...handle, left: -7, bottom: -7 }} />
      <div style={{ ...handle, right: -7, bottom: -7 }} />
      <div style={{ ...handle, left: '50%', top: -7, transform: 'translateX(-50%)' }} />
      <div style={{ ...handle, left: '50%', bottom: -7, transform: 'translateX(-50%)' }} />
      <div style={{ ...handle, top: '50%', left: -7, transform: 'translateY(-50%)' }} />
      <div style={{ ...handle, top: '50%', right: -7, transform: 'translateY(-50%)' }} />
      {/* Floating label */}
      <div style={{
        position: 'absolute', top: -34, left: 0,
        background: WF.accent, color: '#0a0a0a', fontSize: 11, fontWeight: 600,
        padding: '3px 8px', borderRadius: 4,
      }}>Visualizer · Bars</div>
    </>
  );
}

function PropertiesPanel() {
  const Section = ({ title, children }) => (
    <div style={{ borderBottom: `1px solid ${WF.rule}`, padding: '14px 16px' }}>
      <div style={{ fontSize: 10, color: WF.ink3, textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 10 }}>{title}</div>
      {children}
    </div>
  );
  const Row = ({ label, children }) => (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, gap: 10 }}>
      <span style={{ fontSize: 11, color: WF.ink2, minWidth: 60 }}>{label}</span>
      <div style={{ flex: 1 }}>{children}</div>
    </div>
  );
  return (
    <div style={{
      position: 'absolute', top: 0, right: 0, bottom: 0, width: 440,
      background: WF.bgPanel, borderLeft: `1px solid ${WF.border}`,
      display: 'flex', flexDirection: 'column', zIndex: 5, overflow: 'hidden',
    }}>
      <div style={{ padding: '14px 16px', borderBottom: `1px solid ${WF.rule}`, display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ width: 32, height: 32, borderRadius: 6, background: `linear-gradient(135deg, ${WF.accent}, ${WF.accent2})`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16 }}>≣</div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>Visualizer</div>
          <div style={{ fontSize: 11, color: WF.ink3 }}>tile · widget</div>
        </div>
        <span className="wf-chip" style={{ fontSize: 10 }}>selected</span>
      </div>
      <div style={{ flex: 1, overflowY: 'auto' }} className="wf-scroll">
        <Section title="Position & size">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
            <PropField label="X" value="720" />
            <PropField label="Y" value="400" />
            <PropField label="W" value="1300" />
            <PropField label="H" value="540" />
          </div>
          <Row label="Snap"><span style={{ fontSize: 11, color: WF.ink }}>Grid 40px</span></Row>
          <Row label="Z-index"><span style={{ fontSize: 11, color: WF.ink }}>2</span></Row>
        </Section>
        <Section title="Mode">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 6, marginBottom: 8 }}>
            {['Bars', 'Wave', 'Radial', 'Particle', 'Ambient'].map((m, i) => (
              <div key={m} style={{
                padding: '6px 0', textAlign: 'center', fontSize: 10,
                background: i === 0 ? WF.accent : WF.bgPanelHi,
                color: i === 0 ? '#0a0a0a' : WF.ink2,
                border: `1px solid ${i === 0 ? 'transparent' : WF.border}`, borderRadius: 5,
                fontWeight: i === 0 ? 600 : 400,
              }}>{m}</div>
            ))}
          </div>
        </Section>
        <Section title="Appearance">
          <Row label="Color">
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <div style={{ width: 18, height: 18, borderRadius: 4, background: WF.accent, border: `1px solid ${WF.border}` }} />
              <span style={{ fontSize: 11, color: WF.ink, fontFamily: WF.fontMono }}>#7CF5D4</span>
              <span style={{ fontSize: 10, color: WF.ink3, marginLeft: 'auto' }}>solid</span>
            </div>
          </Row>
          <Row label="Background">
            <div style={{ display: 'flex', gap: 4 }}>
              {['solid', 'transp.', 'animated'].map((b, i) => (
                <div key={b} style={{ padding: '3px 8px', fontSize: 10, borderRadius: 4, background: i === 1 ? WF.bgPanelHi : 'transparent', border: `1px solid ${i === 1 ? WF.border : 'transparent'}`, color: i === 1 ? WF.ink : WF.ink3 }}>{b}</div>
              ))}
            </div>
          </Row>
          <Row label="Opacity"><Slider value={1.0} /></Row>
        </Section>
        <Section title="Audio (Bars)">
          <Row label="Bar count"><Slider value={0.4} hint="48" /></Row>
          <Row label="Sensitivity"><Slider value={0.6} hint="0.6" /></Row>
          <Row label="Smoothing"><Slider value={0.7} hint="0.7" /></Row>
          <Row label="FFT size">
            <div style={{ display: 'flex', gap: 4 }}>
              {[512, 1024, 2048, 4096].map(n => (
                <div key={n} style={{ padding: '3px 6px', fontSize: 10, borderRadius: 4, background: n === 2048 ? WF.bgPanelHi : 'transparent', border: `1px solid ${n === 2048 ? WF.border : 'transparent'}`, color: n === 2048 ? WF.ink : WF.ink3, fontFamily: WF.fontMono }}>{n}</div>
              ))}
            </div>
          </Row>
          <Row label="Range">
            <div style={{ display: 'flex', gap: 4 }}>
              {['full', 'bass', 'mid', 'treble'].map((r, i) => (
                <div key={r} style={{ padding: '3px 6px', fontSize: 10, borderRadius: 4, background: i === 0 ? WF.bgPanelHi : 'transparent', border: `1px solid ${i === 0 ? WF.border : 'transparent'}`, color: i === 0 ? WF.ink : WF.ink3 }}>{r}</div>
              ))}
            </div>
          </Row>
        </Section>
        <Section title="Performance">
          <Row label="Frame rate"><span style={{ fontSize: 11, color: WF.ink, fontFamily: WF.fontMono }}>60 fps · auto</span></Row>
          <Row label="Pause off-screen"><Toggle on /></Row>
          <Row label="Idle drop"><span style={{ fontSize: 11, color: WF.ink2 }}>after 5 min</span></Row>
        </Section>
      </div>
      <div style={{ padding: 12, borderTop: `1px solid ${WF.rule}`, display: 'flex', gap: 8 }}>
        <button className="wf-btn ghost" style={{ flex: 1 }}>Open full settings →</button>
        <button className="wf-btn">⋯</button>
      </div>
    </div>
  );
}

function PropField({ label, value }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', background: WF.bg, border: `1px solid ${WF.border}`, borderRadius: 5, padding: '0 8px' }}>
      <span style={{ fontSize: 10, color: WF.ink3, marginRight: 6, fontFamily: WF.fontMono }}>{label}</span>
      <span style={{ fontSize: 11, color: WF.ink, fontFamily: WF.fontMono, padding: '5px 0' }}>{value}</span>
    </div>
  );
}

function Slider({ value = 0.5, hint }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div style={{ flex: 1, height: 4, background: WF.rule, borderRadius: 2, position: 'relative' }}>
        <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${value * 100}%`, background: WF.accent, borderRadius: 2 }} />
        <div style={{ position: 'absolute', left: `${value * 100}%`, top: '50%', transform: 'translate(-50%,-50%)', width: 12, height: 12, background: WF.bg, border: `2px solid ${WF.accent}`, borderRadius: 999 }} />
      </div>
      {hint && <span style={{ fontSize: 10, color: WF.ink2, fontFamily: WF.fontMono, minWidth: 28, textAlign: 'right' }}>{hint}</span>}
    </div>
  );
}

function Toggle({ on }) {
  return (
    <div style={{ width: 28, height: 16, background: on ? WF.accent : WF.rule, borderRadius: 8, position: 'relative' }}>
      <div style={{ position: 'absolute', [on ? 'right' : 'left']: 1, top: 1, width: 14, height: 14, background: '#0a0a0a', borderRadius: 999 }} />
    </div>
  );
}

Object.assign(window, {
  HubFrame, GlassTile,
  HubLayoutA, HubLayoutB, HubLayoutC, HubLayoutD,
  HubEditMode, SelectionHandles, PropertiesPanel, PropField, Slider, Toggle,
});

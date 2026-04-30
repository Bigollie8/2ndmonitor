// ─────────────────────────────────────────────────────────────────
// EditMode — Figma-style overlay with toolbar, selection, props panel
// ProfileSwitcher — overlay w/ animated layout transitions
// Onboarding — first-launch wizard
// ─────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────
// EDIT MODE
// ─────────────────────────────────────────────────────────────────
function EditModeOverlay({ accent, accent2, onExit }) {
  const [tool, setTool] = React.useState('select');
  const [selected, setSelected] = React.useState('viz'); // viz | spotify | discord | calendar | notes | linear | sysmon | clock | upnext
  const [showGuides, setShowGuides] = React.useState(true);
  const [showGrid, setShowGrid] = React.useState(true);
  const [snap, setSnap] = React.useState(true);

  // Tile rectangles in the 2560x1440 canvas (approx, matching the live layout)
  // top: 56, bottom: 32, left: 20, right: 20, gap ~14
  const railX = 20, railY = 56 + 8, railW = 560;
  const gap = 14;
  const railH = 1440 - 56 - 32 - 16;
  const railRows = [1.4, 1, 0.7, 0.6, 0.6];
  const sumRows = railRows.reduce((a, b) => a + b, 0);
  const rowUnit = (railH - gap * (railRows.length - 1)) / sumRows;
  let yCursor = railY;
  const railRects = railRows.map((r) => {
    const h = r * rowUnit;
    const rect = { x: railX, y: yCursor, w: railW, h };
    yCursor += h + gap;
    return rect;
  });

  const rightX = railX + railW + gap;
  const rightW = 2560 - rightX - 20;
  const bottomH = 360;
  const vizRect = { x: rightX, y: railY, w: rightW, h: railH - bottomH - gap };
  const bottomY = vizRect.y + vizRect.h + gap;
  const bsCols = [1.6, 1, 1];
  const bsSum = bsCols.reduce((a, b) => a + b, 0);
  const bsUnit = (rightW - gap * 2) / bsSum;
  let xCursor = rightX;
  const bsRects = bsCols.map((c) => {
    const w = c * bsUnit;
    const rect = { x: xCursor, y: bottomY, w, h: bottomH };
    xCursor += w + gap;
    return rect;
  });

  const TILES = {
    discord:  { rect: railRects[0], label: 'Discord', kind: 'discord' },
    spotify:  { rect: railRects[1], label: 'Now playing', kind: 'spotify' },
    calendar: { rect: railRects[2], label: 'Today', kind: 'calendar' },
    notes:    { rect: railRects[3], label: 'Notes', kind: 'notes' },
    linear:   { rect: railRects[4], label: 'Linear', kind: 'web' },
    viz:      { rect: vizRect, label: 'Audio visualizer', kind: 'viz' },
    sysmon:   { rect: bsRects[0], label: 'System monitor', kind: 'sysmon' },
    clock:    { rect: bsRects[1], label: 'Clock & weather', kind: 'clock' },
    upnext:   { rect: bsRects[2], label: 'Up next', kind: 'upnext' },
  };

  const sel = TILES[selected];

  return (
    <div style={{
      position: 'absolute', inset: 0, zIndex: 50, pointerEvents: 'auto',
      background: 'rgba(8,9,12,0.55)', backdropFilter: 'blur(2px)',
    }}>
      {/* Edit toolbar - top */}
      <EditToolbar accent={accent} tool={tool} setTool={setTool}
        showGuides={showGuides} setShowGuides={setShowGuides}
        showGrid={showGrid} setShowGrid={setShowGrid}
        snap={snap} setSnap={setSnap}
        onExit={onExit} />

      {/* Left tool rail */}
      <EditLeftRail accent={accent} tool={tool} setTool={setTool} />

      {/* Grid overlay */}
      {showGrid && <GridOverlay />}

      {/* Click-through overlay tiles for selection */}
      {Object.entries(TILES).map(([id, t]) => (
        <div key={id} onClick={() => setSelected(id)} style={{
          position: 'absolute',
          left: t.rect.x, top: t.rect.y, width: t.rect.w, height: t.rect.h,
          cursor: 'pointer',
          border: id === selected ? `2px solid ${accent}` : '2px solid transparent',
          borderRadius: 14,
          boxShadow: id === selected ? `0 0 0 1px ${accent}55, 0 0 40px -8px ${accent}aa` : 'none',
          transition: 'border-color .12s, box-shadow .12s',
        }}>
          {id === selected && (
            <>
              <SelectionHandles accent={accent} />
              <SelectionLabel accent={accent} label={t.label} w={t.rect.w} h={t.rect.h} />
            </>
          )}
        </div>
      ))}

      {/* Smart guides on selected element */}
      {showGuides && sel && (
        <SmartGuides rect={sel.rect} accent={accent2} />
      )}

      {/* Properties panel - right */}
      <PropertiesPanel accent={accent} tile={sel} selectedId={selected} />

      {/* Layers panel - left bottom */}
      <LayersPanel accent={accent} selected={selected} setSelected={setSelected} tiles={TILES} />
    </div>
  );
}

function EditToolbar({ accent, tool, setTool, showGuides, setShowGuides, showGrid, setShowGrid, snap, setSnap, onExit }) {
  return (
    <div style={{
      position: 'absolute', top: 16, left: '50%', transform: 'translateX(-50%)',
      display: 'flex', alignItems: 'center', gap: 4,
      padding: '6px 8px', borderRadius: 10,
      background: 'rgba(20,22,28,0.95)', backdropFilter: 'blur(20px)',
      border: '1px solid rgba(255,255,255,0.08)',
      boxShadow: '0 12px 40px rgba(0,0,0,0.5)',
      zIndex: 60,
    }}>
      <ToolBtn icon="↖" label="Select" active={tool==='select'} onClick={() => setTool('select')} accent={accent} />
      <ToolBtn icon="✥" label="Move" active={tool==='move'} onClick={() => setTool('move')} accent={accent} />
      <ToolBtn icon="◰" label="Resize" active={tool==='resize'} onClick={() => setTool('resize')} accent={accent} />
      <ToolBtn icon="+" label="Add tile" active={tool==='add'} onClick={() => setTool('add')} accent={accent} />
      <Divider />
      <ToolToggle label="Snap" active={snap} onClick={() => setSnap(!snap)} accent={accent} />
      <ToolToggle label="Grid" active={showGrid} onClick={() => setShowGrid(!showGrid)} accent={accent} />
      <ToolToggle label="Guides" active={showGuides} onClick={() => setShowGuides(!showGuides)} accent={accent} />
      <Divider />
      <span style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.45)', fontFamily: 'JetBrains Mono, ui-monospace, monospace', padding: '0 8px' }}>
        Editing · "Work"
      </span>
      <Divider />
      <button onClick={onExit} style={{
        padding: '6px 12px', fontSize: 11, fontWeight: 600, borderRadius: 6,
        background: accent, color: '#000', border: 'none', cursor: 'pointer',
      }}>Done</button>
    </div>
  );
}

function ToolBtn({ icon, label, active, onClick, accent }) {
  return (
    <button onClick={onClick} title={label} style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      width: 32, height: 32, borderRadius: 6, fontSize: 14,
      background: active ? `${accent}20` : 'transparent',
      color: active ? accent : 'rgba(255,255,255,0.65)',
      border: active ? `1px solid ${accent}55` : '1px solid transparent',
      cursor: 'pointer',
    }}>{icon}</button>
  );
}

function ToolToggle({ label, active, onClick, accent }) {
  return (
    <button onClick={onClick} style={{
      padding: '6px 10px', fontSize: 10.5, fontWeight: 500, borderRadius: 6,
      background: active ? `${accent}20` : 'transparent',
      color: active ? accent : 'rgba(255,255,255,0.5)',
      border: active ? `1px solid ${accent}55` : '1px solid rgba(255,255,255,0.06)',
      cursor: 'pointer',
      letterSpacing: '.02em',
    }}>{label}</button>
  );
}

function Divider() {
  return <div style={{ width: 1, height: 20, background: 'rgba(255,255,255,0.08)', margin: '0 4px' }} />;
}

function EditLeftRail({ accent, tool, setTool }) {
  const tools = [
    { id: 'select', icon: '↖', label: 'V' },
    { id: 'move', icon: '✥', label: 'M' },
    { id: 'resize', icon: '◰', label: 'R' },
    { id: 'add', icon: '+', label: 'A' },
    { id: 'comment', icon: '◐', label: 'C' },
  ];
  return (
    <div style={{
      position: 'absolute', top: '50%', left: 16, transform: 'translateY(-50%)',
      display: 'flex', flexDirection: 'column', gap: 6,
      padding: 8, borderRadius: 10,
      background: 'rgba(20,22,28,0.95)', backdropFilter: 'blur(20px)',
      border: '1px solid rgba(255,255,255,0.08)',
      boxShadow: '0 12px 40px rgba(0,0,0,0.5)',
      zIndex: 55,
    }}>
      {tools.map(t => (
        <button key={t.id} onClick={() => setTool(t.id)} title={t.id} style={{
          width: 36, height: 36, borderRadius: 6, fontSize: 16,
          background: tool === t.id ? `${accent}20` : 'transparent',
          color: tool === t.id ? accent : 'rgba(255,255,255,0.65)',
          border: tool === t.id ? `1px solid ${accent}55` : '1px solid transparent',
          cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexDirection: 'column', gap: 0,
        }}>
          <span style={{ lineHeight: 1 }}>{t.icon}</span>
          <span style={{ fontSize: 8, color: 'rgba(255,255,255,0.4)', fontFamily: 'JetBrains Mono, ui-monospace, monospace' }}>{t.label}</span>
        </button>
      ))}
    </div>
  );
}

function GridOverlay() {
  return (
    <div style={{
      position: 'absolute', inset: 0,
      backgroundImage: `
        linear-gradient(rgba(255,255,255,0.04) 1px, transparent 1px),
        linear-gradient(90deg, rgba(255,255,255,0.04) 1px, transparent 1px)
      `,
      backgroundSize: '40px 40px',
      pointerEvents: 'none',
      zIndex: 45,
    }} />
  );
}

function SelectionHandles({ accent }) {
  const handle = (style) => (
    <div style={{
      position: 'absolute', width: 10, height: 10,
      background: '#06070a', border: `2px solid ${accent}`,
      borderRadius: 2, ...style,
    }} />
  );
  return (
    <>
      {handle({ top: -6, left: -6, cursor: 'nwse-resize' })}
      {handle({ top: -6, right: -6, cursor: 'nesw-resize' })}
      {handle({ bottom: -6, left: -6, cursor: 'nesw-resize' })}
      {handle({ bottom: -6, right: -6, cursor: 'nwse-resize' })}
      {handle({ top: -6, left: '50%', transform: 'translateX(-50%)', cursor: 'ns-resize' })}
      {handle({ bottom: -6, left: '50%', transform: 'translateX(-50%)', cursor: 'ns-resize' })}
      {handle({ left: -6, top: '50%', transform: 'translateY(-50%)', cursor: 'ew-resize' })}
      {handle({ right: -6, top: '50%', transform: 'translateY(-50%)', cursor: 'ew-resize' })}
    </>
  );
}

function SelectionLabel({ accent, label, w, h }) {
  return (
    <div style={{
      position: 'absolute', top: -28, left: 0,
      padding: '3px 10px', fontSize: 11, fontWeight: 600,
      background: accent, color: '#000', borderRadius: 4,
      fontFamily: 'JetBrains Mono, ui-monospace, monospace',
      whiteSpace: 'nowrap',
    }}>
      {label} · {Math.round(w)}×{Math.round(h)}
    </div>
  );
}

function SmartGuides({ rect, accent }) {
  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h / 2;
  const lineStyle = {
    position: 'absolute', background: accent, pointerEvents: 'none',
    boxShadow: `0 0 6px ${accent}`, zIndex: 44,
  };
  return (
    <>
      {/* Vertical center guide */}
      <div style={{ ...lineStyle, left: cx - 0.5, top: 0, width: 1, height: '100%', opacity: 0.5 }} />
      {/* Horizontal center guide */}
      <div style={{ ...lineStyle, top: cy - 0.5, left: 0, width: '100%', height: 1, opacity: 0.5 }} />
      {/* Distance markers - top */}
      <DistanceMarker x={rect.x} y={0} w={0} h={rect.y} accent={accent} value={rect.y} orient="vertical" />
      {/* Distance markers - bottom */}
      <DistanceMarker x={rect.x} y={rect.y + rect.h} w={0} h={1440 - rect.y - rect.h} accent={accent} value={1440 - rect.y - rect.h} orient="vertical" />
      {/* Distance markers - left */}
      <DistanceMarker x={0} y={rect.y} w={rect.x} h={0} accent={accent} value={rect.x} orient="horizontal" />
      {/* Distance markers - right */}
      <DistanceMarker x={rect.x + rect.w} y={rect.y} w={2560 - rect.x - rect.w} h={0} accent={accent} value={2560 - rect.x - rect.w} orient="horizontal" />
    </>
  );
}

function DistanceMarker({ x, y, w, h, accent, value, orient }) {
  const labelStyle = {
    position: 'absolute', padding: '2px 6px',
    background: accent, color: '#000', fontSize: 10, fontWeight: 600,
    borderRadius: 3, fontFamily: 'JetBrains Mono, ui-monospace, monospace',
    pointerEvents: 'none', zIndex: 46,
  };
  if (orient === 'vertical') {
    return (
      <>
        <div style={{ position: 'absolute', left: x + 20, top: y, width: 1, height: h, background: accent, opacity: 0.6, zIndex: 44 }} />
        <div style={{ ...labelStyle, left: x + 28, top: y + h/2 - 9 }}>{Math.round(value)}</div>
      </>
    );
  }
  return (
    <>
      <div style={{ position: 'absolute', left: x, top: y + 20, height: 1, width: w, background: accent, opacity: 0.6, zIndex: 44 }} />
      <div style={{ ...labelStyle, left: x + w/2 - 16, top: y + 28 }}>{Math.round(value)}</div>
    </>
  );
}

function PropertiesPanel({ accent, tile, selectedId }) {
  if (!tile) return null;
  return (
    <div style={{
      position: 'absolute', top: 80, right: 16, width: 280,
      maxHeight: 'calc(100% - 100px)',
      borderRadius: 10, padding: 0,
      background: 'rgba(20,22,28,0.96)', backdropFilter: 'blur(20px)',
      border: '1px solid rgba(255,255,255,0.08)',
      boxShadow: '0 12px 40px rgba(0,0,0,0.5)',
      zIndex: 55, overflow: 'hidden', display: 'flex', flexDirection: 'column',
    }}>
      <div style={{ padding: '10px 14px', borderBottom: '1px solid rgba(255,255,255,0.06)', display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ width: 8, height: 8, background: accent, borderRadius: 2 }} />
        <span style={{ fontSize: 12, fontWeight: 600, color: '#fff' }}>{tile.label}</span>
        <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', fontFamily: 'JetBrains Mono, ui-monospace, monospace', marginLeft: 'auto' }}>#{selectedId}</span>
      </div>

      <div style={{ overflow: 'auto', padding: '4px 0' }}>
        <PropSection title="Position & size">
          <PropRow label="X"><PropNum v={Math.round(tile.rect.x)} /></PropRow>
          <PropRow label="Y"><PropNum v={Math.round(tile.rect.y)} /></PropRow>
          <PropRow label="W"><PropNum v={Math.round(tile.rect.w)} /></PropRow>
          <PropRow label="H"><PropNum v={Math.round(tile.rect.h)} /></PropRow>
          <PropRow label="Lock"><Toggle on={false} accent={accent} /></PropRow>
        </PropSection>

        <PropSection title="Appearance">
          <PropRow label="Radius"><PropNum v={14} /></PropRow>
          <PropRow label="Padding"><PropNum v={12} /></PropRow>
          <PropRow label="Opacity">
            <div style={{ flex: 1, display: 'flex', gap: 6, alignItems: 'center' }}>
              <input type="range" min="0" max="100" defaultValue="100" style={{ flex: 1, accentColor: accent }} />
              <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.6)', fontFamily: 'JetBrains Mono, ui-monospace, monospace', width: 28, textAlign: 'right' }}>100</span>
            </div>
          </PropRow>
          <PropRow label="Glass"><Toggle on={true} accent={accent} /></PropRow>
        </PropSection>

        {tile.kind === 'viz' && (
          <PropSection title="Visualizer">
            <PropRow label="Mode">
              <span style={{ fontSize: 10.5, color: '#fff', padding: '2px 8px', background: accent + '20', borderRadius: 4 }}>Ambient</span>
            </PropRow>
            <PropRow label="Source">
              <span style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.7)' }}>WASAPI loopback</span>
            </PropRow>
            <PropRow label="Reactivity">
              <input type="range" min="0" max="100" defaultValue="68" style={{ flex: 1, accentColor: accent }} />
            </PropRow>
            <PropRow label="Theme link"><Toggle on={true} accent={accent} /></PropRow>
            <button style={{
              width: '100%', padding: '8px', marginTop: 8, fontSize: 11, fontWeight: 600,
              background: 'transparent', color: accent, border: `1px solid ${accent}55`,
              borderRadius: 6, cursor: 'pointer',
            }}>Open viz config →</button>
          </PropSection>
        )}

        {tile.kind === 'spotify' && (
          <PropSection title="Tile · Spotify">
            <PropRow label="Account"><span style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.7)' }}>nick@hub</span></PropRow>
            <PropRow label="Show controls"><Toggle on={true} accent={accent} /></PropRow>
            <PropRow label="Show up next"><Toggle on={true} accent={accent} /></PropRow>
            <PropRow label="Theme accent"><Toggle on={true} accent={accent} /></PropRow>
          </PropSection>
        )}

        {tile.kind === 'discord' && (
          <PropSection title="Tile · Discord">
            <PropRow label="Workspace"><span style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.7)' }}>second-monitor</span></PropRow>
            <PropRow label="Channels"><span style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.7)' }}>3 pinned</span></PropRow>
            <PropRow label="Notifications"><Toggle on={true} accent={accent} /></PropRow>
          </PropSection>
        )}

        {tile.kind === 'web' && (
          <PropSection title="Tile · Web">
            <PropRow label="URL">
              <input defaultValue="linear.app/inbox" style={{
                flex: 1, fontSize: 10.5, padding: '4px 6px', borderRadius: 4,
                background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
                color: '#fff', fontFamily: 'JetBrains Mono, ui-monospace, monospace',
              }} />
            </PropRow>
            <PropRow label="Auto-refresh"><Toggle on={true} accent={accent} /></PropRow>
            <PropRow label="Interval">
              <span style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.7)' }}>60s</span>
            </PropRow>
          </PropSection>
        )}

        <PropSection title="Layout grid">
          <PropRow label="Span row">
            <Stepper v={1} accent={accent} />
          </PropRow>
          <PropRow label="Span col">
            <Stepper v={1} accent={accent} />
          </PropRow>
          <PropRow label="Snap"><Toggle on={true} accent={accent} /></PropRow>
        </PropSection>
      </div>

      <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', padding: 8, display: 'flex', gap: 6 }}>
        <button style={{
          flex: 1, padding: '7px', fontSize: 10.5, fontWeight: 600,
          background: 'rgba(255,255,255,0.04)', color: 'rgba(255,255,255,0.7)',
          border: '1px solid rgba(255,255,255,0.08)', borderRadius: 5, cursor: 'pointer',
        }}>Duplicate</button>
        <button style={{
          flex: 1, padding: '7px', fontSize: 10.5, fontWeight: 600,
          background: 'rgba(239,68,68,0.1)', color: '#fca5a5',
          border: '1px solid rgba(239,68,68,0.2)', borderRadius: 5, cursor: 'pointer',
        }}>Remove</button>
      </div>
    </div>
  );
}

function PropSection({ title, children }) {
  return (
    <div style={{ padding: '8px 14px', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
      <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 8, fontWeight: 600 }}>{title}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>{children}</div>
    </div>
  );
}

function PropRow({ label, children }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={{ width: 70, fontSize: 10.5, color: 'rgba(255,255,255,0.45)' }}>{label}</span>
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 6 }}>{children}</div>
    </div>
  );
}

function PropNum({ v }) {
  return (
    <input defaultValue={v} style={{
      flex: 1, fontSize: 11, padding: '4px 6px', borderRadius: 4,
      background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
      color: '#fff', fontFamily: 'JetBrains Mono, ui-monospace, monospace',
      width: '100%',
    }} />
  );
}

function Toggle({ on, accent }) {
  const [checked, setChecked] = React.useState(on);
  return (
    <button onClick={() => setChecked(!checked)} style={{
      width: 28, height: 16, borderRadius: 8,
      background: checked ? accent : 'rgba(255,255,255,0.1)',
      border: 'none', position: 'relative', cursor: 'pointer',
      transition: 'background .15s',
    }}>
      <div style={{
        position: 'absolute', top: 2, left: checked ? 14 : 2,
        width: 12, height: 12, borderRadius: 6, background: '#fff',
        transition: 'left .15s',
      }} />
    </button>
  );
}

function Stepper({ v, accent }) {
  const [val, setVal] = React.useState(v);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, flex: 1 }}>
      <button onClick={() => setVal(Math.max(1, val - 1))} style={{ width: 22, height: 22, borderRadius: 4, border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.04)', color: '#fff', cursor: 'pointer' }}>−</button>
      <span style={{ flex: 1, textAlign: 'center', fontSize: 11, fontFamily: 'JetBrains Mono, ui-monospace, monospace' }}>{val}</span>
      <button onClick={() => setVal(val + 1)} style={{ width: 22, height: 22, borderRadius: 4, border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.04)', color: '#fff', cursor: 'pointer' }}>+</button>
    </div>
  );
}

function LayersPanel({ accent, selected, setSelected, tiles }) {
  const order = ['viz', 'spotify', 'discord', 'calendar', 'notes', 'linear', 'sysmon', 'clock', 'upnext'];
  return (
    <div style={{
      position: 'absolute', bottom: 16, left: 16, width: 240,
      borderRadius: 10, overflow: 'hidden',
      background: 'rgba(20,22,28,0.96)', backdropFilter: 'blur(20px)',
      border: '1px solid rgba(255,255,255,0.08)',
      boxShadow: '0 12px 40px rgba(0,0,0,0.5)',
      zIndex: 55,
    }}>
      <div style={{ padding: '10px 14px', borderBottom: '1px solid rgba(255,255,255,0.06)', display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: '#fff' }}>Layers</span>
        <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.4)', fontFamily: 'JetBrains Mono, ui-monospace, monospace', marginLeft: 'auto' }}>{order.length} tiles</span>
      </div>
      <div style={{ padding: 6 }}>
        {order.map(id => {
          const t = tiles[id];
          return (
            <button key={id} onClick={() => setSelected(id)} style={{
              width: '100%', display: 'flex', alignItems: 'center', gap: 8,
              padding: '6px 8px', borderRadius: 5, border: 'none', cursor: 'pointer',
              background: selected === id ? `${accent}25` : 'transparent',
              color: selected === id ? '#fff' : 'rgba(255,255,255,0.7)',
              textAlign: 'left',
            }}>
              <span style={{ fontSize: 11 }}>{kindIcon(t.kind)}</span>
              <span style={{ fontSize: 11, flex: 1 }}>{t.label}</span>
              <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.3)', fontFamily: 'JetBrains Mono, ui-monospace, monospace' }}>
                {Math.round(t.rect.w)}×{Math.round(t.rect.h)}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function kindIcon(k) {
  return ({ viz: '◢', spotify: '♪', discord: '◇', calendar: '◫', notes: '✎', web: '◰', sysmon: '▤', clock: '◐', upnext: '▸' })[k] || '◰';
}

// ─────────────────────────────────────────────────────────────────
// PROFILE SWITCHER
// ─────────────────────────────────────────────────────────────────
function ProfileSwitcher({ accent, currentProfile, setProfile, onClose, onCreate }) {
  const PROFILES = [
    { id: 'work',   name: 'Work',   subtitle: 'Focus · sysmon · calendar', layout: 'work',   tileCount: 8 },
    { id: 'gaming', name: 'Gaming', subtitle: 'Viz hero · sysmon · discord', layout: 'gaming', tileCount: 6 },
    { id: 'chill',  name: 'Chill',  subtitle: 'Ambient · spotify · clock', layout: 'chill',  tileCount: 5 },
  ];

  return (
    <div onClick={onClose} style={{
      position: 'absolute', inset: 0, zIndex: 80,
      background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(12px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        width: 1600, padding: 48, borderRadius: 18,
        background: 'rgba(15,17,22,0.95)',
        border: '1px solid rgba(255,255,255,0.08)',
        boxShadow: '0 40px 100px rgba(0,0,0,0.6)',
      }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 16, marginBottom: 8 }}>
          <h2 style={{ fontSize: 28, margin: 0, fontWeight: 700, letterSpacing: '-0.02em' }}>Switch profile</h2>
          <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', fontFamily: 'JetBrains Mono, ui-monospace, monospace' }}>⌘ + 1 / 2 / 3</span>
        </div>
        <p style={{ fontSize: 14, color: 'rgba(255,255,255,0.55)', margin: '0 0 32px 0' }}>
          Each profile is a layout of tiles tuned for a context. Hub crossfades between them with shared-element transitions.
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 20 }}>
          {PROFILES.map(p => (
            <ProfileCard key={p.id} profile={p} accent={accent} active={p.id === currentProfile} onClick={() => { setProfile(p.id); onClose(); }} />
          ))}
        </div>

        <div style={{ marginTop: 24, display: 'flex', gap: 12, alignItems: 'center' }}>
          <button onClick={onCreate} style={{
            padding: '12px 18px', fontSize: 13, fontWeight: 600,
            background: 'transparent', color: 'rgba(255,255,255,0.7)',
            border: '1px dashed rgba(255,255,255,0.15)', borderRadius: 8,
            cursor: 'pointer',
          }}>+ New profile from current</button>
          <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', flex: 1 }}>
            Profiles auto-switch on app focus rules — e.g. Gaming when fullscreen game launches.
          </span>
          <button onClick={onClose} style={{
            padding: '10px 16px', fontSize: 12, color: 'rgba(255,255,255,0.5)',
            background: 'transparent', border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: 6, cursor: 'pointer',
          }}>Esc</button>
        </div>
      </div>
    </div>
  );
}

function ProfileCard({ profile, accent, active, onClick }) {
  return (
    <button onClick={onClick} style={{
      padding: 0, borderRadius: 12, overflow: 'hidden',
      background: active ? `${accent}10` : 'rgba(255,255,255,0.02)',
      border: active ? `2px solid ${accent}` : '2px solid rgba(255,255,255,0.06)',
      cursor: 'pointer', textAlign: 'left',
      transition: 'transform .15s, border-color .15s',
      transform: active ? 'translateY(-2px)' : 'none',
      boxShadow: active ? `0 12px 40px -8px ${accent}66` : 'none',
    }}>
      <ProfilePreview layout={profile.layout} accent={accent} />
      <div style={{ padding: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <span style={{ fontSize: 16, fontWeight: 700 }}>{profile.name}</span>
          {active && <span style={{ fontSize: 9, color: accent, padding: '2px 8px', background: `${accent}20`, borderRadius: 3, fontFamily: 'JetBrains Mono, ui-monospace, monospace', letterSpacing: '.05em' }}>● ACTIVE</span>}
        </div>
        <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.55)', marginBottom: 8 }}>{profile.subtitle}</div>
        <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)', fontFamily: 'JetBrains Mono, ui-monospace, monospace' }}>
          {profile.tileCount} tiles
        </div>
      </div>
    </button>
  );
}

function ProfilePreview({ layout, accent }) {
  // Mini-previews of each profile's layout
  const w = 480, h = 270;
  const stroke = 'rgba(255,255,255,0.06)';
  const fill = 'rgba(255,255,255,0.03)';
  const vizFill = `${accent}40`;
  const vizStroke = `${accent}88`;

  if (layout === 'work') {
    return (
      <svg viewBox={`0 0 ${w} ${h}`} style={{ width: '100%', display: 'block', background: '#06070a' }}>
        {/* Top chrome */}
        <rect x="0" y="0" width={w} height="14" fill="rgba(255,255,255,0.04)" />
        {/* Left rail */}
        <rect x="8" y="20" width="100" height="50" fill={fill} stroke={stroke} rx="3" />
        <rect x="8" y="74" width="100" height="40" fill={fill} stroke={stroke} rx="3" />
        <rect x="8" y="118" width="100" height="30" fill={fill} stroke={stroke} rx="3" />
        <rect x="8" y="152" width="100" height="30" fill={fill} stroke={stroke} rx="3" />
        <rect x="8" y="186" width="100" height="30" fill={fill} stroke={stroke} rx="3" />
        {/* Viz hero */}
        <rect x="112" y="20" width={w - 120} height="160" fill={vizFill} stroke={vizStroke} rx="3" />
        {/* Bottom strip */}
        <rect x="112" y="184" width="180" height="36" fill={fill} stroke={stroke} rx="3" />
        <rect x="296" y="184" width="80" height="36" fill={fill} stroke={stroke} rx="3" />
        <rect x="380" y="184" width={w - 388} height="36" fill={fill} stroke={stroke} rx="3" />
        {/* Bottom bar */}
        <rect x="0" y={h - 8} width={w} height="8" fill="rgba(255,255,255,0.04)" />
      </svg>
    );
  }
  if (layout === 'gaming') {
    return (
      <svg viewBox={`0 0 ${w} ${h}`} style={{ width: '100%', display: 'block', background: '#06070a' }}>
        <rect x="0" y="0" width={w} height="14" fill="rgba(255,255,255,0.04)" />
        {/* Massive viz */}
        <rect x="8" y="20" width={w - 16} height="160" fill={vizFill} stroke={vizStroke} rx="3" />
        {/* Sysmon strip */}
        <rect x="8" y="184" width={w - 16} height="36" fill={fill} stroke={stroke} rx="3" />
        <line x1={(w/3)} y1="190" x2={(w/3)} y2="214" stroke={stroke} />
        <line x1={(2*w/3)} y1="190" x2={(2*w/3)} y2="214" stroke={stroke} />
        <rect x="0" y={h - 8} width={w} height="8" fill="rgba(255,255,255,0.04)" />
      </svg>
    );
  }
  // chill
  return (
    <svg viewBox={`0 0 ${w} ${h}`} style={{ width: '100%', display: 'block', background: '#06070a' }}>
      <rect x="0" y="0" width={w} height="14" fill="rgba(255,255,255,0.04)" />
      {/* Fullscreen ambient viz */}
      <rect x="0" y="14" width={w} height={h - 22} fill={vizFill} stroke="none" />
      {/* Glass overlays */}
      <rect x="20" y="40" width="180" height="80" fill="rgba(8,9,12,0.6)" stroke={vizStroke} rx="6" />
      <rect x="20" y={h - 100} width="180" height="60" fill="rgba(8,9,12,0.6)" stroke={vizStroke} rx="6" />
      <rect x={w - 200} y="40" width="180" height="60" fill="rgba(8,9,12,0.6)" stroke={vizStroke} rx="6" />
      <rect x="0" y={h - 8} width={w} height="8" fill="rgba(255,255,255,0.04)" />
    </svg>
  );
}

// ─────────────────────────────────────────────────────────────────
// ONBOARDING
// ─────────────────────────────────────────────────────────────────
function Onboarding({ accent, onFinish }) {
  const [step, setStep] = React.useState(0);
  const [audio, setAudio] = React.useState('wasapi');
  const [profile, setProfile] = React.useState(null);
  const [tiles, setTiles] = React.useState({ spotify: true, discord: true, calendar: true, sysmon: true, notes: false, weather: true });
  const STEPS = ['Welcome', 'Audio source', 'Pick a profile', 'Connect tiles', 'Ready'];

  return (
    <div style={{
      position: 'absolute', inset: 0, zIndex: 90,
      background: '#06070a',
      display: 'flex', flexDirection: 'column',
    }}>
      {/* Ambient backdrop */}
      <div style={{
        position: 'absolute', inset: 0,
        background: `radial-gradient(ellipse at 30% 20%, ${accent}25 0%, transparent 50%), radial-gradient(ellipse at 70% 80%, ${accent}15 0%, transparent 50%)`,
        opacity: 0.7,
      }} />
      <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(ellipse at 50% 50%, transparent 30%, rgba(0,0,0,0.5) 100%)' }} />

      {/* Top progress */}
      <div style={{
        position: 'relative', zIndex: 2, padding: '32px 48px',
        display: 'flex', alignItems: 'center', gap: 16,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 28, height: 28, borderRadius: 8, background: `linear-gradient(135deg, ${accent}, ${accent}aa)`, boxShadow: `0 0 20px ${accent}66` }} />
          <span style={{ fontSize: 16, fontWeight: 700 }}>Hub</span>
        </div>
        <div style={{ flex: 1 }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {STEPS.map((s, i) => (
            <React.Fragment key={s}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{
                  width: 22, height: 22, borderRadius: 11,
                  background: i < step ? accent : (i === step ? 'transparent' : 'transparent'),
                  border: i === step ? `2px solid ${accent}` : (i < step ? 'none' : '2px solid rgba(255,255,255,0.15)'),
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 10, fontWeight: 700, color: i < step ? '#000' : (i === step ? accent : 'rgba(255,255,255,0.3)'),
                }}>{i < step ? '✓' : i + 1}</div>
                <span style={{ fontSize: 12, color: i <= step ? '#fff' : 'rgba(255,255,255,0.3)', fontWeight: i === step ? 600 : 400 }}>{s}</span>
              </div>
              {i < STEPS.length - 1 && <div style={{ width: 24, height: 1, background: i < step ? accent : 'rgba(255,255,255,0.1)' }} />}
            </React.Fragment>
          ))}
        </div>
        <div style={{ flex: 1 }} />
        <button onClick={onFinish} style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', background: 'transparent', border: 'none', cursor: 'pointer' }}>Skip setup</button>
      </div>

      {/* Body */}
      <div style={{ flex: 1, position: 'relative', zIndex: 2, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 40 }}>
        {step === 0 && <OnbWelcome accent={accent} />}
        {step === 1 && <OnbAudio accent={accent} value={audio} setValue={setAudio} />}
        {step === 2 && <OnbProfile accent={accent} value={profile} setValue={setProfile} />}
        {step === 3 && <OnbTiles accent={accent} tiles={tiles} setTiles={setTiles} />}
        {step === 4 && <OnbReady accent={accent} profile={profile} audio={audio} tiles={tiles} />}
      </div>

      {/* Footer */}
      <div style={{
        position: 'relative', zIndex: 2, padding: '24px 48px',
        display: 'flex', alignItems: 'center', gap: 12,
        borderTop: '1px solid rgba(255,255,255,0.04)',
      }}>
        <button onClick={() => step > 0 && setStep(step - 1)} disabled={step === 0} style={{
          padding: '10px 18px', fontSize: 13, fontWeight: 500,
          background: 'transparent', color: step === 0 ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.7)',
          border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8,
          cursor: step === 0 ? 'default' : 'pointer',
        }}>← Back</button>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', fontFamily: 'JetBrains Mono, ui-monospace, monospace' }}>
          Step {step + 1} of {STEPS.length}
        </span>
        <div style={{ flex: 1 }} />
        {step < STEPS.length - 1 ? (
          <button onClick={() => setStep(step + 1)} style={{
            padding: '10px 22px', fontSize: 13, fontWeight: 600,
            background: accent, color: '#000', border: 'none', borderRadius: 8,
            cursor: 'pointer', boxShadow: `0 8px 24px -6px ${accent}aa`,
          }}>Continue →</button>
        ) : (
          <button onClick={onFinish} style={{
            padding: '10px 22px', fontSize: 13, fontWeight: 600,
            background: accent, color: '#000', border: 'none', borderRadius: 8,
            cursor: 'pointer', boxShadow: `0 8px 24px -6px ${accent}aa`,
          }}>Launch Hub →</button>
        )}
      </div>
    </div>
  );
}

function OnbWelcome({ accent }) {
  return (
    <div style={{ maxWidth: 720, textAlign: 'center' }}>
      <div style={{
        width: 96, height: 96, margin: '0 auto 32px', borderRadius: 24,
        background: `linear-gradient(135deg, ${accent}, ${accent}66)`,
        boxShadow: `0 20px 80px -10px ${accent}88`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <span style={{ fontSize: 48, color: '#000', fontWeight: 800 }}>◢</span>
      </div>
      <h1 style={{ fontSize: 56, fontWeight: 800, margin: '0 0 16px 0', letterSpacing: '-0.03em', textWrap: 'balance' }}>
        Your second monitor, finally with a job.
      </h1>
      <p style={{ fontSize: 18, color: 'rgba(255,255,255,0.6)', lineHeight: 1.5, margin: '0 0 40px 0', textWrap: 'pretty' }}>
        Hub turns spare screens into a glanceable cockpit. Audio reactive visualizers, system monitor, your apps as tiles —
        all themed to whatever's playing.
      </p>
      <div style={{ display: 'flex', gap: 24, justifyContent: 'center', marginTop: 48 }}>
        {[
          { i: '◢', label: 'Audio reactive' },
          { i: '▤', label: 'System monitor' },
          { i: '⊞', label: 'App tiles' },
          { i: '◐', label: 'Theme-linked' },
        ].map(f => (
          <div key={f.label} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
            <div style={{ width: 48, height: 48, borderRadius: 10, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, color: accent }}>{f.i}</div>
            <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)' }}>{f.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function OnbAudio({ accent, value, setValue }) {
  const SOURCES = [
    { id: 'wasapi', name: 'System loopback', subtitle: 'Capture everything on this PC (recommended)', sub2: 'WASAPI · zero config', icon: '◢' },
    { id: 'spotify', name: 'Spotify', subtitle: 'Direct from Spotify with track metadata', sub2: 'Connects to your account', icon: '♪' },
    { id: 'mic', name: 'Microphone', subtitle: 'Vocal-driven viz for streaming or DJ sets', sub2: 'Default input device', icon: '◓' },
    { id: 'cable', name: 'Virtual cable', subtitle: 'Route any specific app or hardware', sub2: 'Advanced · VB-Audio', icon: '⌥' },
  ];
  return (
    <div style={{ maxWidth: 880, width: '100%' }}>
      <h1 style={{ fontSize: 40, fontWeight: 700, margin: '0 0 8px 0', letterSpacing: '-0.02em', textAlign: 'center' }}>Where's the audio coming from?</h1>
      <p style={{ fontSize: 15, color: 'rgba(255,255,255,0.5)', margin: '0 0 36px 0', textAlign: 'center' }}>The visualizer needs an audio stream. You can change this anytime.</p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 14 }}>
        {SOURCES.map(s => (
          <button key={s.id} onClick={() => setValue(s.id)} style={{
            display: 'flex', alignItems: 'flex-start', gap: 16, padding: 20, borderRadius: 12,
            background: value === s.id ? `${accent}10` : 'rgba(255,255,255,0.02)',
            border: value === s.id ? `2px solid ${accent}` : '2px solid rgba(255,255,255,0.06)',
            color: '#fff', textAlign: 'left', cursor: 'pointer',
            transition: 'all .15s',
          }}>
            <div style={{ width: 44, height: 44, borderRadius: 10, background: value === s.id ? accent : 'rgba(255,255,255,0.04)', color: value === s.id ? '#000' : accent, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, flexShrink: 0 }}>{s.icon}</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>{s.name}</div>
              <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.6)', marginBottom: 6, lineHeight: 1.4 }}>{s.subtitle}</div>
              <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)', fontFamily: 'JetBrains Mono, ui-monospace, monospace', textTransform: 'uppercase', letterSpacing: '.06em' }}>{s.sub2}</div>
            </div>
            {value === s.id && <span style={{ fontSize: 14, color: accent }}>●</span>}
          </button>
        ))}
      </div>
      <div style={{
        marginTop: 24, padding: 14, borderRadius: 8,
        background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)',
        display: 'flex', alignItems: 'center', gap: 12,
      }}>
        <div style={{ width: 32, height: 32, borderRadius: 6, background: `${accent}15`, color: accent, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14 }}>◢</div>
        <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.6)' }}>Live audio level — </span>
        <div style={{ flex: 1, display: 'flex', gap: 2, height: 16, alignItems: 'flex-end' }}>
          {Array.from({ length: 40 }).map((_, i) => (
            <div key={i} style={{
              flex: 1, height: `${30 + Math.sin(i * 0.5) * 30 + Math.random() * 30}%`,
              background: accent, opacity: 0.3 + Math.random() * 0.5, borderRadius: 1,
            }} />
          ))}
        </div>
        <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', fontFamily: 'JetBrains Mono, ui-monospace, monospace' }}>−12 dB</span>
      </div>
    </div>
  );
}

function OnbProfile({ accent, value, setValue }) {
  const PROFILES = [
    { id: 'work', name: 'Work', subtitle: 'Calendar, sysmon, notes — focus mode', layout: 'work' },
    { id: 'gaming', name: 'Gaming', subtitle: 'Big viz hero with sysmon strip', layout: 'gaming' },
    { id: 'chill', name: 'Chill', subtitle: 'Fullscreen ambient with glass overlays', layout: 'chill' },
  ];
  return (
    <div style={{ maxWidth: 1200, width: '100%' }}>
      <h1 style={{ fontSize: 40, fontWeight: 700, margin: '0 0 8px 0', letterSpacing: '-0.02em', textAlign: 'center' }}>Pick a starter layout</h1>
      <p style={{ fontSize: 15, color: 'rgba(255,255,255,0.5)', margin: '0 0 36px 0', textAlign: 'center' }}>You can have multiple profiles and switch with ⌘1/2/3. Customize anytime.</p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 18 }}>
        {PROFILES.map(p => (
          <button key={p.id} onClick={() => setValue(p.id)} style={{
            padding: 0, borderRadius: 12, overflow: 'hidden', textAlign: 'left',
            background: value === p.id ? `${accent}10` : 'rgba(255,255,255,0.02)',
            border: value === p.id ? `2px solid ${accent}` : '2px solid rgba(255,255,255,0.06)',
            cursor: 'pointer', color: '#fff',
            transform: value === p.id ? 'translateY(-2px)' : 'none',
            transition: 'all .15s',
            boxShadow: value === p.id ? `0 12px 40px -8px ${accent}88` : 'none',
          }}>
            <ProfilePreview layout={p.layout} accent={accent} />
            <div style={{ padding: 18 }}>
              <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 4 }}>{p.name}</div>
              <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.55)' }}>{p.subtitle}</div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

function OnbTiles({ accent, tiles, setTiles }) {
  const AVAILABLE = [
    { id: 'spotify', name: 'Spotify', desc: 'Now playing + remote', icon: '♪', type: 'integration' },
    { id: 'discord', name: 'Discord', desc: 'Channels + voice', icon: '◇', type: 'integration' },
    { id: 'calendar', name: 'Calendar', desc: 'Today + upcoming', icon: '◫', type: 'integration' },
    { id: 'sysmon', name: 'System monitor', desc: 'Always available', icon: '▤', type: 'built-in', locked: true },
    { id: 'notes', name: 'Notes scratchpad', desc: 'Markdown · auto-save', icon: '✎', type: 'built-in' },
    { id: 'weather', name: 'Weather + clock', desc: 'Local conditions', icon: '◐', type: 'built-in' },
    { id: 'youtube', name: 'YouTube', desc: 'Pinned video', icon: '▶', type: 'integration' },
    { id: 'web', name: 'Custom web tile', desc: 'Any URL', icon: '◰', type: 'built-in' },
  ];
  return (
    <div style={{ maxWidth: 980, width: '100%' }}>
      <h1 style={{ fontSize: 40, fontWeight: 700, margin: '0 0 8px 0', letterSpacing: '-0.02em', textAlign: 'center' }}>Connect your tiles</h1>
      <p style={{ fontSize: 15, color: 'rgba(255,255,255,0.5)', margin: '0 0 36px 0', textAlign: 'center' }}>Tap to add. Integrations open auth in a popup. Add more anytime from edit mode.</p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
        {AVAILABLE.map(t => {
          const on = tiles[t.id];
          const locked = t.locked;
          return (
            <button key={t.id} onClick={() => !locked && setTiles({ ...tiles, [t.id]: !on })} style={{
              padding: 16, borderRadius: 10, textAlign: 'left',
              background: on ? `${accent}10` : 'rgba(255,255,255,0.02)',
              border: on ? `1.5px solid ${accent}` : '1.5px solid rgba(255,255,255,0.06)',
              color: '#fff', cursor: locked ? 'default' : 'pointer',
              opacity: locked ? 0.7 : 1,
              display: 'flex', flexDirection: 'column', gap: 8,
              minHeight: 110,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ width: 36, height: 36, borderRadius: 8, background: on ? accent : 'rgba(255,255,255,0.04)', color: on ? '#000' : accent, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18 }}>{t.icon}</div>
                {on ? (
                  <span style={{ fontSize: 10, color: accent, padding: '2px 8px', background: `${accent}20`, borderRadius: 3, fontFamily: 'JetBrains Mono, ui-monospace, monospace' }}>● ADDED</span>
                ) : locked ? (
                  <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', padding: '2px 8px', background: 'rgba(255,255,255,0.04)', borderRadius: 3, fontFamily: 'JetBrains Mono, ui-monospace, monospace' }}>LOCKED</span>
                ) : (
                  <span style={{ fontSize: 14, color: 'rgba(255,255,255,0.3)' }}>+</span>
                )}
              </div>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 2 }}>{t.name}</div>
                <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', marginBottom: 4 }}>{t.desc}</div>
                <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.3)', fontFamily: 'JetBrains Mono, ui-monospace, monospace', textTransform: 'uppercase', letterSpacing: '.06em' }}>{t.type}</div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function OnbReady({ accent, profile, audio, tiles }) {
  const tileCount = Object.values(tiles).filter(Boolean).length;
  return (
    <div style={{ maxWidth: 720, textAlign: 'center' }}>
      <div style={{
        width: 96, height: 96, margin: '0 auto 32px', borderRadius: 24,
        background: `linear-gradient(135deg, ${accent}, ${accent}88)`,
        boxShadow: `0 20px 80px -10px ${accent}88`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        position: 'relative',
      }}>
        <span style={{ fontSize: 48, color: '#000', fontWeight: 800 }}>✓</span>
      </div>
      <h1 style={{ fontSize: 48, fontWeight: 800, margin: '0 0 16px 0', letterSpacing: '-0.03em' }}>
        You're set.
      </h1>
      <p style={{ fontSize: 16, color: 'rgba(255,255,255,0.6)', lineHeight: 1.5, margin: '0 0 40px 0' }}>
        Hub will launch with your <b style={{ color: accent }}>{profile || 'Work'}</b> profile, <b style={{ color: accent }}>{tileCount}</b> tiles, audio from <b style={{ color: accent }}>{audio === 'wasapi' ? 'system loopback' : audio}</b>.
      </p>
      <div style={{
        padding: 20, borderRadius: 12, background: 'rgba(255,255,255,0.02)',
        border: '1px solid rgba(255,255,255,0.06)', textAlign: 'left',
        display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12,
      }}>
        <KbHint k="⌘ E" desc="Toggle edit mode" />
        <KbHint k="⌘ 1/2/3" desc="Switch profiles" />
        <KbHint k="⌘ K" desc="Command palette" />
        <KbHint k="⌘ ," desc="Settings" />
        <KbHint k="V" desc="Cycle viz mode" />
        <KbHint k="?" desc="All shortcuts" />
      </div>
    </div>
  );
}

function KbHint({ k, desc }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <kbd style={{
        padding: '4px 10px', fontSize: 11, fontWeight: 600,
        background: 'rgba(255,255,255,0.06)', color: '#fff',
        border: '1px solid rgba(255,255,255,0.1)', borderRadius: 5,
        fontFamily: 'JetBrains Mono, ui-monospace, monospace',
        minWidth: 60, textAlign: 'center',
      }}>{k}</kbd>
      <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.6)' }}>{desc}</span>
    </div>
  );
}

// Export to window
Object.assign(window, {
  EditModeOverlay, ProfileSwitcher, Onboarding, ProfilePreview,
});

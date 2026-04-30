import React, { useState } from 'react';

interface Rect { x: number; y: number; w: number; h: number }
type TileKind = 'discord' | 'spotify' | 'claude' | 'notes' | 'web' | 'viz' | 'sysmon' | 'clock' | 'upnext';
interface TileEntry { rect: Rect; label: string; kind: TileKind }

export function EditModeOverlay({
  accent, accent2, onExit, onRemove, hiddenIds = [],
}: {
  accent: string;
  accent2: string;
  onExit: () => void;
  /** Removes a tile from the live layout. Receives the same id used in TILES. */
  onRemove?: (id: string) => void;
  hiddenIds?: string[];
}) {
  const [tool, setTool] = useState<'select' | 'move' | 'resize' | 'add' | 'comment'>('select');
  const [selected, setSelected] = useState<string>('viz');
  const [showGuides, setShowGuides] = useState(true);
  const [showGrid, setShowGrid] = useState(true);
  const [snap, setSnap] = useState(true);

  // Tile rectangles in the 2560x1440 canvas (matches the live grid layout).
  const railX = 20, railY = 56 + 8, railW = 560;
  const gap = 14;
  const railH = 1440 - 56 - 32 - 16;
  const railRows = [1.3, 0.95, 1.0, 0.55, 0.6];
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

  const ALL_TILES: Record<string, TileEntry> = {
    discord:  { rect: railRects[0]!, label: 'Discord', kind: 'discord' },
    spotify:  { rect: railRects[1]!, label: 'Now playing', kind: 'spotify' },
    claude:   { rect: railRects[2]!, label: 'Claude Code', kind: 'claude' },
    notes:    { rect: railRects[3]!, label: 'Notes', kind: 'notes' },
    linear:   { rect: railRects[4]!, label: 'Linear', kind: 'web' },
    viz:      { rect: vizRect, label: 'Audio visualizer', kind: 'viz' },
    sysmon:   { rect: bsRects[0]!, label: 'System monitor', kind: 'sysmon' },
    clock:    { rect: bsRects[1]!, label: 'Clock & weather', kind: 'clock' },
    upnext:   { rect: bsRects[2]!, label: 'Up next', kind: 'upnext' },
  };
  const TILES: Record<string, TileEntry> = Object.fromEntries(
    Object.entries(ALL_TILES).filter(([id]) => !hiddenIds.includes(id))
  );

  const sel = TILES[selected] ?? ALL_TILES.viz!;

  return (
    <div style={{
      position: 'absolute', inset: 0, zIndex: 50,
      background: 'rgba(8,9,12,0.55)', backdropFilter: 'blur(2px)',
    }}>
      <EditToolbar accent={accent} tool={tool} setTool={setTool}
        showGuides={showGuides} setShowGuides={setShowGuides}
        showGrid={showGrid} setShowGrid={setShowGrid}
        snap={snap} setSnap={setSnap}
        onExit={onExit} />
      <EditLeftRail accent={accent} tool={tool} setTool={setTool} />
      {showGrid && <GridOverlay />}
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
      {showGuides && sel && <SmartGuides rect={sel.rect} accent={accent2} />}
      {sel && (
        <PropertiesPanel
          accent={accent}
          tile={sel}
          selectedId={selected}
          onRemove={
            onRemove && selected !== 'viz'
              ? () => {
                  onRemove(selected);
                  // Move selection to viz so the panel doesn't try to render a stale tile.
                  setSelected('viz');
                }
              : undefined
          }
        />
      )}
      <LayersPanel accent={accent} selected={selected} setSelected={setSelected} tiles={TILES} />
    </div>
  );
}

function EditToolbar({ accent, tool, setTool, showGuides, setShowGuides, showGrid, setShowGrid, snap, setSnap, onExit }: any) {
  return (
    <div style={{
      position: 'absolute', top: 16, left: '50%', transform: 'translateX(-50%)',
      display: 'flex', alignItems: 'center', gap: 4,
      padding: '6px 8px', borderRadius: 10,
      background: 'rgba(20,22,28,0.95)', backdropFilter: 'blur(20px)',
      border: '1px solid rgba(255,255,255,0.08)',
      boxShadow: '0 12px 40px rgba(0,0,0,0.5)', zIndex: 60,
    }}>
      <ToolBtn icon="↖" label="Select" active={tool === 'select'} onClick={() => setTool('select')} accent={accent} />
      <ToolBtn icon="✥" label="Move" active={tool === 'move'} onClick={() => setTool('move')} accent={accent} />
      <ToolBtn icon="◰" label="Resize" active={tool === 'resize'} onClick={() => setTool('resize')} accent={accent} />
      <ToolBtn icon="+" label="Add tile" active={tool === 'add'} onClick={() => setTool('add')} accent={accent} />
      <Divider />
      <ToolToggle label="Snap" active={snap} onClick={() => setSnap(!snap)} accent={accent} />
      <ToolToggle label="Grid" active={showGrid} onClick={() => setShowGrid(!showGrid)} accent={accent} />
      <ToolToggle label="Guides" active={showGuides} onClick={() => setShowGuides(!showGuides)} accent={accent} />
      <Divider />
      <span style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.45)', fontFamily: '"JetBrains Mono", ui-monospace, monospace', padding: '0 8px' }}>
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

function ToolBtn({ icon, label, active, onClick, accent }: { icon: string; label: string; active: boolean; onClick: () => void; accent: string }) {
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

function ToolToggle({ label, active, onClick, accent }: { label: string; active: boolean; onClick: () => void; accent: string }) {
  return (
    <button onClick={onClick} style={{
      padding: '6px 10px', fontSize: 10.5, fontWeight: 500, borderRadius: 6,
      background: active ? `${accent}20` : 'transparent',
      color: active ? accent : 'rgba(255,255,255,0.5)',
      border: active ? `1px solid ${accent}55` : '1px solid rgba(255,255,255,0.06)',
      cursor: 'pointer',
    }}>{label}</button>
  );
}

function Divider() {
  return <div style={{ width: 1, height: 20, background: 'rgba(255,255,255,0.08)', margin: '0 4px' }} />;
}

function EditLeftRail({ accent, tool, setTool }: { accent: string; tool: string; setTool: (s: any) => void }) {
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
      boxShadow: '0 12px 40px rgba(0,0,0,0.5)', zIndex: 55,
    }}>
      {tools.map((t) => (
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
          <span style={{ fontSize: 8, color: 'rgba(255,255,255,0.4)', fontFamily: '"JetBrains Mono", ui-monospace, monospace' }}>{t.label}</span>
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
      pointerEvents: 'none', zIndex: 45,
    }} />
  );
}

function SelectionHandles({ accent }: { accent: string }) {
  const handle = (style: React.CSSProperties) => (
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

function SelectionLabel({ accent, label, w, h }: { accent: string; label: string; w: number; h: number }) {
  return (
    <div style={{
      position: 'absolute', top: -28, left: 0,
      padding: '3px 10px', fontSize: 11, fontWeight: 600,
      background: accent, color: '#000', borderRadius: 4,
      fontFamily: '"JetBrains Mono", ui-monospace, monospace',
      whiteSpace: 'nowrap',
    }}>
      {label} · {Math.round(w)}×{Math.round(h)}
    </div>
  );
}

function SmartGuides({ rect, accent }: { rect: Rect; accent: string }) {
  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h / 2;
  const lineStyle: React.CSSProperties = {
    position: 'absolute', background: accent, pointerEvents: 'none',
    boxShadow: `0 0 6px ${accent}`, zIndex: 44,
  };
  return (
    <>
      <div style={{ ...lineStyle, left: cx - 0.5, top: 0, width: 1, height: '100%', opacity: 0.5 }} />
      <div style={{ ...lineStyle, top: cy - 0.5, left: 0, width: '100%', height: 1, opacity: 0.5 }} />
      <DistanceMarker x={rect.x} y={0} w={0} h={rect.y} accent={accent} value={rect.y} orient="vertical" />
      <DistanceMarker x={rect.x} y={rect.y + rect.h} w={0} h={1440 - rect.y - rect.h} accent={accent} value={1440 - rect.y - rect.h} orient="vertical" />
      <DistanceMarker x={0} y={rect.y} w={rect.x} h={0} accent={accent} value={rect.x} orient="horizontal" />
      <DistanceMarker x={rect.x + rect.w} y={rect.y} w={2560 - rect.x - rect.w} h={0} accent={accent} value={2560 - rect.x - rect.w} orient="horizontal" />
    </>
  );
}

function DistanceMarker({ x, y, w, h, accent, value, orient }: { x: number; y: number; w: number; h: number; accent: string; value: number; orient: 'vertical' | 'horizontal' }) {
  const labelStyle: React.CSSProperties = {
    position: 'absolute', padding: '2px 6px',
    background: accent, color: '#000', fontSize: 10, fontWeight: 600,
    borderRadius: 3, fontFamily: '"JetBrains Mono", ui-monospace, monospace',
    pointerEvents: 'none', zIndex: 46,
  };
  if (orient === 'vertical') {
    return (
      <>
        <div style={{ position: 'absolute', left: x + 20, top: y, width: 1, height: h, background: accent, opacity: 0.6, zIndex: 44 }} />
        <div style={{ ...labelStyle, left: x + 28, top: y + h / 2 - 9 }}>{Math.round(value)}</div>
      </>
    );
  }
  return (
    <>
      <div style={{ position: 'absolute', left: x, top: y + 20, height: 1, width: w, background: accent, opacity: 0.6, zIndex: 44 }} />
      <div style={{ ...labelStyle, left: x + w / 2 - 16, top: y + 28 }}>{Math.round(value)}</div>
    </>
  );
}

function PropertiesPanel({ accent, tile, selectedId, onRemove }: { accent: string; tile: TileEntry; selectedId: string; onRemove?: () => void }) {
  return (
    <div style={{
      position: 'absolute', top: 80, right: 16, width: 280,
      maxHeight: 'calc(100% - 100px)',
      borderRadius: 10,
      background: 'rgba(20,22,28,0.96)', backdropFilter: 'blur(20px)',
      border: '1px solid rgba(255,255,255,0.08)',
      boxShadow: '0 12px 40px rgba(0,0,0,0.5)',
      zIndex: 55, overflow: 'hidden', display: 'flex', flexDirection: 'column',
    }}>
      <div style={{ padding: '10px 14px', borderBottom: '1px solid rgba(255,255,255,0.06)', display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ width: 8, height: 8, background: accent, borderRadius: 2 }} />
        <span style={{ fontSize: 12, fontWeight: 600, color: '#fff' }}>{tile.label}</span>
        <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', fontFamily: '"JetBrains Mono", ui-monospace, monospace', marginLeft: 'auto' }}>#{selectedId}</span>
      </div>
      <div style={{ overflow: 'auto', padding: '4px 0' }}>
        <PropSection title="Position & size">
          <PropRow label="X"><PropNum v={Math.round(tile.rect.x)} /></PropRow>
          <PropRow label="Y"><PropNum v={Math.round(tile.rect.y)} /></PropRow>
          <PropRow label="W"><PropNum v={Math.round(tile.rect.w)} /></PropRow>
          <PropRow label="H"><PropNum v={Math.round(tile.rect.h)} /></PropRow>
          <PropRow label="Lock"><EmToggle on={false} accent={accent} /></PropRow>
        </PropSection>
        <PropSection title="Appearance">
          <PropRow label="Radius"><PropNum v={14} /></PropRow>
          <PropRow label="Padding"><PropNum v={12} /></PropRow>
          <PropRow label="Glass"><EmToggle on={true} accent={accent} /></PropRow>
        </PropSection>
        {tile.kind === 'viz' && (
          <PropSection title="Visualizer">
            <PropRow label="Mode"><span style={{ fontSize: 10.5, color: '#fff', padding: '2px 8px', background: accent + '20', borderRadius: 4 }}>Live</span></PropRow>
            <PropRow label="Source"><span style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.7)' }}>WASAPI loopback</span></PropRow>
            <PropRow label="Theme link"><EmToggle on={true} accent={accent} /></PropRow>
          </PropSection>
        )}
      </div>
      <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', padding: 8, display: 'flex', gap: 6 }}>
        <button style={{
          flex: 1, padding: '7px', fontSize: 10.5, fontWeight: 600,
          background: 'rgba(255,255,255,0.04)', color: 'rgba(255,255,255,0.7)',
          border: '1px solid rgba(255,255,255,0.08)', borderRadius: 5, cursor: 'pointer',
        }}>Duplicate</button>
        <button
          onClick={onRemove}
          disabled={!onRemove}
          title={onRemove ? 'Hide this tile (toggle back from Tweaks → Tiles)' : 'The visualizer cannot be hidden'}
          style={{
            flex: 1, padding: '7px', fontSize: 10.5, fontWeight: 600,
            background: 'rgba(239,68,68,0.1)', color: onRemove ? '#fca5a5' : 'rgba(239,68,68,0.4)',
            border: '1px solid rgba(239,68,68,0.2)', borderRadius: 5,
            cursor: onRemove ? 'pointer' : 'not-allowed',
          }}
        >Remove</button>
      </div>
    </div>
  );
}

function PropSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ padding: '8px 14px', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
      <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 8, fontWeight: 600 }}>{title}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>{children}</div>
    </div>
  );
}

function PropRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={{ width: 70, fontSize: 10.5, color: 'rgba(255,255,255,0.45)' }}>{label}</span>
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 6 }}>{children}</div>
    </div>
  );
}

function PropNum({ v }: { v: number }) {
  return (
    <input defaultValue={v} style={{
      flex: 1, fontSize: 11, padding: '4px 6px', borderRadius: 4,
      background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
      color: '#fff', fontFamily: '"JetBrains Mono", ui-monospace, monospace',
      width: '100%',
    }} />
  );
}

function EmToggle({ on, accent }: { on: boolean; accent: string }) {
  const [checked, setChecked] = useState(on);
  return (
    <button onClick={() => setChecked(!checked)} style={{
      width: 28, height: 16, borderRadius: 8,
      background: checked ? accent : 'rgba(255,255,255,0.1)',
      border: 'none', position: 'relative', cursor: 'pointer',
    }}>
      <div style={{
        position: 'absolute', top: 2, left: checked ? 14 : 2,
        width: 12, height: 12, borderRadius: 6, background: '#fff',
        transition: 'left .15s',
      }} />
    </button>
  );
}

function LayersPanel({ accent, selected, setSelected, tiles }: { accent: string; selected: string; setSelected: (s: string) => void; tiles: Record<string, TileEntry> }) {
  const order = ['viz', 'spotify', 'discord', 'claude', 'notes', 'linear', 'sysmon', 'clock', 'upnext'];
  const kindIcon = (k: TileKind) => ({ viz: '◢', spotify: '♪', discord: '◇', claude: '⌘', notes: '✎', web: '◰', sysmon: '▤', clock: '◐', upnext: '▸' }[k] || '◰');
  return (
    <div style={{
      position: 'absolute', bottom: 16, left: 16, width: 240,
      borderRadius: 10, overflow: 'hidden',
      background: 'rgba(20,22,28,0.96)', backdropFilter: 'blur(20px)',
      border: '1px solid rgba(255,255,255,0.08)',
      boxShadow: '0 12px 40px rgba(0,0,0,0.5)', zIndex: 55,
    }}>
      <div style={{ padding: '10px 14px', borderBottom: '1px solid rgba(255,255,255,0.06)', display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: '#fff' }}>Layers</span>
        <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.4)', fontFamily: '"JetBrains Mono", ui-monospace, monospace', marginLeft: 'auto' }}>{order.length} tiles</span>
      </div>
      <div style={{ padding: 6 }}>
        {order.map((id) => {
          const t = tiles[id];
          if (!t) return null;
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
              <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.3)', fontFamily: '"JetBrains Mono", ui-monospace, monospace' }}>
                {Math.round(t.rect.w)}×{Math.round(t.rect.h)}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

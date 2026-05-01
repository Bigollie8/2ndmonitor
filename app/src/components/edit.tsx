import React, { useState } from 'react';
import type { TileId, Rect, Layout } from '../state/layout';
import { DEFAULT_LAYOUT, clampRect } from '../state/layout';

export function EditModeOverlay({
  accent, accent2, onExit, onRemove,
  layout, setLayout,
  selectedId, setSelectedId,
  hiddenIds = [],
}: {
  accent: string;
  accent2: string;
  onExit: () => void;
  onRemove?: (id: TileId) => void;
  layout: Layout;
  setLayout: (next: Layout) => void;
  selectedId: TileId;
  setSelectedId: (id: TileId) => void;
  hiddenIds?: TileId[];
}) {
  const [tool, setTool] = useState<'select' | 'move' | 'resize' | 'add' | 'comment'>('select');
  const [showGuides, setShowGuides] = useState(true);
  const [showGrid, setShowGrid] = useState(true);
  const [snapEnabled, setSnapEnabled] = useState(true);

  const ALL_LABELS: Record<TileId, string> = {
    discord: 'Discord', spotify: 'Now playing', claude: 'Claude Code',
    mixer: 'Audio mixer',
    notes: 'Todos', sysmon: 'System monitor', clock: 'Now & forecast', viz: 'Audio visualizer',
  };

  const allIds: TileId[] = ['discord', 'spotify', 'claude', 'mixer', 'notes', 'viz', 'sysmon', 'clock'];
  const visibleIds = allIds.filter((id) => !hiddenIds.includes(id));
  const tiles: Partial<Record<TileId, { rect: Rect; label: string }>> = {};
  for (const id of visibleIds) {
    tiles[id] = { rect: layout[id] ?? DEFAULT_LAYOUT[id], label: ALL_LABELS[id] };
  }

  const sel = tiles[selectedId] ?? tiles.viz!;
  const setRect = (id: TileId, r: Rect) => setLayout({ ...layout, [id]: clampRect(r) });

  return (
    <div style={{
      position: 'absolute', inset: 0, zIndex: 50,
      background: 'rgba(8,9,12,0.25)',
      pointerEvents: 'none',
    }}>
      <div style={{ pointerEvents: 'auto' }}>
        <EditToolbar accent={accent} tool={tool} setTool={setTool}
          showGuides={showGuides} setShowGuides={setShowGuides}
          showGrid={showGrid} setShowGrid={setShowGrid}
          snap={snapEnabled} setSnap={setSnapEnabled}
          onExit={onExit} />
        <EditLeftRail accent={accent} tool={tool} setTool={setTool} />
      </div>
      {showGrid && <GridOverlay />}
      {showGuides && sel && <SmartGuides rect={sel.rect} accent={accent2} />}
      <div style={{ pointerEvents: 'auto' }}>
        {sel && (
          <PropertiesPanel
            accent={accent}
            tile={{ rect: sel.rect, label: sel.label, kind: selectedId }}
            selectedId={selectedId}
            onChangeRect={(r) => setRect(selectedId, r)}
            onRemove={
              onRemove && selectedId !== 'viz'
                ? () => { onRemove(selectedId); setSelectedId('viz'); }
                : undefined
            }
          />
        )}
        <LayersPanel accent={accent} selected={selectedId} setSelected={(id) => setSelectedId(id as TileId)} tiles={tiles} />
      </div>
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

function PropertiesPanel({
  accent, tile, selectedId, onChangeRect, onRemove,
}: {
  accent: string;
  tile: { rect: Rect; label: string; kind: TileId };
  selectedId: TileId;
  onChangeRect: (r: Rect) => void;
  onRemove?: () => void;
}) {
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
          <PropRow label="X"><PropNum v={tile.rect.x} onChange={(x) => onChangeRect({ ...tile.rect, x })} /></PropRow>
          <PropRow label="Y"><PropNum v={tile.rect.y} onChange={(y) => onChangeRect({ ...tile.rect, y })} /></PropRow>
          <PropRow label="W"><PropNum v={tile.rect.w} onChange={(w) => onChangeRect({ ...tile.rect, w })} /></PropRow>
          <PropRow label="H"><PropNum v={tile.rect.h} onChange={(h) => onChangeRect({ ...tile.rect, h })} /></PropRow>
        </PropSection>
      </div>
      <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', padding: 8, display: 'flex', gap: 6 }}>
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

function PropNum({ v, onChange }: { v: number; onChange: (n: number) => void }) {
  return (
    <input
      type="number"
      value={Math.round(v)}
      onChange={(e) => {
        const n = parseInt(e.target.value, 10);
        if (Number.isFinite(n)) onChange(n);
      }}
      style={{
        flex: 1, fontSize: 11, padding: '4px 6px', borderRadius: 4,
        background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
        color: '#fff', fontFamily: '"JetBrains Mono", ui-monospace, monospace',
        width: '100%',
      }}
    />
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

function LayersPanel({ accent, selected, setSelected, tiles }: {
  accent: string; selected: string;
  setSelected: (s: string) => void;
  tiles: Partial<Record<TileId, { rect: Rect; label: string }>>;
}) {
  const order: TileId[] = ['viz', 'spotify', 'discord', 'claude', 'mixer', 'notes', 'sysmon', 'clock'];
  const kindIcon = (id: TileId): string => ({
    viz: '◢', spotify: '♪', discord: '◇', claude: '⌘', mixer: '♬', notes: '✎',
    sysmon: '▤', clock: '◐',
  }[id]);
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
        <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.4)', fontFamily: '"JetBrains Mono", ui-monospace, monospace', marginLeft: 'auto' }}>{Object.keys(tiles).length} tiles</span>
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
              <span style={{ fontSize: 11 }}>{kindIcon(id)}</span>
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

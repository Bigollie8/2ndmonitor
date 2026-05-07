import React, { useState } from 'react';
import type { TileType, TileInstance, Rect } from '../state/layout';
import {
  DEFAULT_LANDSCAPE_LAYOUT,
  DEFAULT_PORTRAIT_LAYOUT,
  clampRectFrac,
  useCanvas,
  useOrientation,
  findInstance,
  getInstance,
  removeInstance,
  updateInstance,
} from '../state/layout';
import { TilePickerGallery } from './TilePickerGallery';

export function EditModeOverlay({
  accent, accent2, onExit, onRemove, onAdd,
  tiles, setTiles,
  selectedInstanceId, setSelectedInstanceId,
  snap, setSnap,
  profileName,
}: {
  accent: string;
  accent2: string;
  onExit: () => void;
  onRemove?: (instanceId: string) => void;
  onAdd: (type: TileType, rect: Rect) => void;
  tiles: TileInstance[];
  setTiles: (next: TileInstance[]) => void;
  selectedInstanceId: string;
  setSelectedInstanceId: (id: string) => void;
  snap: boolean;
  setSnap: (enabled: boolean) => void;
  profileName: string;
}) {
  const [tool, setTool] = useState<'select' | 'move' | 'resize' | 'comment'>('select');
  const [showGuides, setShowGuides] = useState(true);
  const [showGrid, setShowGrid] = useState(true);
  const [pickerOpen, setPickerOpen] = useState(false);

  const ALL_LABELS: Record<TileType, string> = {
    discord: 'Discord', spotify: 'Now playing', claude: 'Claude Code',
    mixer: 'Audio mixer',
    notes: 'Todos', sysmon: 'System monitor', clock: 'Now & forecast', viz: 'Audio visualizer',
    streamDeck: 'Stream Deck',
  };

  const orientation = useOrientation();
  const canvas = useCanvas();
  const defaults = orientation === 'portrait' ? DEFAULT_PORTRAIT_LAYOUT : DEFAULT_LANDSCAPE_LAYOUT;

  const tileMap: Record<string, { rect: Rect; label: string; type: TileType }> = {};
  for (const inst of tiles) {
    tileMap[inst.instanceId] = { rect: inst.rect, label: ALL_LABELS[inst.type], type: inst.type };
  }

  const sel = tileMap[selectedInstanceId] ?? (tiles[0] ? { rect: tiles[0].rect, label: ALL_LABELS[tiles[0].type], type: tiles[0].type } : undefined);

  const setRect = (instanceId: string, r: Rect) =>
    setTiles(updateInstance(tiles, instanceId, { rect: clampRectFrac(r, canvas) }));

  const resetRect = (instanceId: string) => {
    const inst = getInstance(tiles, instanceId);
    if (!inst) return;
    setTiles(updateInstance(tiles, instanceId, { rect: defaults[inst.type] }));
  };

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
          snap={snap} setSnap={setSnap}
          profileName={profileName}
          onExit={onExit}
          onPickerOpen={() => setPickerOpen(true)} />
        <EditLeftRail accent={accent} tool={tool} setTool={setTool} />
      </div>
      {showGrid && <GridOverlay />}
      {showGuides && sel && <SmartGuides rect={sel.rect} accent={accent2} canvas={canvas} />}
      <div style={{ pointerEvents: 'auto' }}>
        {sel && selectedInstanceId && (
          <PropertiesPanel
            accent={accent}
            tile={{ rect: sel.rect, label: sel.label, kind: sel.type }}
            selectedInstanceId={selectedInstanceId}
            canvas={canvas}
            onChangeRect={(r) => setRect(selectedInstanceId, r)}
            onReset={() => resetRect(selectedInstanceId)}
            onRemove={
              onRemove && sel.type !== 'viz'
                ? () => {
                    onRemove(selectedInstanceId);
                    const next = tiles.find((t) => t.instanceId !== selectedInstanceId);
                    setSelectedInstanceId(next?.instanceId ?? '');
                  }
                : undefined
            }
          />
        )}
        <LayersPanel accent={accent} selectedInstanceId={selectedInstanceId} setSelectedInstanceId={setSelectedInstanceId} tiles={tiles} canvas={canvas} labels={ALL_LABELS} />
      </div>
      {pickerOpen && (
        <div style={{ pointerEvents: 'auto' }}>
          <TilePickerGallery
            orientation={orientation}
            canvas={canvas}
            tiles={tiles}
            profileName={profileName}
            accent={accent}
            onAdd={(type, rect) => onAdd(type, rect)}
            onRemove={(instanceId) => onRemove && onRemove(instanceId)}
            onClose={() => setPickerOpen(false)}
          />
        </div>
      )}
    </div>
  );
}

function EditToolbar({
  accent, tool, setTool, showGuides, setShowGuides, showGrid, setShowGrid, snap, setSnap, onExit, profileName, onPickerOpen,
}: {
  accent: string;
  tool: 'select' | 'move' | 'resize' | 'comment';
  setTool: (t: 'select' | 'move' | 'resize' | 'comment') => void;
  showGuides: boolean;
  setShowGuides: (b: boolean) => void;
  showGrid: boolean;
  setShowGrid: (b: boolean) => void;
  snap: boolean;
  setSnap: (b: boolean) => void;
  onExit: () => void;
  profileName: string;
  onPickerOpen: () => void;
}) {
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
      <ToolBtn icon="+" label="Add tile" active={false} onClick={onPickerOpen} accent={accent} />
      <Divider />
      <ToolToggle label="Snap" active={snap} onClick={() => setSnap(!snap)} accent={accent} />
      <ToolToggle label="Grid" active={showGrid} onClick={() => setShowGrid(!showGrid)} accent={accent} />
      <ToolToggle label="Guides" active={showGuides} onClick={() => setShowGuides(!showGuides)} accent={accent} />
      <Divider />
      <span style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.45)', fontFamily: '"JetBrains Mono", ui-monospace, monospace', padding: '0 8px' }}>
        Editing · "{profileName}"
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

function SmartGuides({ rect, accent, canvas }: { rect: Rect; accent: string; canvas: { w: number; h: number } }) {
  // rect is fractional; convert to canvas-pixel space for placement.
  const px = { x: rect.x * canvas.w, y: rect.y * canvas.h, w: rect.w * canvas.w, h: rect.h * canvas.h };
  const cx = px.x + px.w / 2;
  const cy = px.y + px.h / 2;
  const lineStyle: React.CSSProperties = {
    position: 'absolute', background: accent, pointerEvents: 'none',
    boxShadow: `0 0 6px ${accent}`, zIndex: 44,
  };
  return (
    <>
      <div style={{ ...lineStyle, left: cx - 0.5, top: 0, width: 1, height: '100%', opacity: 0.5 }} />
      <div style={{ ...lineStyle, top: cy - 0.5, left: 0, width: '100%', height: 1, opacity: 0.5 }} />
      <DistanceMarker x={px.x} y={0} w={0} h={px.y} accent={accent} value={px.y} orient="vertical" />
      <DistanceMarker x={px.x} y={px.y + px.h} w={0} h={canvas.h - px.y - px.h} accent={accent} value={canvas.h - px.y - px.h} orient="vertical" />
      <DistanceMarker x={0} y={px.y} w={px.x} h={0} accent={accent} value={px.x} orient="horizontal" />
      <DistanceMarker x={px.x + px.w} y={px.y} w={canvas.w - px.x - px.w} h={0} accent={accent} value={canvas.w - px.x - px.w} orient="horizontal" />
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
  accent, tile, selectedInstanceId, canvas, onChangeRect, onReset, onRemove,
}: {
  accent: string;
  tile: { rect: Rect; label: string; kind: TileType };
  selectedInstanceId: string;
  canvas: { w: number; h: number };
  onChangeRect: (r: Rect) => void;
  onReset?: () => void;
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
        <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', fontFamily: '"JetBrains Mono", ui-monospace, monospace', marginLeft: 'auto' }}>{tile.kind} · {selectedInstanceId.slice(0, 8)}</span>
      </div>
      <div style={{ overflow: 'auto', padding: '4px 0' }}>
        <PropSection title="Position & size">
          <PropRow label="X"><PropNum v={tile.rect.x * canvas.w} onChange={(px) => onChangeRect({ ...tile.rect, x: px / canvas.w })} /></PropRow>
          <PropRow label="Y"><PropNum v={tile.rect.y * canvas.h} onChange={(px) => onChangeRect({ ...tile.rect, y: px / canvas.h })} /></PropRow>
          <PropRow label="W"><PropNum v={tile.rect.w * canvas.w} onChange={(px) => onChangeRect({ ...tile.rect, w: px / canvas.w })} /></PropRow>
          <PropRow label="H"><PropNum v={tile.rect.h * canvas.h} onChange={(px) => onChangeRect({ ...tile.rect, h: px / canvas.h })} /></PropRow>
        </PropSection>
      </div>
      <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', padding: 8, display: 'flex', gap: 6 }}>
        <button
          onClick={onReset}
          disabled={!onReset}
          title="Restore this tile to its default position and size"
          style={{
            flex: 1, padding: '7px', fontSize: 10.5, fontWeight: 600,
            background: 'rgba(255,255,255,0.04)', color: 'rgba(255,255,255,0.75)',
            border: '1px solid rgba(255,255,255,0.1)', borderRadius: 5,
            cursor: onReset ? 'pointer' : 'not-allowed',
          }}
        >Reset</button>
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

function LayersPanel({ accent, selectedInstanceId, setSelectedInstanceId, tiles, canvas, labels }: {
  accent: string;
  selectedInstanceId: string;
  setSelectedInstanceId: (id: string) => void;
  tiles: TileInstance[];
  canvas: { w: number; h: number };
  labels: Record<TileType, string>;
}) {
  const kindIcon = (type: TileType): string => ({
    viz: '◢', spotify: '♪', discord: '◇', claude: '⌘', mixer: '♬', notes: '✎',
    sysmon: '▤', clock: '◐', streamDeck: '▦',
  }[type] ?? '?');
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
        <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.4)', fontFamily: '"JetBrains Mono", ui-monospace, monospace', marginLeft: 'auto' }}>{tiles.length} tiles</span>
      </div>
      <div style={{ padding: 6 }}>
        {tiles.map((inst) => {
          const isSelected = selectedInstanceId === inst.instanceId;
          return (
            <button key={inst.instanceId} onClick={() => setSelectedInstanceId(inst.instanceId)} style={{
              width: '100%', display: 'flex', alignItems: 'center', gap: 8,
              padding: '6px 8px', borderRadius: 5, border: 'none', cursor: 'pointer',
              background: isSelected ? `${accent}25` : 'transparent',
              color: isSelected ? '#fff' : 'rgba(255,255,255,0.7)',
              textAlign: 'left',
            }}>
              <span style={{ fontSize: 11 }}>{kindIcon(inst.type)}</span>
              <span style={{ fontSize: 11, flex: 1 }}>{inst.name ?? labels[inst.type]}</span>
              <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.3)', fontFamily: '"JetBrains Mono", ui-monospace, monospace' }}>
                {Math.round(inst.rect.w * canvas.w)}×{Math.round(inst.rect.h * canvas.h)}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

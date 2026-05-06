import React, { useEffect } from 'react';
import type { TileId, Rect, Layout, Orientation } from '../state/layout';
import {
  DEFAULT_LANDSCAPE_LAYOUT,
  DEFAULT_PORTRAIT_LAYOUT,
  findEmptyRect,
} from '../state/layout';

const TILE_META: Record<TileId, { icon: string; label: string; description: string }> = {
  viz:     { icon: '◢', label: 'Audio visualizer',  description: '27 styles reactive to system audio' },
  spotify: { icon: '♪', label: 'Now playing',       description: 'Track, lyrics, queue, volume' },
  discord: { icon: '◇', label: 'Discord voice',     description: 'Voice channel members + speaking' },
  claude:  { icon: '⌘', label: 'Claude Code',       description: 'Active session log' },
  mixer:   { icon: '♬', label: 'Audio mixer',       description: 'Master volume + per-app sessions' },
  notes:   { icon: '✎', label: 'Todos',             description: 'Quick task list' },
  sysmon:  { icon: '▤', label: 'System monitor',    description: 'CPU / RAM / GPU / network' },
  clock:   { icon: '◐', label: 'Now & forecast',    description: 'Time + weather' },
};

const ORDER: TileId[] = ['viz', 'spotify', 'discord', 'claude', 'mixer', 'notes', 'sysmon', 'clock'];

export function TilePickerGallery({
  orientation, canvas, layout, hidden, profileName, accent,
  onAdd, onRemove, onClose,
}: {
  orientation: Orientation;
  canvas: { w: number; h: number };
  layout: Layout;
  hidden: Partial<Record<TileId, boolean>>;
  profileName: string;
  accent: string;
  onAdd: (id: TileId, rect: Rect) => void;
  onRemove: (id: TileId) => void;
  onClose: () => void;
}) {
  // Esc closes the modal.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  const defaults = orientation === 'portrait' ? DEFAULT_PORTRAIT_LAYOUT : DEFAULT_LANDSCAPE_LAYOUT;

  const visibleRects = (Object.keys(layout) as TileId[])
    .filter((id) => !hidden[id] && layout[id])
    .map((id) => layout[id]!)
    // Also include tiles that are visible but use the default rect (no entry in layout):
    .concat(
      ORDER.filter((id) => !hidden[id] && !layout[id]).map((id) => defaults[id]),
    );

  const handleClick = (id: TileId) => {
    if (hidden[id]) {
      const preferred = layout[id] ?? defaults[id];
      const rect = findEmptyRect(visibleRects, preferred, canvas);
      onAdd(id, rect);
      onClose();
    } else if (id === 'viz') {
      // Viz cannot be removed. Defensive guard; the card is also rendered
      // disabled below.
      return;
    } else {
      onRemove(id);
      onClose();
    }
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: 'absolute', inset: 0, zIndex: 70,
        background: 'rgba(8,9,12,0.55)', backdropFilter: 'blur(2px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(720px, 90%)', maxHeight: '80%',
          background: 'rgba(20,22,28,0.98)', backdropFilter: 'blur(20px)',
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: 12, boxShadow: '0 24px 60px rgba(0,0,0,0.5)',
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div style={{
          padding: '14px 18px', borderBottom: '1px solid rgba(255,255,255,0.06)',
          display: 'flex', alignItems: 'center', gap: 10,
        }}>
          <div style={{ width: 8, height: 8, background: accent, borderRadius: 2 }} />
          <span style={{ fontSize: 13, fontWeight: 600, color: '#fff' }}>Tiles</span>
          <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)', fontFamily: '"JetBrains Mono", ui-monospace, monospace' }}>
            · "{profileName}"
          </span>
          <button onClick={onClose} title="Close" style={{
            marginLeft: 'auto', padding: '4px 10px', fontSize: 12,
            background: 'transparent', color: 'rgba(255,255,255,0.55)',
            border: '1px solid rgba(255,255,255,0.1)', borderRadius: 5, cursor: 'pointer',
          }}>×</button>
        </div>

        {/* Card grid */}
        <div style={{
          padding: 14, overflow: 'auto',
          display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12,
        }}>
          {ORDER.map((id) => {
            const meta = TILE_META[id];
            const isHidden = !!hidden[id];
            const isViz = id === 'viz';
            const disabled = isViz && !isHidden;
            const cursor = disabled ? 'not-allowed' : 'pointer';
            const title = disabled ? 'The visualizer cannot be hidden' : meta.description;
            return (
              <button
                key={id}
                onClick={() => !disabled && handleClick(id)}
                title={title}
                style={{
                  position: 'relative',
                  display: 'flex', flexDirection: 'column',
                  alignItems: 'center', justifyContent: 'center',
                  gap: 8, padding: 14,
                  height: 140,
                  background: isHidden ? 'rgba(255,255,255,0.03)' : `${accent}10`,
                  border: isHidden ? '1px solid rgba(255,255,255,0.08)' : `1px solid ${accent}55`,
                  borderRadius: 10, cursor,
                  color: 'rgba(255,255,255,0.85)',
                  opacity: disabled ? 0.55 : 1,
                  transition: 'background .12s, border-color .12s',
                }}
              >
                {/* "Added" badge in top-right corner when visible */}
                {!isHidden && (
                  <span style={{
                    position: 'absolute', top: 6, right: 8,
                    fontSize: 10, fontWeight: 700,
                    color: accent, fontFamily: '"JetBrains Mono", ui-monospace, monospace',
                  }}>+</span>
                )}
                <span style={{ fontSize: 28, lineHeight: 1 }}>{meta.icon}</span>
                <span style={{ fontSize: 12, fontWeight: 600 }}>{meta.label}</span>
                <span style={{
                  fontSize: 10, color: 'rgba(255,255,255,0.45)',
                  textAlign: 'center', lineHeight: 1.3,
                  display: '-webkit-box', WebkitLineClamp: 2 as any, WebkitBoxOrient: 'vertical' as any,
                  overflow: 'hidden',
                }}>
                  {meta.description}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

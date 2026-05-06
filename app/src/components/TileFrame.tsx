import React, { useEffect, useRef, useState } from 'react';
import type { Rect } from '../state/layout';
import { CANVAS, MIN_SIZE, clampRect, snap } from '../state/layout';

type Mode =
  | { kind: 'idle' }
  | { kind: 'move'; startX: number; startY: number; orig: Rect }
  | { kind: 'resize'; startX: number; startY: number; orig: Rect; edge: ResizeEdge };

type ResizeEdge = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

function pointerToCanvas(e: PointerEvent | React.PointerEvent): { x: number; y: number } {
  const root = document.querySelector<HTMLElement>('[data-canvas-root]');
  if (!root) return { x: e.clientX, y: e.clientY };
  const r = root.getBoundingClientRect();
  const sx = r.width / CANVAS.w;
  const sy = r.height / CANVAS.h;
  return { x: (e.clientX - r.left) / sx, y: (e.clientY - r.top) / sy };
}

export function TileFrame({
  id, rect, editing, selected, onSelect, onChange, accent, children, snap: snapEnabled = true,
}: {
  id: string;
  rect: Rect;
  editing: boolean;
  selected: boolean;
  onSelect: () => void;
  onChange: (next: Rect) => void;
  accent: string;
  children: React.ReactNode;
  snap?: boolean;
}) {
  const modeRef = useRef<Mode>({ kind: 'idle' });
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  // Read live inside the global pointermove closure — the effect attaches once
  // per `editing` change, so closure-captured props would go stale on toggle.
  const snapRef = useRef(snapEnabled);
  snapRef.current = snapEnabled;
  const [, force] = useState(0);

  useEffect(() => {
    if (!editing) return;
    const onMove = (e: PointerEvent) => {
      const m = modeRef.current;
      if (m.kind === 'idle') return;
      const p = pointerToCanvas(e);
      const free = !snapRef.current || e.altKey;
      let next: Rect;
      if (m.kind === 'move') {
        const dx = p.x - m.startX;
        const dy = p.y - m.startY;
        next = { ...m.orig, x: m.orig.x + dx, y: m.orig.y + dy };
        if (!free) { next.x = snap(next.x); next.y = snap(next.y); }
      } else {
        const dx = p.x - m.startX;
        const dy = p.y - m.startY;
        next = { ...m.orig };
        if (m.edge.includes('e')) next.w = m.orig.w + dx;
        if (m.edge.includes('s')) next.h = m.orig.h + dy;
        if (m.edge.includes('w')) { next.x = m.orig.x + dx; next.w = m.orig.w - dx; }
        if (m.edge.includes('n')) { next.y = m.orig.y + dy; next.h = m.orig.h - dy; }
        if (next.w < MIN_SIZE.w) {
          if (m.edge.includes('w')) next.x = m.orig.x + m.orig.w - MIN_SIZE.w;
          next.w = MIN_SIZE.w;
        }
        if (next.h < MIN_SIZE.h) {
          if (m.edge.includes('n')) next.y = m.orig.y + m.orig.h - MIN_SIZE.h;
          next.h = MIN_SIZE.h;
        }
        if (!free) {
          next.x = snap(next.x);
          next.y = snap(next.y);
          next.w = Math.max(MIN_SIZE.w, snap(next.w));
          next.h = Math.max(MIN_SIZE.h, snap(next.h));
        }
      }
      onChangeRef.current(clampRect(next));
    };
    const onUp = () => {
      modeRef.current = { kind: 'idle' };
      force((n) => n + 1);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      modeRef.current = { kind: 'idle' };
    };
  }, [editing]);

  const startMove = (e: React.PointerEvent) => {
    onSelect();
    const p = pointerToCanvas(e);
    modeRef.current = { kind: 'move', startX: p.x, startY: p.y, orig: rect };
    force((n) => n + 1);
    e.preventDefault();
  };
  const startResize = (edge: ResizeEdge) => (e: React.PointerEvent) => {
    onSelect();
    const p = pointerToCanvas(e);
    modeRef.current = { kind: 'resize', startX: p.x, startY: p.y, orig: rect, edge };
    force((n) => n + 1);
    e.preventDefault();
    e.stopPropagation();
  };

  return (
    <div
      data-tile-id={id}
      style={{
        position: 'absolute',
        left: rect.x, top: rect.y, width: rect.w, height: rect.h,
        outline: editing && selected ? `2px solid ${accent}` : 'none',
        outlineOffset: 2,
        borderRadius: 14,
        boxShadow: editing && selected ? `0 0 0 1px ${accent}55, 0 0 40px -8px ${accent}aa` : 'none',
        transition: 'outline-color .12s, box-shadow .12s',
        userSelect: editing ? 'none' : 'auto',
      }}
    >
      {children}
      {editing && (
        <>
          <div
            onPointerDown={startMove}
            style={{
              position: 'absolute', inset: 0, cursor: 'grab', background: 'transparent', zIndex: 5,
            }}
          />
          {selected && (
            <>
              <Handle accent={accent} edge="nw" onDown={startResize('nw')} />
              <Handle accent={accent} edge="ne" onDown={startResize('ne')} />
              <Handle accent={accent} edge="sw" onDown={startResize('sw')} />
              <Handle accent={accent} edge="se" onDown={startResize('se')} />
              <Handle accent={accent} edge="n"  onDown={startResize('n')} />
              <Handle accent={accent} edge="s"  onDown={startResize('s')} />
              <Handle accent={accent} edge="e"  onDown={startResize('e')} />
              <Handle accent={accent} edge="w"  onDown={startResize('w')} />
            </>
          )}
        </>
      )}
    </div>
  );
}

function Handle({
  accent, edge, onDown,
}: {
  accent: string;
  edge: ResizeEdge;
  onDown: (e: React.PointerEvent) => void;
}) {
  const pos: React.CSSProperties = (() => {
    switch (edge) {
      case 'nw': return { top: -6, left: -6, cursor: 'nwse-resize' };
      case 'ne': return { top: -6, right: -6, cursor: 'nesw-resize' };
      case 'sw': return { bottom: -6, left: -6, cursor: 'nesw-resize' };
      case 'se': return { bottom: -6, right: -6, cursor: 'nwse-resize' };
      case 'n':  return { top: -6, left: '50%', transform: 'translateX(-50%)', cursor: 'ns-resize' };
      case 's':  return { bottom: -6, left: '50%', transform: 'translateX(-50%)', cursor: 'ns-resize' };
      case 'e':  return { right: -6, top: '50%', transform: 'translateY(-50%)', cursor: 'ew-resize' };
      case 'w':  return { left: -6, top: '50%', transform: 'translateY(-50%)', cursor: 'ew-resize' };
    }
  })();
  return (
    <div
      onPointerDown={onDown}
      style={{
        position: 'absolute', width: 12, height: 12, zIndex: 6,
        background: '#06070a', border: `2px solid ${accent}`, borderRadius: 2,
        ...pos,
      }}
    />
  );
}

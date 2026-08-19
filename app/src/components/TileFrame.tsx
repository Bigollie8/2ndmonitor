import React, { useEffect, useRef, useState } from 'react';
import type { Rect } from '../state/layout';
import { MIN_SIZE_PX, CHROME_TOP_PX, clampRectFrac, snapFrac } from '../state/layout';

type Mode =
  | { kind: 'idle' }
  | { kind: 'move'; startX: number; startY: number; orig: Rect }
  | { kind: 'resize'; startX: number; startY: number; orig: Rect; edge: ResizeEdge };

type ResizeEdge = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

function pointerToFraction(e: PointerEvent | React.PointerEvent): { x: number; y: number } {
  const root = document.querySelector<HTMLElement>('[data-canvas-root]');
  if (!root) return { x: 0, y: 0 };
  const r = root.getBoundingClientRect();
  return {
    x: (e.clientX - r.left) / r.width,
    y: (e.clientY - r.top) / r.height,
  };
}

function getCanvasPx(): { w: number; h: number } {
  const root = document.querySelector<HTMLElement>('[data-canvas-root]');
  if (!root) return { w: window.innerWidth, h: window.innerHeight };
  const r = root.getBoundingClientRect();
  return { w: r.width, h: r.height };
}

export function TileFrame({
  id, rect, editing, selected, onSelect, onChange, accent, children, snap: snapEnabled = true,
  topInsetPx = CHROME_TOP_PX,
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
  topInsetPx?: number;
}) {
  const modeRef = useRef<Mode>({ kind: 'idle' });
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  // Read live inside the global pointermove closure — the effect attaches once
  // per `editing` change, so closure-captured props would go stale on toggle.
  const snapRef = useRef(snapEnabled);
  snapRef.current = snapEnabled;
  const topInsetRef = useRef(topInsetPx);
  topInsetRef.current = topInsetPx;
  const [, force] = useState(0);

  const elRef = useRef<HTMLDivElement>(null);
  /** Rect being dragged/resized right now. Non-null ONLY between pointerdown
   *  and pointerup. While set, the element's geometry is written straight to
   *  its inline style and NO React state is touched — committing per
   *  pointermove re-rendered every tile in the profile and repainted every map
   *  canvas, ~4 repaints per mouse move (0.7.3 P1). */
  const liveRectRef = useRef<Rect | null>(null);

  const applyRectToDom = (r: Rect) => {
    const el = elRef.current;
    if (!el) return;
    el.style.left = `${r.x * 100}%`;
    el.style.top = `${r.y * 100}%`;
    el.style.width = `${r.w * 100}%`;
    el.style.height = `${r.h * 100}%`;
  };

  useEffect(() => {
    if (!editing) return;
    const onMove = (e: PointerEvent) => {
      const m = modeRef.current;
      if (m.kind === 'idle') return;
      const p = pointerToFraction(e);
      const canvasPx = getCanvasPx();
      const minWFrac = MIN_SIZE_PX.w / canvasPx.w;
      const minHFrac = MIN_SIZE_PX.h / canvasPx.h;
      const free = !snapRef.current || e.altKey;
      let next: Rect;
      if (m.kind === 'move') {
        const dx = p.x - m.startX;
        const dy = p.y - m.startY;
        next = { ...m.orig, x: m.orig.x + dx, y: m.orig.y + dy };
        if (!free) { next.x = snapFrac(next.x); next.y = snapFrac(next.y); }
      } else {
        const dx = p.x - m.startX;
        const dy = p.y - m.startY;
        next = { ...m.orig };
        if (m.edge.includes('e')) next.w = m.orig.w + dx;
        if (m.edge.includes('s')) next.h = m.orig.h + dy;
        if (m.edge.includes('w')) { next.x = m.orig.x + dx; next.w = m.orig.w - dx; }
        if (m.edge.includes('n')) { next.y = m.orig.y + dy; next.h = m.orig.h - dy; }
        if (next.w < minWFrac) {
          if (m.edge.includes('w')) next.x = m.orig.x + m.orig.w - minWFrac;
          next.w = minWFrac;
        }
        if (next.h < minHFrac) {
          if (m.edge.includes('n')) next.y = m.orig.y + m.orig.h - minHFrac;
          next.h = minHFrac;
        }
        if (!free) {
          next.x = snapFrac(next.x);
          next.y = snapFrac(next.y);
          next.w = Math.max(minWFrac, snapFrac(next.w));
          next.h = Math.max(minHFrac, snapFrac(next.h));
        }
      }
      const clamped = clampRectFrac(next, canvasPx, topInsetRef.current);
      liveRectRef.current = clamped;
      applyRectToDom(clamped);
    };
    const onUp = () => {
      const live = liveRectRef.current;
      modeRef.current = { kind: 'idle' };
      liveRectRef.current = null;
      // One commit for the whole gesture. React re-renders with the same
      // geometry already written to the DOM, so there is no visual snap.
      if (live) onChangeRef.current(live);
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
    const p = pointerToFraction(e);
    modeRef.current = { kind: 'move', startX: p.x, startY: p.y, orig: rect };
    force((n) => n + 1);
    e.preventDefault();
  };

  /** Pointerdown on the tile body in edit mode. We skip drag-start when the
   *  click landed on an interactive element so users can configure tiles
   *  in-place (e.g., type a Twitch channel, pick a stock ticker, click a
   *  Stream Deck cell). Clicks on plain body chrome still grab the tile.
   *  The selector covers native form controls plus common ARIA roles used
   *  by custom components (e.g., the volume Slider's role="slider"). */
  const INTERACTIVE_SELECTOR =
    'button, input, textarea, select, a, label, [contenteditable], ' +
    '[role="button"], [role="slider"], [role="tab"], [role="link"], ' +
    '[role="checkbox"], [role="switch"], [role="menuitem"], ' +
    '[data-no-drag]';
  const startMoveOnFrame = (e: React.PointerEvent) => {
    if (!editing) return;
    const target = e.target as HTMLElement | null;
    if (target?.closest(INTERACTIVE_SELECTOR)) {
      onSelect();
      return;
    }
    startMove(e);
  };
  const startResize = (edge: ResizeEdge) => (e: React.PointerEvent) => {
    onSelect();
    const p = pointerToFraction(e);
    modeRef.current = { kind: 'resize', startX: p.x, startY: p.y, orig: rect, edge };
    force((n) => n + 1);
    e.preventDefault();
    e.stopPropagation();
  };

  return (
    <div
      ref={elRef}
      data-tile-id={id}
      onPointerDown={startMoveOnFrame}
      style={{
        position: 'absolute',
        // Contain every tile's INTERNAL z-indexes (0.9.12). The frame has no
        // z-index of its own, so without this it creates no stacking
        // context — and any positioned child with zIndex > 0 (the viz hero
        // stacks its overlay/lyrics/transport at zIndex 1–5) escapes into
        // the canvas-root context and paints ABOVE every z-auto sibling
        // tile regardless of DOM order. That defeated 0.9.8's paintOrder()
        // and was the real "new tiles still hide behind the visualizer"
        // mechanism. isolation creates the context with no other side
        // effects; sibling stacking is now purely DOM order again.
        isolation: 'isolate',
        // Render from the live rect while a gesture is in flight: an unrelated
        // App re-render mid-drag would otherwise snap the tile back to the
        // last committed rect.
        left: `${(liveRectRef.current ?? rect).x * 100}%`,
        top: `${(liveRectRef.current ?? rect).y * 100}%`,
        width: `${(liveRectRef.current ?? rect).w * 100}%`,
        height: `${(liveRectRef.current ?? rect).h * 100}%`,
        outline: editing && selected ? `2px solid ${accent}` : 'none',
        outlineOffset: 2,
        borderRadius: 14,
        boxShadow: editing && selected ? `0 0 0 1px ${accent}55, 0 0 40px -8px ${accent}aa` : 'none',
        transition: 'outline-color .12s, box-shadow .12s',
        userSelect: editing ? 'none' : 'auto',
        cursor: editing ? 'grab' : 'auto',
      }}
    >
      {children}
      {editing && (
        <>
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

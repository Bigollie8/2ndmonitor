// Drag support for the floating edit-mode panels (Properties, Layers).
// .ts, no JSX — the clamp math is unit-tested under the node test runner.
import { useRef, useState } from 'react';
import type React from 'react';

export interface PanelBaseRect { left: number; top: number; width: number; height: number }
export interface PanelOffset { x: number; y: number }

/** Clamp a drag offset so the panel stays inside the viewport. `base` is the
 *  panel's rect at zero offset (its CSS-anchored position). When the panel is
 *  larger than the viewport on an axis, the top/left edge wins so the drag
 *  handle (header) stays reachable. */
export function clampPanelOffset(
  desired: PanelOffset,
  base: PanelBaseRect,
  viewport: { w: number; h: number },
): PanelOffset {
  const minX = -base.left;
  const maxX = viewport.w - base.width - base.left;
  const minY = -base.top;
  const maxY = viewport.h - base.height - base.top;
  return {
    x: maxX < minX ? minX : Math.min(Math.max(desired.x, minX), maxX),
    y: maxY < minY ? minY : Math.min(Math.max(desired.y, minY), maxY),
  };
}

/** Makes a CSS-anchored panel draggable by its header. The panel keeps its
 *  normal anchored position (top/right/bottom/left) and the drag is applied
 *  as a translate() on top of it, so nothing about the default layout moves.
 *  Attach `panelRef` + `panelStyle` to the panel container and spread
 *  `handleProps` onto the header element. */
export function usePanelDrag(): {
  panelRef: React.RefObject<HTMLDivElement>;
  panelStyle: React.CSSProperties;
  handleProps: {
    onPointerDown: (e: React.PointerEvent<HTMLElement>) => void;
    style: React.CSSProperties;
    title: string;
  };
} {
  const panelRef = useRef<HTMLDivElement>(null);
  const [offset, setOffset] = useState<PanelOffset>({ x: 0, y: 0 });
  // The window pointermove listener must see the latest offset without being
  // re-bound per render — state alone would close over a stale value.
  const offsetRef = useRef(offset);

  const onPointerDown = (e: React.PointerEvent<HTMLElement>) => {
    if (e.button !== 0) return;
    // Clicks on interactive children of the header should not start a drag.
    if ((e.target as HTMLElement).closest('button, input, select, a')) return;
    const el = panelRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const start = { x: e.clientX, y: e.clientY };
    const startOffset = offsetRef.current;
    // rect includes the current translate; subtract it to get the anchored base.
    const base: PanelBaseRect = {
      left: rect.left - startOffset.x,
      top: rect.top - startOffset.y,
      width: rect.width,
      height: rect.height,
    };
    const move = (ev: PointerEvent) => {
      const next = clampPanelOffset(
        { x: startOffset.x + ev.clientX - start.x, y: startOffset.y + ev.clientY - start.y },
        base,
        { w: window.innerWidth, h: window.innerHeight },
      );
      offsetRef.current = next;
      setOffset(next);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    e.preventDefault();
  };

  return {
    panelRef,
    panelStyle: offset.x === 0 && offset.y === 0 ? {} : { transform: `translate(${offset.x}px, ${offset.y}px)` },
    handleProps: {
      onPointerDown,
      style: { cursor: 'grab', touchAction: 'none', userSelect: 'none' },
      title: 'Drag to move this panel',
    },
  };
}

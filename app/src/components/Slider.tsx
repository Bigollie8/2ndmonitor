import { useRef, useState, type MutableRefObject } from 'react';

export function Slider({
  value, disabled, dimmed, accent, accent2, onCommit, trackRef,
  throttleMs = 80,
}: {
  value: number;            // 0..1 from upstream state
  disabled: boolean;
  dimmed: boolean;          // muted — shown faded but still draggable
  accent: string;
  accent2: string;
  onCommit: (v: number) => void;
  trackRef?: MutableRefObject<HTMLDivElement | null>;
  throttleMs?: number;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const localTrackRef = useRef<HTMLDivElement | null>(null);
  const draggingRef = useRef(false);
  const lastCommitRef = useRef(0);
  const [drag, setDrag] = useState<number | null>(null);
  const display = drag ?? value;
  const pct = Math.max(0, Math.min(100, display * 100));

  const sample = (clientX: number): number => {
    const el = containerRef.current;
    if (!el) return display;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0) return display;
    return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  };

  const commit = (v: number, force: boolean) => {
    const now = performance.now();
    if (!force && now - lastCommitRef.current < throttleMs) return;
    lastCommitRef.current = now;
    onCommit(v);
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (disabled) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    draggingRef.current = true;
    const v = sample(e.clientX);
    setDrag(v);
    commit(v, true);
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    const v = sample(e.clientX);
    setDrag(v);
    commit(v, false);
  };
  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    e.currentTarget.releasePointerCapture(e.pointerId);
    draggingRef.current = false;
    const v = drag ?? value;
    commit(v, true);
    setDrag(null);
  };
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    let next = display;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') next = display - 0.05;
    else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') next = display + 0.05;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = 1;
    else return;
    e.preventDefault();
    next = Math.max(0, Math.min(1, next));
    setDrag(next);
    commit(next, true);
    window.setTimeout(() => setDrag(null), 250);
  };

  const filledRef = trackRef ?? localTrackRef;

  return (
    <div
      ref={containerRef}
      role="slider"
      aria-valuemin={0}
      aria-valuemax={1}
      aria-valuenow={display}
      tabIndex={disabled ? -1 : 0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onKeyDown={onKeyDown}
      style={{
        position: 'relative',
        height: 16,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.35 : (dimmed ? 0.55 : 1),
        outline: 'none',
        touchAction: 'none',
      }}
    >
      <div style={{
        position: 'absolute', left: 0, right: 0, top: '50%', transform: 'translateY(-50%)',
        height: 4, background: 'rgba(255,255,255,0.1)', borderRadius: 2, overflow: 'hidden',
      }}>
        <div ref={filledRef} style={{
          position: 'absolute', left: 0, top: 0, bottom: 0, width: `${pct}%`,
          background: `linear-gradient(90deg, ${accent2}, ${accent})`,
          borderRadius: 2,
          transition: drag === null ? 'width 0.18s linear' : 'none',
        }} />
      </div>
      <div style={{
        position: 'absolute', left: `${pct}%`, top: '50%',
        transform: 'translate(-50%,-50%)',
        width: 11, height: 11, background: '#fff', borderRadius: 999,
        boxShadow: `0 0 8px ${accent}`,
        transition: drag === null ? 'left 0.18s linear' : 'none',
        pointerEvents: 'none',
      }} />
    </div>
  );
}

import { useRef, useState, useEffect, type ReactNode } from 'react';

const MONO = '"JetBrains Mono", ui-monospace, monospace';

/** A horizontal, scrollable row of cards with arrow controls.
 *
 *  Used where a person's work is grouped by kind: a creator with 400 presets
 *  should not turn their profile into a wall you scroll past to reach
 *  anything else.
 *
 *  Native scrolling underneath, so a trackpad, a touch screen and a scroll
 *  wheel all work without JavaScript. The arrows are an addition for mouse
 *  users, and they hide themselves at each end rather than sitting there
 *  disabled. */
export function CardCarousel({ title, count, accent, children }: {
  title: string;
  count: number;
  accent: string;
  children: ReactNode;
}) {
  const scroller = useRef<HTMLDivElement | null>(null);
  const [atStart, setAtStart] = useState(true);
  const [atEnd, setAtEnd] = useState(false);

  const sync = () => {
    const el = scroller.current;
    if (!el) return;
    setAtStart(el.scrollLeft <= 2);
    // The 2px slack absorbs sub-pixel widths, which otherwise leave the
    // right arrow visible on a row that cannot scroll any further.
    setAtEnd(el.scrollLeft + el.clientWidth >= el.scrollWidth - 2);
  };

  useEffect(() => {
    sync();
    const el = scroller.current;
    if (!el) return;
    // Content can arrive after mount (a card image loading changes nothing,
    // but items resolving does), so re-measure on resize too.
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    return () => ro.disconnect();
  }, [count]);

  const nudge = (dir: 1 | -1) => {
    const el = scroller.current;
    if (!el) return;
    // Most of a screenful, not all of it: leaving one card visible keeps
    // your place instead of teleporting.
    el.scrollBy({ left: dir * el.clientWidth * 0.8, behavior: 'smooth' });
  };

  const arrow = (dir: 1 | -1, hidden: boolean) => (
    <button
      onClick={() => nudge(dir)}
      aria-label={dir === 1 ? `Scroll ${title} right` : `Scroll ${title} left`}
      style={{
        position: 'absolute', top: '50%', transform: 'translateY(-50%)',
        [dir === 1 ? 'right' : 'left']: -6,
        width: 28, height: 28, borderRadius: 999, zIndex: 2,
        display: hidden ? 'none' : 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(20,21,26,0.92)', color: 'rgba(255,255,255,0.8)',
        border: '1px solid rgba(255,255,255,0.14)', cursor: 'pointer',
        fontSize: 13, lineHeight: 1,
      }}
    >{dir === 1 ? '›' : '‹'}</button>
  );

  if (count === 0) return null;

  return (
    <div style={{ marginTop: 20 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 8 }}>
        <span style={{ fontSize: 12.5, fontWeight: 700, color: 'rgba(255,255,255,0.85)' }}>
          {title}
        </span>
        <span style={{ fontSize: 10, fontFamily: MONO, color: accent }}>{count}</span>
      </div>

      <div style={{ position: 'relative' }}>
        {arrow(-1, atStart)}
        <div
          ref={scroller}
          onScroll={sync}
          style={{
            display: 'flex', gap: 12, overflowX: 'auto', overflowY: 'hidden',
            scrollbarWidth: 'none', paddingBottom: 4,
            // Each card lands flush at the left edge after an arrow press.
            scrollSnapType: 'x proximity',
          }}
        >
          {children}
        </div>
        {arrow(1, atEnd)}
      </div>
    </div>
  );
}

import { useEffect, useLayoutEffect, useRef, useState, type MutableRefObject } from 'react';
import type { CatalogItem } from '../state/catalog';
import type { SpectrumState } from '../state/tauri';
import { gridWindowFor } from '../state/gridWindow';
import { MarketCard } from './MarketCard';

/** Card height used for the virtualization arithmetic. Not measured: a
 *  measured height would change as summaries wrap, and a window whose row
 *  height drifts mid-scroll is what makes a virtualized list stutter. The
 *  card's own content is clamped (2-line summary, fixed preview ratio) so
 *  this stays honest. */
const ROW_HEIGHT = 268;
const GAP = 12;

/** The windowed card grid.
 *
 *  `padTop` and `padBottom` spacers stand in for the rows outside the window,
 *  so the scrollbar reflects the full list — see gridWindow.ts's invariant
 *  test, which is what keeps the bar from jumping. */
export function MarketGrid({
  items, cardMin, accent, accent2, spectrumRef, appVersion, glyphOf,
  selectedIndex, onColumns, onOpen,
}: {
  items: CatalogItem[];
  cardMin: number;
  accent: string;
  accent2: string;
  spectrumRef?: MutableRefObject<SpectrumState>;
  appVersion: string;
  glyphOf: (item: CatalogItem) => string | null;
  /** Keyboard selection, owned by MarketView. `-1` for none. */
  selectedIndex: number;
  /** Reports the column count back up so arrow navigation uses the SAME
   *  value the window computed — two independently-derived column counts is
   *  how a selection and its layout drift apart. */
  onColumns: (n: number) => void;
  onOpen: (item: CatalogItem) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [size, setSize] = useState({ width: 0, height: 0 });

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const measure = () => setSize({ width: el.clientWidth, height: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const win = gridWindowFor({
    total: items.length,
    scrollTop,
    viewportHeight: size.height || 600,
    containerWidth: size.width || 1000,
    cardMin,
    rowHeight: ROW_HEIGHT,
    gap: GAP,
  });

  useEffect(() => { onColumns(win.columns); }, [win.columns, onColumns]);

  // Keep the keyboard selection on screen. `block: 'nearest'` scrolls the
  // minimum needed, so arrowing across a row does not yank the viewport.
  const selectedRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (selectedIndex >= 0) selectedRef.current?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  const slice = win.lastIndex < 0 ? [] : items.slice(win.firstIndex, win.lastIndex + 1);

  return (
    <div
      ref={scrollRef}
      onScroll={(e) => setScrollTop((e.target as HTMLDivElement).scrollTop)}
      style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', padding: '0 18px 18px' }}
    >
      <div style={{ height: win.padTop }} />
      <div style={{
        display: 'grid', gap: GAP,
        gridTemplateColumns: `repeat(${win.columns}, minmax(0, 1fr))`,
      }}>
        {slice.map((item, i) => {
          const index = win.firstIndex + i;
          const isSelected = index === selectedIndex;
          return (
            <div key={item.key} ref={isSelected ? selectedRef : undefined}>
              <MarketCard
                item={item}
                accent={accent}
                accent2={accent2}
                spectrumRef={spectrumRef}
                appVersion={appVersion}
                glyph={glyphOf(item)}
                selected={isSelected}
                onOpen={() => onOpen(item)}
              />
            </div>
          );
        })}
      </div>
      <div style={{ height: win.padBottom }} />
    </div>
  );
}

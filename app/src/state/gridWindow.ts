// ─────────────────────────────────────────────────────────────────────────────
// Which slice of a long card list to actually render.
//
// Pure module — no React, no DOM — so the arithmetic is node-testable.
//
// The catalog is 37 bundles today and a preset library is the case that
// demands this: `catalogRail.ts` gives presets one flat row, and a real
// MilkDrop pack is hundreds of entries. Mounting hundreds of cards, each with
// a preview fetch, is the same class of problem finding #31 recorded when six
// live sandboxes nearly crashed the marketplace on open.
// ─────────────────────────────────────────────────────────────────────────────

export interface GridWindow {
  firstIndex: number;
  /** Inclusive. `-1` when there is nothing to render. */
  lastIndex: number;
  /** Spacer height above the rendered rows, in px. */
  padTop: number;
  padBottom: number;
  columns: number;
}

export function gridWindowFor(args: {
  total: number;
  scrollTop: number;
  viewportHeight: number;
  containerWidth: number;
  cardMin: number;
  rowHeight: number;
  gap: number;
  overscanRows?: number;
}): GridWindow {
  const { total, scrollTop, viewportHeight, containerWidth, cardMin, rowHeight, gap } = args;
  const overscan = args.overscanRows ?? 2;

  // At least one column: a container narrower than one card still renders
  // that card rather than dividing by zero.
  const columns = Math.max(1, Math.floor((containerWidth + gap) / (cardMin + gap)));

  if (total <= 0) {
    return { firstIndex: 0, lastIndex: -1, padTop: 0, padBottom: 0, columns };
  }

  const stride = rowHeight + gap;
  const totalRows = Math.ceil(total / columns);
  const firstVisibleRow = Math.max(0, Math.floor(scrollTop / stride));
  const visibleRows = Math.ceil(viewportHeight / stride) + 1;

  const firstRow = Math.max(0, firstVisibleRow - overscan);
  const lastRow = Math.min(totalRows - 1, firstVisibleRow + visibleRows + overscan);

  const firstIndex = firstRow * columns;
  const lastIndex = Math.min(total - 1, (lastRow + 1) * columns - 1);

  // padTop + rendered + padBottom must equal the full scroll height exactly,
  // or the scrollbar jumps as the window moves.
  const padTop = firstRow * stride;
  const padBottom = Math.max(0, (totalRows - 1 - lastRow) * stride);

  return { firstIndex, lastIndex, padTop, padBottom, columns };
}

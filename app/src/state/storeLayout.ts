// ─────────────────────────────────────────────────────────────────────────────
// How the store arranges itself at a given window width.
//
// Pure module — no React, no DOM — so the breakpoints are node-testable
// without a browser.
//
// A full-bleed store cannot assume landscape: this app runs orientation-aware
// dashboards and a 1080x1920 portrait panel is a normal configuration. At
// 1080 wide, 180px of sidebar plus a 420px detail pane would leave 480px for
// the grid, so the sidebar goes rather than the content.
// ─────────────────────────────────────────────────────────────────────────────

export type LayoutMode = 'wide' | 'medium' | 'narrow';

export interface StoreLayout {
  mode: LayoutMode;
  showSidebar: boolean;
  sidebarWidth: number;
  /** Detail sits beside the grid and pushes it, rather than replacing it. */
  detailAsPane: boolean;
  detailWidth: number;
  /** `minmax()` floor for the card grid's auto-fill columns. */
  cardMin: number;
}

const WIDE = 1100;
const MEDIUM = 700;

export function storeLayoutFor(width: number): StoreLayout {
  if (width >= WIDE) {
    return {
      mode: 'wide', showSidebar: true, sidebarWidth: 180,
      detailAsPane: true, detailWidth: 420, cardMin: 210,
    };
  }
  if (width >= MEDIUM) {
    return {
      mode: 'medium', showSidebar: false, sidebarWidth: 0,
      detailAsPane: false, detailWidth: 0, cardMin: 230,
    };
  }
  // Below 700 a grid of 210px cards is one-and-a-bit columns of sliver. Wider
  // minimums mean one honest column instead.
  return {
    mode: 'narrow', showSidebar: false, sidebarWidth: 0,
    detailAsPane: false, detailWidth: 0, cardMin: 260,
  };
}

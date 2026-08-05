// ─────────────────────────────────────────────────────────────────────────────
// Deterministic creator avatars, generated from the handle.
//
// Pure module — no React, no Tauri, no network — so it is node-testable.
//
// Uploads were considered and cut. The machinery would be nearly free
// (`bundle_media` already does size caps, magic-byte sniffing and public
// serving) but IMAGE moderation is a materially worse job than text
// moderation on a service with strangers in it. A generated identicon gives
// everyone a distinct visual identity at zero moderation cost, and it can
// never be a slur, a logo, or a photograph of someone.
//
// Output is an inline SVG data URI so it needs no request and no CSP change:
// the app already renders `data:` images for bundle previews.
// ─────────────────────────────────────────────────────────────────────────────

/** FNV-1a. Small, fast, and — the point here — stable across machines and
 *  releases, so a creator's avatar does not change when they reopen the app.
 *  Not a security hash and never used as one. */
function hash(seed: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** Hue chosen from the hash, with saturation and lightness fixed so every
 *  avatar sits in the same tonal range as the app's dark chrome. A free hue
 *  would produce muddy browns and blinding yellows at random. */
function colours(h: number): { fg: string; bg: string } {
  const hue = h % 360;
  return {
    fg: `hsl(${hue} 62% 62%)`,
    bg: `hsl(${hue} 34% 17%)`,
  };
}

/** A 5x5 grid, mirrored left-to-right so the result reads as a face-like
 *  glyph rather than noise. Only the left three columns are decided; columns
 *  4 and 5 mirror columns 2 and 1. */
export function identiconCells(seed: string): boolean[][] {
  const h = hash(seed);
  const rows: boolean[][] = [];
  for (let y = 0; y < 5; y++) {
    const row: boolean[] = [];
    for (let x = 0; x < 3; x++) {
      // A distinct bit per cell. Re-hashing per position rather than reusing
      // one number keeps neighbouring seeds from producing near-identical
      // grids, which is what makes two handles look like each other.
      const bit = hash(`${seed}:${x}:${y}`) & 1;
      row.push(bit === 1);
    }
    rows.push([row[0], row[1], row[2], row[1], row[0]]);
    void h;
  }
  return rows;
}

/** An inline SVG data URI, ready for an `<img src>`. `size` is the rendered
 *  pixel size; the SVG itself is a 5-unit viewBox so it scales cleanly. */
export function identiconDataUri(seed: string, size = 64): string {
  const cells = identiconCells(seed || '?');
  const { fg, bg } = colours(hash(seed || '?'));
  let rects = '';
  for (let y = 0; y < 5; y++) {
    for (let x = 0; x < 5; x++) {
      if (cells[y][x]) rects += `<rect x="${x}" y="${y}" width="1" height="1"/>`;
    }
  }
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 5 5">`
    + `<rect width="5" height="5" fill="${bg}"/>`
    + `<g fill="${fg}">${rects}</g>`
    + `</svg>`;
  // encodeURIComponent rather than base64: the payload is small, it stays
  // human-readable in devtools, and it avoids pulling in a base64 shim.
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

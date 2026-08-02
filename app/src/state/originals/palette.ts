// ─────────────────────────────────────────────────────────────────────────────
// Palette plumbing for the original (first-party) MilkDrop presets. Colors are
// baked into preset JSON at build time — baseVals get 0..1 channels, shaders
// get vec3 literals — so no engine changes are needed to tint a preset.
// Node-testable: no tauri or DOM imports.
// ─────────────────────────────────────────────────────────────────────────────

export interface RGB { r: number; g: number; b: number }

/** Primary (a) and secondary (b) glow colors, 0..1 channels. */
export interface Palette { a: RGB; b: RGB }

/** Canonical Tron grid palette: cyan with orange as the antagonist accent. */
export const TRON_PALETTE: Palette = {
  a: { r: 0 / 255, g: 217 / 255, b: 255 / 255 },   // #00d9ff
  b: { r: 255 / 255, g: 140 / 255, b: 0 / 255 },   // #ff8c00
};

/** #rgb / #rrggbb → 0..1 channels. Falls back to `fallback` on anything else
 *  (the app accents are user-themable strings we don't control). */
export function hexToRgb01(hex: string, fallback: RGB): RGB {
  const m3 = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(hex);
  if (m3) {
    return {
      r: parseInt(m3[1] + m3[1], 16) / 255,
      g: parseInt(m3[2] + m3[2], 16) / 255,
      b: parseInt(m3[3] + m3[3], 16) / 255,
    };
  }
  const m6 = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (m6) {
    return {
      r: parseInt(m6[1], 16) / 255,
      g: parseInt(m6[2], 16) / 255,
      b: parseInt(m6[3], 16) / 255,
    };
  }
  return fallback;
}

/** App accent strings → preset palette; unparseable accents keep Tron colors. */
export function paletteFromAccents(accent: string, accent2: string): Palette {
  return {
    a: hexToRgb01(accent, TRON_PALETTE.a),
    b: hexToRgb01(accent2, TRON_PALETTE.b),
  };
}

/** RGB → GLSL vec3 literal, e.g. `vec3(0.0000,0.8510,1.0000)`. */
export function vec3(c: RGB): string {
  const f = (v: number) => v.toFixed(4);
  return `vec3(${f(c.r)},${f(c.g)},${f(c.b)})`;
}

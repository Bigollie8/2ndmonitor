// Liquid-glass surface tokens (0.6.6). Pure module — node-testable: nothing
// here touches `document` at import time; only applySurfaces does, when called.
//
// The four tokens are CSS custom properties stamped on :root when glass is ON:
//   --surface-canvas   app background            (glass-off literal: #06070a)
//   --surface-tile     tile panels               (rgba(22,24,30,0.78))
//   --surface-overlay  settings/library/galleries (rgba(20,22,28,0.9x) family)
//   --surface-chrome   top/bottom bars, floating panels (rgba(8,9,12,0.8x))
//
// When glass is OFF the properties are REMOVED. Every swept style is written
// as `background: 'var(--surface-X, <original literal>)'`, so with the tokens
// absent each site falls back to its exact pre-glass color — which is what
// makes glass-off pixel-identical to 0.6.5 by construction, with no color
// normalization anywhere.

export interface Surfaces {
  canvas: string;
  tile: string;
  overlay: string;
  chrome: string;
}

export const DEFAULT_GLASS_STRENGTH = 60;

const round2 = (x: number) => Math.round(x * 100) / 100;

/** Clamp to [0,100] and scale to [0,1]; a non-finite value (corrupt import)
 *  falls back to the default rather than producing rgba(...,NaN). */
function normalizedStrength(glassStrength: number): number {
  if (!Number.isFinite(glassStrength)) return DEFAULT_GLASS_STRENGTH / 100;
  return Math.min(100, Math.max(0, glassStrength)) / 100;
}

/** The four token values for the current glass settings, or null when glass
 *  is off (meaning: remove the tokens and let per-site fallbacks rule).
 *  Alphas are linear in strength, anchored so strength 60 gives the spec's
 *  canvas ~0.35 / tile ~0.5, strength 0 is near-clear glass, and strength 100
 *  is the most opaque frosted look (tile 0.74 ≈ today's opaque-ish 0.78). */
export function computeSurfaces(glassEnabled: boolean, glassStrength: number): Surfaces | null {
  if (!glassEnabled) return null;
  const f = normalizedStrength(glassStrength);
  return {
    canvas: `rgba(6,7,10,${round2(0.05 + 0.50 * f)})`,
    tile: `rgba(22,24,30,${round2(0.14 + 0.60 * f)})`,
    overlay: `rgba(20,22,28,${round2(0.55 + 0.35 * f)})`,
    chrome: `rgba(8,9,12,${round2(0.30 + 0.45 * f)})`,
  };
}

/** Acrylic tint alpha (0–1) sent to the `set_glass` command. 0 at strength 0 —
 *  the Rust side clears acrylic entirely then (spec: strength 0 = clear glass). */
export function glassTintAlpha(glassStrength: number): number {
  return round2(0.55 * normalizedStrength(glassStrength));
}

const VAR_NAMES: Record<keyof Surfaces, string> = {
  canvas: '--surface-canvas',
  tile: '--surface-tile',
  overlay: '--surface-overlay',
  chrome: '--surface-chrome',
};

/** Stamp (or remove) the tokens on :root. Also toggles `data-glass="1"` on
 *  <html>, which styles.css uses to make the page background transparent so
 *  the desktop can show through the transparent Tauri window. */
export function applySurfaces(surfaces: Surfaces | null): void {
  const root = document.documentElement;
  if (surfaces === null) {
    for (const name of Object.values(VAR_NAMES)) root.style.removeProperty(name);
    delete root.dataset.glass;
    return;
  }
  for (const key of Object.keys(VAR_NAMES) as (keyof Surfaces)[]) {
    root.style.setProperty(VAR_NAMES[key], surfaces[key]);
  }
  root.dataset.glass = '1';
}

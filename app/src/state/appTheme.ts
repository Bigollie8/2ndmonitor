// Application-wide surface themes (0.9.7) — "surface becomes a setting".
//
// Built to the shared "Ficus Dashboard Redesign" mock (One dashboard, four
// surfaces): the whole interface restyles through CSS custom properties, not
// per-widget colors. The four --surface-* tokens are the SAME ones liquid
// glass has stamped since 0.6.6, so every swept style site already reads
// them with its pre-theme literal as fallback:
//
//   theme OFF ('default')  → tokens removed → per-site fallbacks → today's
//                            exact look, pixel-identical by construction
//   theme ON               → tokens stamped → every surface restyles at once
//   glass ON               → glass's translucent surface values WIN over the
//                            theme's (glass is "the layer above", and its
//                            see-through alphas are the whole point) — the
//                            theme's hairline/display tokens still apply
//
// Two new tokens extend the set:
//   --hairline       border/rule color for tile edges, bar borders, dividers
//   --font-display   display type for hero numerals/titles (the Editorial
//                    surface's serif signature)
//
// Values are derived from the mock's rendered pixels — the design doc ships
// no explicit hex table. The mock's fourth surface, Paper (light), is NOT
// shipped yet: ~1100 inline white-alpha text styles must move to text
// tokens before a light ground is honest; that migration is its own task.
//
// Pure module: nothing touches `document` at import time (node-testable),
// mirroring state/theme.ts.

export type SurfaceThemeId = 'default' | 'editorial' | 'frameless';

export interface SurfaceThemeTokens {
  canvas: string;
  tile: string;
  overlay: string;
  chrome: string;
  hairline: string;
  /** null = keep each site's own font (only Editorial carries a serif). */
  displayFont: string | null;
}

export interface SurfaceThemeDef {
  label: string;
  hint: string;
  /** null = stamp nothing; per-site fallbacks rule (today's look). */
  tokens: SurfaceThemeTokens | null;
}

export const SURFACE_THEMES: Record<SurfaceThemeId, SurfaceThemeDef> = {
  default: {
    label: 'Hub',
    hint: 'The classic look — unchanged',
    tokens: null,
  },
  editorial: {
    // The mock's 3a synthesis, the design's "recommended default": ink-black
    // ground with a green undertone, ruled hairlines in warm paper-grey, and
    // a serif voice for display numerals ("Weightless", 14:32, 18°).
    label: 'Editorial',
    hint: 'Ink ground, ruled hairlines, serif display — the Ficus look',
    tokens: {
      canvas: '#0a0b09',
      tile: 'rgba(15,17,13,0.92)',
      overlay: 'rgba(13,15,11,0.97)',
      chrome: 'rgba(10,11,9,0.9)',
      hairline: 'rgba(216,211,196,0.14)',
      displayFont: 'Georgia, "Times New Roman", "Songti SC", serif',
    },
  },
  frameless: {
    // The mock's 2a surface: card edges removed entirely — content sits on
    // the ground and grouping is done with air alone.
    label: 'Frameless',
    hint: 'No card edges — content floats on the ground, grouped by air',
    tokens: {
      canvas: '#07080a',
      tile: 'rgba(7,8,10,0)',
      overlay: 'rgba(13,15,19,0.97)',
      chrome: 'rgba(7,8,10,0.55)',
      hairline: 'rgba(255,255,255,0)',
      displayFont: null,
    },
  },
};

/** Corrupt/unknown persisted value → 'default', never a crash or a blank.
 *  hasOwnProperty, not `in`: persisted JSON can hand us '__proto__' or
 *  'constructor', which `in` accepts via the prototype chain. */
export function resolveSurfaceTheme(v: unknown): SurfaceThemeId {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(SURFACE_THEMES, v)
    ? (v as SurfaceThemeId)
    : 'default';
}

const SURFACE_VARS = ['--surface-canvas', '--surface-tile', '--surface-overlay', '--surface-chrome'] as const;

/** Stamp the theme's tokens on :root. `glassActive` = glass currently owns
 *  the four surface vars (state/theme.ts stamps them after this runs) — the
 *  theme then leaves surfaces alone and contributes only hairline/display.
 *  DOM-touching by design; callers are effects. */
export function applySurfaceTheme(id: SurfaceThemeId, glassActive: boolean): void {
  const root = document.documentElement;
  const tokens = SURFACE_THEMES[id].tokens;
  if (!tokens) {
    if (!glassActive) for (const v of SURFACE_VARS) root.style.removeProperty(v);
    root.style.removeProperty('--hairline');
    root.style.removeProperty('--font-display');
    delete root.dataset.surfaceTheme;
    return;
  }
  if (!glassActive) {
    root.style.setProperty('--surface-canvas', tokens.canvas);
    root.style.setProperty('--surface-tile', tokens.tile);
    root.style.setProperty('--surface-overlay', tokens.overlay);
    root.style.setProperty('--surface-chrome', tokens.chrome);
  }
  root.style.setProperty('--hairline', tokens.hairline);
  if (tokens.displayFont) root.style.setProperty('--font-display', tokens.displayFont);
  else root.style.removeProperty('--font-display');
  root.dataset.surfaceTheme = id;
}

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
  // ── Material language (0.9.8) ─────────────────────────────────────────
  // Three more axes so each theme reads as its own design system rather
  // than a recolor: corner language, backdrop treatment, and elevation.
  // Stamped as --tile-radius / --tile-blur / --tile-shadow; the shared
  // card sites (HFTile, the viz hero shell) read them with today's Hub
  // values as fallbacks, so 'default' stays pixel-identical.
  /** Corner radius for cards, e.g. '14px'. Sharp = print, round = soft. */
  tileRadius: string;
  /** backdrop-filter behind card surfaces ('none' for opaque materials). */
  tileBlur: string;
  /** Resting card elevation ('none' for flat systems). */
  tileShadow: string;
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
    // A printed page in ink: near-opaque flat cards (no glassy blur — ink
    // doesn't shimmer), corners cropped nearly square, NO elevation — the
    // warm ruled hairlines carry all the structure, and display numerals
    // speak serif. The whole system is "set in print", not "recolored dark".
    label: 'Editorial',
    hint: 'Set in print — flat ink cards, ruled hairlines, serif display, square corners',
    tokens: {
      canvas: '#0a0b09',
      tile: 'rgba(15,17,13,0.97)',
      overlay: 'rgba(13,15,11,0.97)',
      chrome: 'rgba(10,11,9,0.9)',
      hairline: 'rgba(216,211,196,0.16)',
      displayFont: 'Georgia, "Times New Roman", "Songti SC", serif',
      tileRadius: '3px',
      tileBlur: 'none',
      tileShadow: 'none',
    },
  },
  frameless: {
    // The opposite pole: no card material at all. Content sits directly on
    // a deep blue-black ground, grouped by air; edges, rules, blur, and
    // shadows all go to zero. The round radius only survives on overlays
    // (pickers, settings), which keep their own surface.
    label: 'Frameless',
    hint: 'No cards at all — content floats on the ground, grouped by air',
    tokens: {
      canvas: '#07080a',
      tile: 'rgba(7,8,10,0)',
      overlay: 'rgba(13,15,19,0.97)',
      chrome: 'rgba(7,8,10,0.55)',
      hairline: 'rgba(255,255,255,0)',
      displayFont: null,
      tileRadius: '18px',
      tileBlur: 'none',
      tileShadow: 'none',
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
    root.style.removeProperty('--tile-radius');
    root.style.removeProperty('--tile-blur');
    root.style.removeProperty('--tile-shadow');
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
  root.style.setProperty('--tile-radius', tokens.tileRadius);
  // Blur IS the glass material — a theme's 'none' would flatten liquid
  // glass into plain translucency, so glass keeps the blur fallback while
  // active. Radius and elevation compose fine with glass and stay themed.
  if (glassActive) root.style.removeProperty('--tile-blur');
  else root.style.setProperty('--tile-blur', tokens.tileBlur);
  root.style.setProperty('--tile-shadow', tokens.tileShadow);
  root.dataset.surfaceTheme = id;
}

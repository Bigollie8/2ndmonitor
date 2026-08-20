import type { Track, Density, AccentTheme } from './types';

export const TRACKS: Track[] = [
  {
    title: 'Midnight City', artist: 'M83', album: "Hurry Up, We're Dreaming",
    cover: 'linear-gradient(135deg, #f97316, #ec4899)',
    accent: '#fb923c', accent2: '#ec4899',
  },
  {
    title: 'Strobe', artist: 'deadmau5', album: 'For Lack of a Better Name',
    cover: 'linear-gradient(135deg, #1e3a8a, #06b6d4)',
    accent: '#06b6d4', accent2: '#3b82f6',
  },
  {
    title: 'Time', artist: 'Hans Zimmer', album: 'Inception OST',
    cover: 'linear-gradient(135deg, #1f2937, #6b7280)',
    accent: '#94a3b8', accent2: '#cbd5e1',
  },
  {
    title: 'Lateralus', artist: 'TOOL', album: 'Lateralus',
    cover: 'linear-gradient(135deg, #7c2d12, #facc15)',
    accent: '#facc15', accent2: '#f59e0b',
  },
  {
    title: 'Resonance', artist: 'HOME', album: 'Odyssey',
    cover: 'linear-gradient(135deg, #be185d, #6d28d9)',
    accent: '#a78bfa', accent2: '#ec4899',
  },
];

export interface DensitySpec {
  gap: number;
  pad: number;
  headerPad: number;
  fontTitle: number;
  fontBody: number;
}

export function getDensity(d: Density): DensitySpec {
  if (d === 'compact')  return { gap: 10, pad: 10, headerPad: 8,  fontTitle: 11, fontBody: 11 };
  if (d === 'spacious') return { gap: 18, pad: 16, headerPad: 12, fontTitle: 13, fontBody: 13 };
  return                       { gap: 14, pad: 13, headerPad: 10, fontTitle: 12, fontBody: 12 };
}

export interface PaletteSpec {
  label: string;
  accent?: string;
  accent2?: string;
}

export const ACCENT_PALETTES: Record<AccentTheme, PaletteSpec> = {
  auto:   { label: 'Theme-linked' },
  mint:   { label: 'Mint',   accent: '#7cf5d4', accent2: '#a78bfa' },
  coral:  { label: 'Coral',  accent: '#fb7185', accent2: '#facc15' },
  indigo: { label: 'Indigo', accent: '#818cf8', accent2: '#06b6d4' },
  amber:  { label: 'Amber',  accent: '#fbbf24', accent2: '#fb7185' },
  // Sage + amber from the Ficus Editorial mock (0.9.7) — pairs with the
  // Editorial surface theme but works on any surface.
  ficus:  { label: 'Ficus',  accent: '#9db98a', accent2: '#d9a05b' },
  // Glass Cyan + Iris Violet — the Glasswing brand pair (0.9.13). 'auto'
  // stays the default: the design system's own rule is that accent is an
  // input that follows what's playing.
  glasswing: { label: 'Glasswing', accent: '#5FD2E0', accent2: '#8C9CF2' },
};

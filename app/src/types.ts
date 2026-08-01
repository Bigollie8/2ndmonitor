export type Density = 'compact' | 'regular' | 'spacious';
/** Styles compiled into the binary. The fifteen DOM/canvas styles that used to
 *  be listed here are now marketplace bundles (`bundle:bars` and friends) —
 *  deliberately dropped from the union rather than kept "just in case", so any
 *  code still naming one is a compile error instead of a runtime blank frame. */
export type BuiltinVizMode = 'milkdrop' | 'scripted';

/** A selected style: a built-in, or an installed marketplace bundle. Bundle
 *  ids are namespaced so they can never collide with a built-in. */
export type VizMode = BuiltinVizMode | `bundle:${string}`;
export interface Profile {
  /** Stable id (UUID). Used for activeProfileId references. */
  id: string;
  /** User-editable display name, e.g. "Work". */
  name: string;
  /** Hex color used as accent in the switcher card and top-chrome button. */
  color: string;
  /** Landscape-orientation layout + visibility (active when viewport is wider than tall). */
  landscape: import('./state/layout').OrientationLayout;
  /** Portrait-orientation layout + visibility (active when viewport is taller than wide). */
  portrait: import('./state/layout').OrientationLayout;
}
export type AccentTheme = 'auto' | 'mint' | 'coral' | 'indigo' | 'amber';

export interface Track {
  title: string;
  artist: string;
  album: string;
  cover: string;
  accent: string;
  accent2: string;
}

export interface Tweaks {
  vizMode: VizMode;
  accentTheme: AccentTheme;
  density: Density;
}

export interface AppMetrics {
  cpu: number;     // % CPU used by THIS app's process tree (can exceed 100 on multicore)
  ram_mb: number;  // resident memory in MB across the app's process tree
  /** GPU usage % for this app via NVML per-process sampling. null on AMD/Intel. */
  gpu: number | null;
}

export interface SysmonSample {
  cpu: number;
  ram: number;
  gpu: number;
  net: number;
  cpu_pct_text: string;
  ram_text: string;
  gpu_pct_text: string;
  net_text: string;
  cpu_sub: string;
  ram_sub: string;
  gpu_sub: string;
  net_sub: string;
  top: { name: string; cpu: number }[];
  app: AppMetrics | null;
}

export interface SysmonHistory {
  cpu: number[];
  ram: number[];
  gpu: number[];
  net: number[];
  latest: SysmonSample;
}

export interface Todo { id: string; text: string; done: boolean; createdAt: number }

export interface WeatherLocation { label: string; lat: number; lon: number }

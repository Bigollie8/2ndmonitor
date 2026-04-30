export type Density = 'compact' | 'regular' | 'spacious';
export type VizMode =
  | 'bars' | 'waveform' | 'radial' | 'particles' | 'ambient'
  | 'neonbars' | 'splitmirror' | 'circular' | 'tunnel' | 'pixelled'
  | 'ribbon' | 'scope' | 'spectrogram' | 'vinyl' | 'kaleidoscope'
  | 'freqgrid' | 'minimal'
  | 'starfield' | 'perlin' | 'orbital' | 'aurora' | 'city'
  | 'strings' | 'hud' | 'liquid' | 'cassette' | 'constellation';
export interface Profile {
  /** Stable id (UUID). Used for activeProfileId references. */
  id: string;
  /** User-editable display name, e.g. "Work". */
  name: string;
  /** Hex color used as accent in the switcher card and top-chrome button. */
  color: string;
  /** Tile rectangles for this profile. Empty = use DEFAULT_LAYOUT. */
  layout: import('./state/layout').Layout;
  /** Tile visibility map. */
  hidden: Partial<Record<import('./state/layout').TileId, boolean>>;
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
  cpu: number;     // % CPU used by THIS app's process (can exceed 100 on multicore)
  ram_mb: number;  // resident memory in MB
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

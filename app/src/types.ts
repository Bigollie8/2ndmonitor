export type Density = 'compact' | 'regular' | 'spacious';
export type VizMode = 'bars' | 'waveform' | 'radial' | 'particles' | 'ambient';
export type Profile = 'work' | 'gaming' | 'chill';
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
}

export interface SysmonHistory {
  cpu: number[];
  ram: number[];
  gpu: number[];
  net: number[];
  latest: SysmonSample;
}

export interface Todo { id: string; text: string; done: boolean; createdAt: number }

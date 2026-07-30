import type { VizMode } from '../types';

/** Pure data describing every visualizer style. Kept in its own module (no
 *  React, no canvas code) so consumers that only need the id/label/desc list
 *  — App.tsx's 'V' cycle shortcut, Settings' dropdown, Stream Deck actions —
 *  don't statically pull in viz-gallery.tsx (which renders ~27 live canvases
 *  and is otherwise lazy-loaded only when the gallery overlay opens). */
export type VizCategory = 'spectrum' | 'wave' | 'ambient' | 'scene' | 'engine';

export interface VizStyle { id: VizMode; label: string; desc: string; category: VizCategory }

export const BUILTIN_VIZ_STYLES: VizStyle[] = [
  { id: 'bars',         label: 'Bars',           desc: 'Classic spectrum analyzer',      category: 'spectrum' },
  { id: 'waveform',     label: 'Waveform',       desc: 'Smooth oscilloscope',            category: 'wave' },
  { id: 'radial',       label: 'Radial',         desc: 'Circular spectrum',              category: 'spectrum' },
  { id: 'particles',    label: 'Particles',      desc: 'Drifting points',                category: 'ambient' },
  { id: 'ambient',      label: 'Ambient',        desc: 'Slow morphing blobs',            category: 'ambient' },
  { id: 'neonbars',     label: 'Neon bars',      desc: 'Glowing solid bars',             category: 'spectrum' },
  { id: 'splitmirror',  label: 'Split mirror',   desc: 'Mirrored bars on a horizon',     category: 'spectrum' },
  { id: 'circular',     label: 'Circular pulse', desc: 'Radial w/ bass disc',            category: 'spectrum' },
  { id: 'tunnel',       label: 'Wave tunnel',    desc: 'Layered depth waveforms',        category: 'wave' },
  { id: 'pixelled',     label: 'Pixel LED',      desc: 'Retro LED matrix · heatmap',     category: 'spectrum' },
  { id: 'ribbon',       label: 'Ribbon',         desc: 'Filled symmetric flow',          category: 'wave' },
  { id: 'vinyl',        label: 'Vinyl',          desc: 'Spinning record',                category: 'scene' },
  { id: 'kaleidoscope', label: 'Kaleidoscope',   desc: 'Symmetric petals',               category: 'scene' },
  { id: 'freqgrid',     label: 'Freq grid',      desc: 'Time × frequency cells',         category: 'spectrum' },
  { id: 'minimal',      label: 'Minimal dots',   desc: 'Bass / Mid / Treble pulse',      category: 'ambient' },
  { id: 'milkdrop',     label: 'MilkDrop',       desc: 'Butterchurn · MilkDrop 2 presets', category: 'engine' },
  { id: 'scripted',     label: 'Scripted',       desc: 'Your JS visualizers · sandboxed', category: 'engine' },
];

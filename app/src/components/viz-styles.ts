import type { VizMode } from '../types';

/** Pure data describing every visualizer style. Kept in its own module (no
 *  React, no canvas code) so consumers that only need the id/label/desc list
 *  — App.tsx's 'V' cycle shortcut, Settings' dropdown, Stream Deck actions —
 *  don't statically pull in viz-gallery.tsx (which renders ~27 live canvases
 *  and is otherwise lazy-loaded only when the gallery overlay opens). */
export interface VizStyle { id: VizMode; label: string; desc: string }

export const BUILTIN_VIZ_STYLES: VizStyle[] = [
  { id: 'bars',         label: 'Bars',         desc: 'Classic spectrum analyzer' },
  { id: 'waveform',     label: 'Waveform',     desc: 'Smooth oscilloscope' },
  { id: 'radial',       label: 'Radial',       desc: 'Circular spectrum' },
  { id: 'particles',    label: 'Particles',    desc: 'Drifting points' },
  { id: 'ambient',      label: 'Ambient',      desc: 'Slow morphing blobs' },
  { id: 'neonbars',     label: 'Neon bars',    desc: 'Glowing solid bars' },
  { id: 'splitmirror',  label: 'Split mirror', desc: 'Mirrored bars on a horizon' },
  { id: 'circular',     label: 'Circular pulse', desc: 'Radial w/ bass disc' },
  { id: 'tunnel',       label: 'Wave tunnel',  desc: 'Layered depth waveforms' },
  { id: 'pixelled',     label: 'Pixel LED',    desc: 'Retro LED matrix · heatmap' },
  { id: 'ribbon',       label: 'Ribbon',       desc: 'Filled symmetric flow' },
  { id: 'scope',        label: 'Oscilloscope', desc: 'CRT phosphor trace' },
  { id: 'spectrogram',  label: 'Spectrogram',  desc: 'Scrolling waterfall' },
  { id: 'vinyl',        label: 'Vinyl',        desc: 'Spinning record' },
  { id: 'kaleidoscope', label: 'Kaleidoscope', desc: 'Symmetric petals' },
  { id: 'freqgrid',     label: 'Freq grid',    desc: 'Time × frequency cells' },
  { id: 'minimal',      label: 'Minimal dots', desc: 'Bass / Mid / Treble pulse' },
  { id: 'starfield',    label: 'Starfield',    desc: 'Hyperspace · kick-flash bursts' },
  { id: 'perlin',       label: 'Perlin flow',  desc: 'Noise-field particles · drifting' },
  { id: 'orbital',      label: 'Orbital',      desc: 'Sun + 4 reactive frequency rings' },
  { id: 'aurora',       label: 'Aurora',       desc: 'Veils over moonlit horizon' },
  { id: 'city',         label: 'Neon city',    desc: 'Skyline w/ frequency-lit windows' },
  { id: 'strings',      label: 'Strings',      desc: 'Plucked physical strings' },
  { id: 'hud',          label: 'Aircraft HUD', desc: 'Reticle · pitch ladder · tapes' },
  { id: 'liquid',       label: 'Liquid',       desc: 'Metaball lava · bass merges' },
  { id: 'cassette',     label: 'Cassette',     desc: 'Tape deck · reels · VU meters' },
  { id: 'constellation', label: 'Constellation', desc: 'Particles connect when near' },
  { id: 'milkdrop',     label: 'MilkDrop',     desc: 'Butterchurn · MilkDrop 2 presets' },
  { id: 'scripted',     label: 'Scripted',     desc: 'Your JS visualizers · sandboxed' },
];

/** @deprecated Use `useVizStyles()` for anything user-facing — it includes
 *  installed bundles. This alias covers call sites that only need builtins. */
export const VIZ_STYLES = BUILTIN_VIZ_STYLES;

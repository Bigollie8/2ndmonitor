import type { VizMode } from '../types';

/** Pure data describing every visualizer style. Kept in its own module (no
 *  React, no canvas code) so consumers that only need the id/label/desc list
 *  — App.tsx's 'V' cycle shortcut, Settings' dropdown, Stream Deck actions —
 *  don't statically pull in viz-gallery.tsx (which renders ~27 live canvases
 *  and is otherwise lazy-loaded only when the gallery overlay opens). */
export type VizCategory = 'spectrum' | 'wave' | 'ambient' | 'scene' | 'engine';

export interface VizStyle { id: VizMode; label: string; desc: string; category: VizCategory }

/** The styles compiled into the binary. Only the two engines remain: every
 *  other style now ships as a marketplace bundle in `bundles/<id>/`, seeded
 *  into app resources and installed on first run (see
 *  `RETIRED_BUILTIN_VIZ_MODES` in state/contentRegistry.ts for the remap that
 *  carries an existing user's saved selection across).
 *
 *  `milkdrop` and `scripted` are first-party forever (state/firstParty.ts):
 *  one hosts a bundled preset library, the other IS the sandbox surface that
 *  runs bundles. Neither can be expressed as a bundle. The remaining
 *  `VizCategory` values ('spectrum' | 'wave' | 'ambient' | 'scene') stay in
 *  the type — installed bundles and index entries are still filed under them
 *  in the content library's category rail. */
export const BUILTIN_VIZ_STYLES: VizStyle[] = [
  { id: 'milkdrop',     label: 'MilkDrop',       desc: 'Butterchurn · MilkDrop 2 presets', category: 'engine' },
  { id: 'scripted',     label: 'Scripted',       desc: 'Your JS visualizers · sandboxed', category: 'engine' },
];

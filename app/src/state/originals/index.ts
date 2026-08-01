// ─────────────────────────────────────────────────────────────────────────────
// Registry of original (first-party) MilkDrop presets — the Tron/Grid set.
// Each build(palette) bakes colors into fresh preset JSON; callers pass the
// canonical TRON_PALETTE or one derived from the app accents (tint mode).
// ─────────────────────────────────────────────────────────────────────────────
import type { OriginalPreset } from './base';
import type { Palette } from './palette';
import { build as tronGrid } from './tron-grid';
import { build as tronCity } from './tron-city';
import { build as tronCycles } from './tron-cycles';
import { build as tronDerezz } from './tron-derezz';
import { build as tronRecognizer } from './tron-recognizer';
import { build as tronIo } from './tron-io';

export interface OriginalDef {
  id: string;
  label: string;
  build: (palette: Palette) => OriginalPreset;
}

export const ORIGINALS: OriginalDef[] = [
  { id: 'tron-grid', label: 'The Grid', build: tronGrid },
  { id: 'tron-city', label: 'Tron City', build: tronCity },
  { id: 'tron-cycles', label: 'Light Cycles', build: tronCycles },
  { id: 'tron-derezz', label: 'Derezzed', build: tronDerezz },
  { id: 'tron-recognizer', label: 'Recognizer', build: tronRecognizer },
  { id: 'tron-io', label: 'I/O Beam', build: tronIo },
];

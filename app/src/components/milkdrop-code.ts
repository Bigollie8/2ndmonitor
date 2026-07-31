// The builtin MilkDrop visualizer's frame code: butterchurn + its preset pack
// as raw UMD text, then the glue. Evaluated inside the viz sandbox iframe via
// the standard init `new Function(code)` path — the ONLY place these
// libraries may run: butterchurn compiles preset equations with new Function,
// which the main window's pinned CSP (script-src 'self') forbids in packaged
// builds. Do not import butterchurn as a module anywhere in the app document.
//
// NOT node-importable (`?raw` is a Vite resolver feature) — tests source-scan
// this file instead (see sandbox/milkdrop-glue.test.ts).
import butterchurnSrc from 'butterchurn/lib/butterchurn.min.js?raw';
import presetPackSrc from 'butterchurn-presets/lib/butterchurnPresets.min.js?raw';
import { MILKDROP_GLUE } from '../sandbox/milkdrop-glue';

export const MILKDROP_FRAME_CODE = [butterchurnSrc, presetPackSrc, MILKDROP_GLUE].join('\n;\n');

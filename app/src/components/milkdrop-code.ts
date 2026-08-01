// The builtin MilkDrop visualizer's frame code: butterchurn + a starter
// preset pack as raw text, then the glue. Evaluated inside the viz sandbox
// iframe via the standard init `new Function(code)` path — the ONLY place
// these libraries may run: butterchurn compiles preset equations with new
// Function, which the main window's pinned CSP (script-src 'self') forbids
// in packaged builds. Do not import butterchurn as a module anywhere in the
// app document.
//
// NOT node-importable (`?raw` is a Vite resolver feature) — tests source-scan
// this file instead (see sandbox/milkdrop-glue.test.ts).
import butterchurnSrc from 'butterchurn/lib/butterchurn.min.js?raw';
import starterPackJson from './milkdrop-starter-pack.json?raw';
import { MILKDROP_GLUE } from '../sandbox/milkdrop-glue';

// Starter pack replaces the full 654 KB butterchurn-presets UMD (the rest of
// the pack now ships as individual marketplace preset items). Same
// window.butterchurnPresets.getPresets() surface the glue has always read.
const starterPackSrc =
  'window.butterchurnPresets={getPresets:function(){return (' + starterPackJson + ')}}';

export const MILKDROP_FRAME_CODE = [butterchurnSrc, starterPackSrc, MILKDROP_GLUE].join('\n;\n');

// scripts/extract-presets.mjs
// One-shot extraction: turns the six butterchurn-presets UMD packs (still an
// app devDependency, used only as the extraction source — not shipped) into:
//   - app/src/components/milkdrop-starter-pack.json — the 12 STARTER presets,
//     inlined as the app's slimmed built-in pack (see milkdrop-code.ts).
//   - bundles-presets/<slug>/{manifest.json,preset.json} — every other
//     deduped preset, one folder per marketplace item (kind "preset").
//   - bundles-presets/extract-report.json — a summary for eyeballing.
//
//   node scripts/extract-presets.mjs
//
// Run from the repo root (paths below are relative to this file's location).
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const LIB_DIR = join(ROOT, 'app', 'node_modules', 'butterchurn-presets', 'lib');
const STARTER_PACK_OUT = join(ROOT, 'app', 'src', 'components', 'milkdrop-starter-pack.json');
const STAGE_DIR = join(ROOT, 'bundles-presets');

// Pack priority for name collisions across packs: earlier wins.
const PACKS = [
  { file: 'butterchurnPresets.min.js', label: 'butterchurnPresets' },
  { file: 'butterchurnPresetsExtra.min.js', label: 'Extra' },
  { file: 'butterchurnPresetsExtra2.min.js', label: 'Extra2' },
  { file: 'butterchurnPresetsMD1.min.js', label: 'MD1' },
  { file: 'butterchurnPresetsNonMinimal.min.js', label: 'NonMinimal' },
  { file: 'butterchurnPresetsMinimal.min.js', label: 'Minimal' },
];

// Exactly 12 keys copied verbatim from Object.keys(getPresets()) on the base
// pack (butterchurnPresets.min.js) — recognizable, varied authors. These ship
// inline as the app's built-in starter pack and are NOT staged to
// bundles-presets/ (a later pipeline task may swap entries after checking
// they render).
const STARTER = [
  '_Geiss - Artifact 01',
  '_Geiss - Desert Rose 2',
  '_Geiss - untitled',
  'flexi + amandio c - organic [random mashup]',
  'Flexi + Martin - astral projection',
  'Flexi + Martin - cascading decay swing',
  'Rovastar - Oozing Resistance',
  'Unchained - Rewop',
  'Unchained - Unified Drag 2',
  'Eo.S. + Phat - cubetrace - v2',
  'Aderrasi - Potion of Spirits',
  'shifter - dark tides bdrv mix 2',
];

function loadPack(file) {
  const m = require(join(LIB_DIR, file));
  const P = m.default ?? m;
  return P.getPresets ? P.getPresets() : P;
}

/** JSON-round-trip gate: preset values in these packs are plain data (equation
 *  strings like init_eqs_str), not functions, so a clean preset survives
 *  JSON.parse(JSON.stringify(p)) with the same key count. Anything that
 *  doesn't is skipped rather than silently truncated. */
function isJsonRoundTrippable(preset) {
  let copy;
  try {
    copy = JSON.parse(JSON.stringify(preset));
  } catch {
    return false;
  }
  return Object.keys(copy).length === Object.keys(preset).length;
}

function slugify(name, used) {
  let base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  if (!base) base = 'preset';
  let slug = base;
  let n = 2;
  while (used.has(slug)) {
    slug = `${base}-${n}`.slice(0, 64);
    n++;
  }
  used.add(slug);
  return slug;
}

function authorFromName(name) {
  const i = name.indexOf(' - ');
  return i === -1 ? '' : name.slice(0, i).trim();
}

function main() {
  // 1. Load all six packs.
  const packs = PACKS.map(({ file, label }) => ({ label, presets: loadPack(file) }));

  const basePack = packs[0].presets;
  const baseKeys = new Set(Object.keys(basePack));
  for (const name of STARTER) {
    if (!baseKeys.has(name)) {
      throw new Error(`STARTER name not found in base pack: ${JSON.stringify(name)}`);
    }
    if (!isJsonRoundTrippable(basePack[name])) {
      throw new Error(`STARTER name not JSON-round-trippable: ${JSON.stringify(name)}`);
    }
  }

  // 2. Dedupe by normalized name (trimmed, exact string match — presets are
  //    keyed by their full display name across all six packs) with pack
  //    priority: earlier entries in PACKS win a collision.
  const byName = new Map(); // name -> { preset, pack }
  let total = 0;
  for (const { label, presets } of packs) {
    for (const [name, preset] of Object.entries(presets)) {
      total++;
      if (!byName.has(name)) byName.set(name, { preset, pack: label });
    }
  }
  const unique = byName.size;

  // 3. Split into starters (inlined) vs. staged (marketplace items).
  const starterPack = {};
  for (const name of STARTER) starterPack[name] = basePack[name];

  const skipped = [];
  const usedSlugs = new Set();
  let staged = 0;

  mkdirSync(STAGE_DIR, { recursive: true });

  for (const [name, { preset }] of byName) {
    if (STARTER.includes(name)) continue; // starters are not staged
    if (!isJsonRoundTrippable(preset)) {
      skipped.push({ name, reason: 'not JSON-serializable' });
      continue;
    }
    const json = JSON.parse(JSON.stringify(preset));
    const slug = slugify(name, usedSlugs);
    const dir = join(STAGE_DIR, slug);
    mkdirSync(dir, { recursive: true });
    const manifest = {
      id: slug,
      name: name.slice(0, 120),
      author: authorFromName(name),
      version: '1.0.0',
      api: 1,
      permissions: [],
    };
    writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
    writeFileSync(join(dir, 'preset.json'), JSON.stringify(json, null, 2) + '\n');
    staged++;
  }

  // 4. Write the starter pack (used verbatim by milkdrop-code.ts via ?raw)
  //    and the extraction report.
  mkdirSync(dirname(STARTER_PACK_OUT), { recursive: true });
  writeFileSync(STARTER_PACK_OUT, JSON.stringify(starterPack, null, 2) + '\n');

  const report = {
    total,
    unique,
    starters: STARTER.length,
    staged,
    skipped,
  };
  writeFileSync(join(STAGE_DIR, 'extract-report.json'), JSON.stringify(report, null, 2) + '\n');

  console.log(JSON.stringify(report, null, 2));
  console.log(`\nWrote starter pack: ${STARTER_PACK_OUT}`);
  console.log(`Staged ${staged} presets under: ${STAGE_DIR}`);
}

main();

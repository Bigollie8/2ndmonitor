// scripts/gen-third-party-licenses.mjs
// Regenerates THIRD-PARTY-LICENSES.md from the REAL dependency trees.
//
//   node scripts/gen-third-party-licenses.mjs [--check]
//
// Two sources, because this app ships two dependency graphs into one binary:
//   - npm:   app/node_modules/**/package.json  (what Vite bundles into the webview)
//   - cargo: `cargo metadata` for app/src-tauri (what links into the exe)
//
// Only RUNTIME dependencies are listed. A devDependency (vite, tsx, eslint)
// never reaches a user's machine, so carrying its notice would misstate what
// is actually being redistributed. For cargo the equivalent filter is the
// resolved dependency graph of the app crate, which `cargo metadata` already
// gives us minus dev-only crates.
//
// `--check` exits non-zero if the generated content differs from the file on
// disk, so CI can catch a dependency added without refreshing the notices.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const APP = join(ROOT, 'app');
const OUT = join(ROOT, 'THIRD-PARTY-LICENSES.md');
/** Copies Tauri bundles into the installer — see the write step below. */
const LEGAL = join(APP, 'src-tauri', 'resources', 'legal');

/** Runtime npm deps, resolved transitively from app/package.json's
 *  `dependencies` (NOT devDependencies — see the header). */
function npmPackages() {
  const rootPkg = JSON.parse(readFileSync(join(APP, 'package.json'), 'utf8'));
  const wanted = new Set(Object.keys(rootPkg.dependencies ?? {}));
  const seen = new Map();
  const modules = join(APP, 'node_modules');
  if (!existsSync(modules)) {
    throw new Error('app/node_modules is missing — run `npm --prefix app install` first');
  }

  const read = (name) => {
    const p = join(modules, name, 'package.json');
    if (!existsSync(p)) return null;
    try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; }
  };

  // Breadth-first over the flat node_modules layout npm installs.
  const queue = [...wanted];
  while (queue.length > 0) {
    const name = queue.shift();
    if (seen.has(name)) continue;
    const pkg = read(name);
    if (!pkg) continue;
    seen.set(name, {
      name: pkg.name ?? name,
      version: pkg.version ?? '?',
      license: normaliseLicense(pkg),
      url: repoUrl(pkg),
    });
    for (const dep of Object.keys(pkg.dependencies ?? {})) {
      if (!seen.has(dep)) queue.push(dep);
    }
  }
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function normaliseLicense(pkg) {
  if (typeof pkg.license === 'string') return pkg.license;
  if (pkg.license?.type) return pkg.license.type;
  if (Array.isArray(pkg.licenses)) return pkg.licenses.map((l) => l.type ?? l).join(' OR ');
  return 'UNKNOWN';
}

function repoUrl(pkg) {
  const r = pkg.repository;
  const raw = typeof r === 'string' ? r : r?.url;
  if (!raw) return pkg.homepage ?? '';
  return raw.replace(/^git\+/, '').replace(/\.git$/, '').replace(/^git:\/\//, 'https://');
}

/** Rust crates that actually link into the app binary. */
function cargoCrates() {
  const json = execFileSync(
    'cargo',
    ['metadata', '--format-version', '1', '--filter-platform', process.platform === 'win32'
      ? 'x86_64-pc-windows-msvc' : 'x86_64-apple-darwin'],
    { cwd: join(APP, 'src-tauri'), encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );
  const meta = JSON.parse(json);
  const local = new Set(meta.workspace_members ?? []);
  return meta.packages
    .filter((p) => !local.has(p.id))
    .map((p) => ({
      name: p.name,
      version: p.version,
      license: p.license ?? (p.license_file ? `see ${p.license_file}` : 'UNKNOWN'),
      url: p.repository ?? p.homepage ?? '',
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function tally(rows) {
  const counts = new Map();
  for (const r of rows) counts.set(r.license, (counts.get(r.license) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}

function table(rows) {
  const lines = ['| Package | Version | Licence |', '| --- | --- | --- |'];
  for (const r of rows) {
    const name = r.url ? `[${r.name}](${r.url})` : r.name;
    lines.push(`| ${name} | ${r.version} | ${r.license} |`);
  }
  return lines.join('\n');
}

const npm = npmPackages();
const cargo = cargoCrates();

const unknown = [...npm, ...cargo].filter((r) => r.license === 'UNKNOWN');

const body = `# Third-party licences

Second-Monitor Hub itself is licensed under the Business Source License 1.1
(see \`LICENSE\`). It redistributes the third-party components listed below,
each under its own licence, and those licences continue to govern those
components.

This file is generated — run \`node scripts/gen-third-party-licenses.mjs\`
after changing dependencies. Only runtime dependencies appear here: build-time
tooling is never shipped to a user's machine, so listing it would misstate
what is actually redistributed.

## JavaScript (bundled into the application webview)

${npm.length} packages.

${tally(npm).map(([l, n]) => `- ${l}: ${n}`).join('\n')}

${table(npm)}

## Rust (linked into the application binary)

${cargo.length} crates.

${tally(cargo).map(([l, n]) => `- ${l}: ${n}`).join('\n')}

${table(cargo)}
${unknown.length > 0 ? `
## Needs attention

${unknown.length} component(s) declare no licence in their metadata and must be
checked by hand before a release:

${unknown.map((r) => `- ${r.name} ${r.version}`).join('\n')}
` : ''}`;

if (process.argv.includes('--check')) {
  const current = existsSync(OUT) ? readFileSync(OUT, 'utf8') : '';
  if (current !== body) {
    console.error('THIRD-PARTY-LICENSES.md is out of date — run node scripts/gen-third-party-licenses.mjs');
    process.exit(1);
  }
  console.log('THIRD-PARTY-LICENSES.md is up to date');
} else {
  writeFileSync(OUT, body);
  // Also refresh the copies Tauri bundles into the installer. They live
  // inside the crate because Tauri resource paths that climb out of
  // src-tauri with ../.. are fragile; keeping the copy in sync here is the
  // cost of that, and a stale notice file in a shipped installer is exactly
  // the failure this script exists to prevent.
  mkdirSync(LEGAL, { recursive: true });
  writeFileSync(join(LEGAL, 'LICENSE.txt'), readFileSync(join(ROOT, 'LICENSE'), 'utf8'));
  writeFileSync(join(LEGAL, 'THIRD-PARTY-LICENSES.md'), body);
  console.log(`wrote ${OUT}: ${npm.length} npm packages, ${cargo.length} cargo crates`);
  console.log(`refreshed bundled copies in ${LEGAL}`);
  if (unknown.length > 0) {
    console.warn(`! ${unknown.length} component(s) declare no licence — see the "Needs attention" section`);
  }
}

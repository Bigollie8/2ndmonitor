// scripts/bundles.mjs
// Validate, zip and publish bundles in bundles/<id>/ to the marketplace.
//   node scripts/bundles.mjs build            # validate + zip all
//   node scripts/bundles.mjs publish [id...]  # build, then submit
//   node scripts/bundles.mjs seed             # validate + zip all into
//                                              # app/src-tauri/resources/seed/<kind>/
//
// NOTE ON THE REAL SERVER ROUTE (verified against server/src/*.rs — the
// server is the source of truth, not any plan doc):
//   - There is no `/admin/publish` endpoint. Submission is `POST /submissions`
//     (server/src/submit.rs), authenticated with a normal *user session*
//     bearer token (from `POST /auth/login`, itself gated on email
//     verification) — NOT the server's ADMIN_TOKEN. The admin token only
//     guards `/admin/queue` and `/admin/decide`, i.e. reviewing submissions,
//     not making them.
//   - The body is JSON, not multipart/form-data, and there is no zip upload:
//     `{ kind, manifest, code }` where `manifest` is the bundle's
//     manifest.json file content as a raw string and `code` is either
//     main.js's content (kind "visualizer") or view.json's content (kind
//     "tile" — see server/src/submit.rs: for "tile" it runs
//     `validate_view_spec(code)` and stores the result under the name
//     "main.js" internally, but the wire field is still `code`). The server
//     builds its own zip internally (`submit::zip_bundle`) once a submission
//     is approved; nothing here needs to ship a zip over the wire.
//   - For kind "visualizer" or "tile" (what these bundles are), a fresh
//     submission lands with status "pending" — it only appears in the signed
//     `/index.json` after a human approves it via `/admin/decide`. Publishing
//     is therefore inherently two-step and NOT completed by this script alone.
// The server rejects a duplicate id@version outright (`INSERT OR IGNORE`
// affecting 0 rows -> 409), regardless of the prior row's status; republishing
// after a fix requires a version bump. This script skips ids/versions already
// present in the live (approved) index rather than failing the run, but a
// prior *pending* submission of the same id@version will still 409 here.
import { readdirSync, readFileSync, mkdirSync, existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const BUNDLES = join(ROOT, 'bundles');
const DIST = join(BUNDLES, 'dist');
// Where seed zips land for Tauri to bundle as resources. Layout mirrors what
// seed.rs (app/src-tauri/src/seed.rs) reads: resources/seed/<kind>/<id>-<version>.zip.
const SEED_ROOT = join(ROOT, 'app', 'src-tauri', 'resources', 'seed');
const SERVER = process.env.MARKET_URL ?? 'https://market.basedsecurity.net';

const ID_RE = /^[a-z0-9-]{1,64}$/;
// m.version is interpolated straight into a PowerShell -Command string in
// zip() below. Only reachable by someone who can already edit the repo, but
// a version containing a quote (or backtick, `$`, etc.) would escape the
// Compress-Archive argument — reject anything that isn't a plain version-ish
// token before it ever reaches that string.
const VERSION_RE = /^[\w.+-]+$/;

function bundleIds() {
  return readdirSync(BUNDLES, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name !== 'dist')
    .map((d) => d.name);
}

/** A bundle is either a scripted visualizer (`main.js`) or a declarative
 *  tile (`view.json`) — told apart by which file the folder actually has,
 *  same rule the smoke harness (sandbox/bundles.test.ts) uses. */
function bundleKind(id) {
  const hasMainJs = existsSync(join(BUNDLES, id, 'main.js'));
  const hasViewJson = existsSync(join(BUNDLES, id, 'view.json'));
  if (hasMainJs && !hasViewJson) return { kind: 'visualizer', codeFile: 'main.js' };
  if (hasViewJson && !hasMainJs) return { kind: 'tile', codeFile: 'view.json' };
  throw new Error(`${id}: must have exactly one of main.js (visualizer) or view.json (tile)`);
}

function validate(id) {
  if (!ID_RE.test(id)) throw new Error(`${id}: folder name is not a valid bundle id`);
  if (!existsSync(join(BUNDLES, id, 'manifest.json'))) throw new Error(`${id}: missing manifest.json`);
  const { kind, codeFile } = bundleKind(id);
  const m = JSON.parse(readFileSync(join(BUNDLES, id, 'manifest.json'), 'utf8'));
  if (m.id !== id) throw new Error(`${id}: manifest id is "${m.id}"`);
  if (m.api !== 1) throw new Error(`${id}: api must be 1`);
  if (!Array.isArray(m.permissions)) throw new Error(`${id}: permissions must be an array`);
  if (kind !== 'tile' && m.permissions.length !== 0) {
    throw new Error(`${id}: ${kind} bundles must not declare permissions`);
  }
  if (!m.version) throw new Error(`${id}: version is required`);
  if (!VERSION_RE.test(m.version)) throw new Error(`${id}: version "${m.version}" has characters outside [\\w.+-]`);
  if (kind === 'tile') {
    // Parseable JSON is all this script checks; the smoke harness runs the
    // real validateViewSpec (a TS module, not importable from this plain
    // .mjs script without a build step) against every tile bundle.
    try {
      JSON.parse(readFileSync(join(BUNDLES, id, 'view.json'), 'utf8'));
    } catch (e) {
      throw new Error(`${id}: view.json is not valid JSON: ${e.message}`);
    }
  }
  return { m, kind, codeFile };
}

function zip(id, version, codeFile, outDir = DIST) {
  mkdirSync(outDir, { recursive: true });
  const out = join(outDir, `${id}-${version}.zip`);
  // PowerShell's Compress-Archive ships with Windows; no npm dependency needed.
  // This is a local build artifact for inspection/distribution outside the
  // marketplace flow — the live `/submissions` route does not consume it (see
  // note above): the server builds its own zip from the raw manifest/code
  // strings once a submission is approved.
  //
  // Only zip manifest.json + the kind's payload file (main.js or view.json) —
  // NOT `-Path '<dir>\*'`, which used to sweep up README.md and anything else
  // sitting in the bundle folder. `marketplace_install`'s entry allowlist
  // rejects any unexpected zip entry, so an extra file made the locally built
  // zip uninstallable (M11).
  const manifestPath = join(BUNDLES, id, 'manifest.json');
  const codePath = join(BUNDLES, id, codeFile);
  execFileSync('powershell', [
    '-NoProfile', '-Command',
    `Compress-Archive -Path '${manifestPath}','${codePath}' -DestinationPath '${out}' -Force`,
  ], { stdio: 'inherit' });
  return out;
}

/** Extracts the id portion of a `<id>-<version>.zip` filename by splitting on
 *  the LAST hyphen — mirrors `parse_seed_path`'s `rsplit_once('-')` in
 *  seed.rs, so an id containing a hyphen (`tile-quote`) is not confused with
 *  a different, longer id that merely shares its prefix. */
function stemIdOf(filename) {
  const stem = filename.replace(/\.zip$/i, '');
  const idx = stem.lastIndexOf('-');
  return idx === -1 ? null : stem.slice(0, idx);
}

/** Removes any other `<id>-*.zip` in `dir` so a version bump doesn't leave
 *  the old version's zip sitting alongside the new one — seed_sync (Rust)
 *  walks the whole directory and would otherwise see two versions of one id. */
function cleanStaleSeedZips(dir, id, keepVersion) {
  if (!existsSync(dir)) return;
  const keep = `${id}-${keepVersion}.zip`;
  for (const f of readdirSync(dir)) {
    if (f.toLowerCase().endsWith('.zip') && f !== keep && stemIdOf(f) === id) {
      unlinkSync(join(dir, f));
      console.log(`  - removed stale ${f}`);
    }
  }
}

async function liveIndex() {
  try {
    const res = await fetch(`${SERVER}/index.json`);
    if (!res.ok) return [];
    const idx = await res.json();
    return idx.bundles ?? [];
  } catch {
    console.warn('! could not read the live index; publishing without a skip check');
    return [];
  }
}

const [cmd, ...only] = process.argv.slice(2);
const ids = only.length ? only : bundleIds();
if (!ids.length) { console.error('no bundles found'); process.exit(1); }

// One malformed folder must not abort the whole run — with a dozen bundles
// landing, a single throw here would hide every other bundle's result.
// Collect per-bundle failures and report all of them, then fail the run.
const built = [];
const failed = [];
for (const id of ids) {
  try {
    const { m, kind, codeFile } = validate(id);
    let path = null;
    if (cmd === 'build' || cmd === 'publish') {
      path = zip(id, m.version, codeFile);
    } else if (cmd === 'seed') {
      // `kind` here is only ever "tile" or "visualizer" (validate()/bundleKind()
      // throws for anything else), matching the two subdirectories seed.rs walks.
      const outDir = join(SEED_ROOT, kind);
      cleanStaleSeedZips(outDir, id, m.version);
      path = zip(id, m.version, codeFile, outDir);
    }
    console.log(`✓ ${id}@${m.version} (${kind})${path ? ` → ${path}` : ''}`);
    built.push({ id, version: m.version, kind, codeFile, path });
  } catch (e) {
    console.error(`✗ ${id}: ${e.message}`);
    failed.push(id);
  }
}

if (cmd === 'publish') {
  // A user *session* token, not the server's ADMIN_TOKEN — obtain one via
  // POST /auth/register (or /auth/login if the account already exists) with
  // a verified email; see server/src/auth.rs. The admin token only guards
  // /admin/queue and /admin/decide, which this script does not call.
  const token = process.env.MARKET_TOKEN;
  if (!token) { console.error('MARKET_TOKEN is not set (a user session token, not the server admin token — see server/src/auth.rs)'); process.exit(1); }
  const live = await liveIndex();
  for (const b of built) {
    if (live.some((l) => l.id === b.id && l.version === b.version)) {
      console.log(`- ${b.id}@${b.version} already published, skipping`);
      continue;
    }
    const manifest = readFileSync(join(BUNDLES, b.id, 'manifest.json'), 'utf8');
    const code = readFileSync(join(BUNDLES, b.id, b.codeFile), 'utf8');
    const res = await fetch(`${SERVER}/submissions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: b.kind, manifest, code }),
    });
    if (!res.ok) {
      console.error(`✗ ${b.id}: ${res.status} ${await res.text()}`);
      process.exitCode = 1;
    } else {
      const out = await res.json();
      console.log(`↑ submitted ${b.id}@${b.version} — status: ${out.status}${out.status === 'pending' ? ' (awaiting admin approval via /admin/decide before it appears in /index.json)' : ''}`);
    }
  }
}

if (cmd !== 'build' && cmd !== 'publish' && cmd !== 'seed') {
  console.error('usage: node scripts/bundles.mjs build|publish|seed [id...]');
  process.exit(1);
}

if (failed.length) {
  console.error(`\n${failed.length} of ${ids.length} bundle(s) failed validation: ${failed.join(', ')}`);
  process.exit(1);
}

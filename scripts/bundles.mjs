// scripts/bundles.mjs
// Validate, zip and publish bundles in bundles/<id>/ to the marketplace.
//   node scripts/bundles.mjs build            # validate + zip all
//   node scripts/bundles.mjs publish [id...]  # build, then submit
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
//     manifest.json file content as a raw string and `code` is main.js's
//     content as a raw string. The server builds its own zip internally
//     (`submit::zip_bundle`) once a submission is approved; nothing here
//     needs to ship a zip over the wire.
//   - For kind "visualizer" (what these bundles are), a fresh submission
//     lands with status "pending" — it only appears in the signed
//     `/index.json` after a human approves it via `/admin/decide`. Publishing
//     a visualizer is therefore inherently two-step and NOT completed by this
//     script alone.
// The server rejects a duplicate id@version outright (`INSERT OR IGNORE`
// affecting 0 rows -> 409), regardless of the prior row's status; republishing
// after a fix requires a version bump. This script skips ids/versions already
// present in the live (approved) index rather than failing the run, but a
// prior *pending* submission of the same id@version will still 409 here.
import { readdirSync, readFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const BUNDLES = join(ROOT, 'bundles');
const DIST = join(BUNDLES, 'dist');
const SERVER = process.env.MARKET_URL ?? 'https://market.basedsecurity.net';

const REQUIRED = ['manifest.json', 'main.js'];
const ID_RE = /^[a-z0-9-]{1,64}$/;

function bundleIds() {
  return readdirSync(BUNDLES, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name !== 'dist')
    .map((d) => d.name);
}

function validate(id) {
  if (!ID_RE.test(id)) throw new Error(`${id}: folder name is not a valid bundle id`);
  for (const f of REQUIRED) {
    if (!existsSync(join(BUNDLES, id, f))) throw new Error(`${id}: missing ${f}`);
  }
  const m = JSON.parse(readFileSync(join(BUNDLES, id, 'manifest.json'), 'utf8'));
  if (m.id !== id) throw new Error(`${id}: manifest id is "${m.id}"`);
  if (m.api !== 1) throw new Error(`${id}: api must be 1`);
  if (!Array.isArray(m.permissions)) throw new Error(`${id}: permissions must be an array`);
  if (!m.version) throw new Error(`${id}: version is required`);
  return m;
}

function zip(id, version) {
  mkdirSync(DIST, { recursive: true });
  const out = join(DIST, `${id}-${version}.zip`);
  // PowerShell's Compress-Archive ships with Windows; no npm dependency needed.
  // This is a local build artifact for inspection/distribution outside the
  // marketplace flow — the live `/submissions` route does not consume it (see
  // note above): the server builds its own zip from the raw manifest/code
  // strings once a submission is approved.
  execFileSync('powershell', [
    '-NoProfile', '-Command',
    `Compress-Archive -Path '${join(BUNDLES, id)}\\*' -DestinationPath '${out}' -Force`,
  ], { stdio: 'inherit' });
  return out;
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

const built = ids.map((id) => {
  const m = validate(id);
  const path = cmd === 'build' || cmd === 'publish' ? zip(id, m.version) : null;
  console.log(`✓ ${id}@${m.version}${path ? ` → ${path}` : ''}`);
  return { id, version: m.version, kind: 'visualizer', path };
});

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
    const code = readFileSync(join(BUNDLES, b.id, 'main.js'), 'utf8');
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

if (cmd !== 'build' && cmd !== 'publish') {
  console.error('usage: node scripts/bundles.mjs build|publish [id...]');
  process.exit(1);
}

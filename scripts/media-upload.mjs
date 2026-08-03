// scripts/media-upload.mjs
// Pushes bundles/<id>/preview.png and preview-anim.webp to the marketplace
// as bundle_media rows.
//
//   ADMIN_TOKEN=... node scripts/media-upload.mjs [id...]
//   MARKET_URL=https://market.basedsecurity.net ADMIN_TOKEN=... node scripts/media-upload.mjs
//
// Uses ADMIN_TOKEN, NOT MARKET_TOKEN. scripts/bundles.mjs publishes with a
// user SESSION token (see its header comment); media upload hits /admin/
// routes and needs the server's admin token. Conflating them produces a
// confusing 403, so this script checks for the right one by name.
//
// Idempotent: the server does INSERT OR REPLACE on (bundle_id, version, idx),
// so re-running is safe and is the normal way to correct an asset.
//
// BEFORE RUNNING, from the dev box: hairpin NAT drops a large share of
// connections to the public IP from inside the same LAN, worked around with a
// hosts-file pin to the server's LAN IP — which is DHCP and has drifted
// (.104/.138/.144/.145 all seen). This script makes ~2 requests per bundle;
// verify the pin first or it will fail nondeterministically partway through.
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const BUNDLES = join(ROOT, 'bundles');
const SERVER = (process.env.MARKET_URL ?? 'https://market.basedsecurity.net').replace(/\/+$/, '');
const TOKEN = process.env.ADMIN_TOKEN;

// Mirrors server/src/media.rs exactly, so an asset this script accepts is
// never rejected server-side and one it rejects would have been rejected
// there too — reported by name here rather than as a bare 400.
const MAX_STILL = 256 * 1024;
const MAX_ANIM = 2 * 1024 * 1024;

if (!TOKEN) {
  console.error('ADMIN_TOKEN is not set.');
  console.error('This is the SERVER ADMIN token, not the MARKET_TOKEN scripts/bundles.mjs publishes with.');
  process.exit(1);
}

const requested = process.argv.slice(2);

function bundleIds() {
  const all = readdirSync(BUNDLES, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name !== 'dist')
    .filter((d) => existsSync(join(BUNDLES, d.name, 'manifest.json')))
    .map((d) => d.name)
    .sort();
  return requested.length > 0 ? all.filter((id) => requested.includes(id)) : all;
}

/** Live published versions, keyed by bundle id. Read from /index.json rather
 *  than the local manifest: the local one may be ahead of what is actually
 *  published, and uploading media against an unpublished version writes rows
 *  nothing will ever serve. */
async function liveVersions() {
  const res = await fetch(`${SERVER}/index.json`);
  if (!res.ok) throw new Error(`GET /index.json -> ${res.status}`);
  const idx = await res.json();
  const map = new Map();
  for (const b of idx.bundles ?? []) {
    // The index carries one row per version; last write wins the same way
    // mergeCatalog does, which is the version the app treats as current.
    map.set(b.id, b.version);
  }
  return map;
}

async function putAsset(id, version, idx, kind, bytes) {
  const res = await fetch(`${SERVER}/admin/bundles/${id}/${version}/media`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ idx, kind, bytes: bytes.toString('base64') }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status} ${text}`);
  return text;
}

const versions = await liveVersions();
let uploaded = 0;
let skipped = 0;
const failures = [];

for (const id of bundleIds()) {
  const version = versions.get(id);
  if (!version) {
    console.log(`- ${id}: not in the live index, skipping`);
    skipped++;
    continue;
  }

  const still = join(BUNDLES, id, 'preview.png');
  const anim = join(BUNDLES, id, 'preview-anim.webp');

  if (existsSync(still)) {
    const size = statSync(still).size;
    if (size > MAX_STILL) {
      failures.push(`${id}: preview.png is ${size} bytes, over the ${MAX_STILL} cap`);
    } else {
      try {
        await putAsset(id, version, 0, 'still', readFileSync(still));
        console.log(`✓ ${id}@${version} idx 0 still (${size} bytes)`);
        uploaded++;
      } catch (e) {
        failures.push(`${id} still: ${e.message}`);
      }
    }
  } else {
    console.log(`- ${id}: no preview.png`);
    skipped++;
  }

  if (existsSync(anim)) {
    const size = statSync(anim).size;
    if (size > MAX_ANIM) {
      failures.push(`${id}: preview-anim.webp is ${size} bytes, over the ${MAX_ANIM} cap`);
    } else {
      try {
        await putAsset(id, version, 1, 'anim', readFileSync(anim));
        console.log(`✓ ${id}@${version} idx 1 anim (${size} bytes)`);
        uploaded++;
      } catch (e) {
        failures.push(`${id} anim: ${e.message}`);
      }
    }
  }
}

console.log(`\n${uploaded} uploaded, ${skipped} skipped, ${failures.length} failed`);
for (const f of failures) console.error(`! ${f}`);
if (failures.length > 0) process.exit(1);

console.log('\nVerify through the real HTTP surface, not the database:');
console.log(`  curl -s ${SERVER}/index.json | jq '.bundles[] | select(.id=="aurora") | {mediaCount, hasPreview}'`);
console.log(`  curl -sI ${SERVER}/bundle/aurora/<version>/media/1 | head -3`);
console.log(`  curl -sI ${SERVER}/bundle/aurora/<version>/preview | head -3`);
console.log('The last one is the compatibility check that matters: 0.7.x clients still fetch /preview.');

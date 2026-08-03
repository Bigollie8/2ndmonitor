// ─────────────────────────────────────────────────────────────────────────────
// Applies bundles/metadata.json to the live marketplace via admin PATCH.
//
//   ADMIN_TOKEN=... node scripts/backfill-metadata.mjs [--dry-run] [id...]
//
// Writes ONLY descriptive columns. Never zip, sha256, size or status -- so
// nothing is re-signed, no index signature changes meaning, and no client
// re-downloads anything. That is the whole reason this is a PATCH rather than
// a re-publish.
//
// Uses ADMIN_TOKEN, NOT the MARKET_TOKEN that scripts/bundles.mjs publishes
// with: that is a user session token (see its header), and these are /admin
// routes. Conflating them yields a confusing 403.
//
// Idempotent: re-running writes the same values. Safe to re-run after a
// partial failure, which matters because the dev box's hairpin NAT drops a
// majority of LAN-to-public-IP connections without a hosts pin (deferred
// finding #20). Verify that pin before a real run.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLES = join(ROOT, 'bundles');
const SERVER = (process.env.MARKET_URL ?? 'https://market.basedsecurity.net').replace(/\/+$/, '');

// Mirrors server/src/manifest.rs's validate_meta exactly, so a value this
// script accepts is never rejected server-side.
const MAX_SUMMARY = 100;
const MAX_DESCRIPTION = 4000;
const MAX_CHANGELOG = 1000;
const MAX_TAGS = 8;
const TAG_RE = /^[a-z0-9-]{1,24}$/;

const CATEGORIES = {
  tile: ['media', 'system', 'weather', 'productivity', 'ambient', 'integrations'],
  visualizer: ['spectrum', 'wave', 'scene', 'engine'],
  preset: ['milkdrop'],
};

/** Emoji detection, which the server cannot do: `app/src/state/tileMeta.ts`
 *  documents the project rule that icons are geometric glyphs only, because
 *  emoji render differently per Windows version and clash with the mono/glass
 *  aesthetic. A length or magic-byte check cannot see this.
 *
 *  Two signals, both cheap and both decisive:
 *   - any astral-plane code point (>= U+1F000) — every modern emoji lives there
 *   - U+FE0F, the variation selector that FORCES emoji presentation on a
 *     character that would otherwise render as a glyph
 *   - the small set of BMP characters that default to emoji presentation
 *     anyway. Deliberately a list rather than a range: the surrounding blocks
 *     hold glyphs this project already uses (☀ ✈ ✎ ✹ ❋ are all in tileMeta). */
const BMP_EMOJI_DEFAULT = new Set([...(
  '⌚⌛⏩⏪⏫⏬⏰⏳◽◾☔☕♈♉♊♋♌♍♎♏♐♑♒♓♿⚓⚡⚪⚫⚽⚾⛄⛅⛎⛔⛪⛲⛳⛵⛺⛽✅✊✋✨❌❎❓❔❕❗➕➖➗➰➿⭐⭕'
)]);

export function looksLikeEmoji(s) {
  for (const ch of s) {
    if (ch.codePointAt(0) >= 0x1f000) return true;
    if (ch === '️') return true;
    if (BMP_EMOJI_DEFAULT.has(ch)) return true;
  }
  return false;
}

/** `{ ok: true } | { ok: false, errors: string[] }`. `kindOf(id)` returns
 *  'tile' | 'visualizer' | 'preset'. */
export function validateMetadata(data, kindOf) {
  const errors = [];
  const push = (id, msg) => errors.push(`${id}: ${msg}`);

  for (const [id, m] of Object.entries(data)) {
    if (m == null || typeof m !== 'object') { push(id, 'entry must be an object'); continue; }

    if (typeof m.summary !== 'string' || m.summary.trim().length === 0) {
      push(id, 'summary is required');
    } else if (m.summary.length > MAX_SUMMARY) {
      push(id, `summary is ${m.summary.length} chars, over the ${MAX_SUMMARY} limit`);
    }

    if (m.description != null) {
      if (typeof m.description !== 'string') push(id, 'description must be a string');
      else if (m.description.length > MAX_DESCRIPTION) {
        push(id, `description is ${m.description.length} chars, over the ${MAX_DESCRIPTION} limit`);
      }
    }

    if (m.changelog != null) {
      if (typeof m.changelog !== 'string') push(id, 'changelog must be a string');
      else if (m.changelog.length > MAX_CHANGELOG) {
        push(id, `changelog is ${m.changelog.length} chars, over the ${MAX_CHANGELOG} limit`);
      }
    }

    const kind = kindOf(id);
    const allowed = CATEGORIES[kind] ?? [];
    if (typeof m.category !== 'string' || !allowed.includes(m.category)) {
      push(id, `category ${JSON.stringify(m.category)} is not valid for a ${kind} (expected one of ${allowed.join(', ')})`);
    }

    if (m.tags != null) {
      if (!Array.isArray(m.tags)) push(id, 'tags must be an array');
      else {
        if (m.tags.length > MAX_TAGS) push(id, `${m.tags.length} tags, over the ${MAX_TAGS} limit`);
        for (const t of m.tags) {
          if (typeof t !== 'string' || !TAG_RE.test(t)) {
            push(id, `tag ${JSON.stringify(t)} must be 1-24 chars of [a-z0-9-]`);
          }
        }
      }
    }

    if (m.icon != null) {
      if (typeof m.icon !== 'string') push(id, 'icon must be a string');
      else if ([...m.icon].length < 1 || [...m.icon].length > 2) {
        push(id, 'icon must be 1-2 characters');
      } else if (looksLikeEmoji(m.icon)) {
        push(id, `icon ${JSON.stringify(m.icon)} is an emoji — this project uses geometric glyphs only (see app/src/state/tileMeta.ts)`);
      }
    }

    if (m.minAppVersion != null && !/^\d+(\.\d+)*$/.test(m.minAppVersion)) {
      push(id, 'minAppVersion must be dotted numeric');
    }

    if (m.featured != null && typeof m.featured !== 'boolean') {
      push(id, 'featured must be a boolean');
    }
  }

  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

// ── CLI ──────────────────────────────────────────────────────────────────────

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const only = args.filter((a) => !a.startsWith('--'));

  const kindOf = (id) => {
    if (existsSync(join(BUNDLES, id, 'view.json'))) return 'tile';
    if (existsSync(join(BUNDLES, id, 'preset.json'))) return 'preset';
    const m = JSON.parse(readFileSync(join(BUNDLES, id, 'manifest.json'), 'utf8'));
    return m.kind ?? 'visualizer';
  };

  const data = JSON.parse(readFileSync(join(BUNDLES, 'metadata.json'), 'utf8'));

  // Validated BEFORE anything is sent: a bad entry must fail at zero requests,
  // not at request 19 with half the catalog updated.
  const res = validateMetadata(data, kindOf);
  if (!res.ok) {
    console.error('metadata.json is invalid — nothing was sent:');
    for (const e of res.errors) console.error(`  ! ${e}`);
    process.exit(1);
  }

  const known = new Set(readdirSync(BUNDLES, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name !== 'dist')
    .filter((d) => existsSync(join(BUNDLES, d.name, 'manifest.json')))
    .map((d) => d.name));
  const orphans = Object.keys(data).filter((id) => !known.has(id));
  if (orphans.length > 0) {
    console.error(`metadata names bundles that do not exist: ${orphans.join(', ')}`);
    process.exit(1);
  }

  const TOKEN = process.env.ADMIN_TOKEN;
  if (!TOKEN && !dryRun) {
    console.error('ADMIN_TOKEN is not set.');
    console.error('This is the SERVER ADMIN token, not the MARKET_TOKEN scripts/bundles.mjs publishes with.');
    process.exit(1);
  }

  const res2 = await fetch(`${SERVER}/index.json`);
  if (!res2.ok) {
    console.error(`GET ${SERVER}/index.json -> ${res2.status}`);
    process.exit(1);
  }
  const idx = await res2.json();

  // Every approved VERSION of each id, not just the newest: metadata is per
  // (id, version), and a described current release sitting beside undescribed
  // older ones in the Store's version history is exactly the seam this phase
  // exists to close.
  const targets = [];
  for (const b of idx.bundles ?? []) {
    if (!data[b.id]) continue;
    if (only.length > 0 && !only.includes(b.id)) continue;
    targets.push({ id: b.id, version: b.version });
  }

  const described = new Set(targets.map((t) => t.id));
  const notLive = Object.keys(data).filter((id) => !described.has(id) && (only.length === 0 || only.includes(id)));
  if (notLive.length > 0) {
    console.log(`- not in the live index, nothing to patch: ${notLive.join(', ')}`);
  }

  let ok = 0;
  const failures = [];
  // Serial, not concurrent: 37 requests is not worth parallelising, and serial
  // makes a partial failure trivially resumable.
  for (const { id, version } of targets) {
    const m = data[id];
    const body = {
      summary: m.summary,
      description: m.description ?? null,
      category: m.category,
      tags: m.tags ?? [],
      icon: m.icon ?? null,
      featured: m.featured ?? false,
    };
    if (m.changelog != null) body.changelog = m.changelog;
    if (m.minAppVersion != null) body.minAppVersion = m.minAppVersion;

    if (dryRun) {
      console.log(`would PATCH ${id}@${version}: ${JSON.stringify(body)}`);
      ok++;
      continue;
    }
    try {
      const r = await fetch(`${SERVER}/admin/bundles/${id}/${version}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
        body: JSON.stringify(body),
      });
      const text = await r.text();
      if (!r.ok) throw new Error(`${r.status} ${text}`);
      console.log(`✓ ${id}@${version}`);
      ok++;
    } catch (e) {
      failures.push(`${id}@${version}: ${e.message}`);
      console.error(`! ${id}@${version}: ${e.message}`);
    }
  }

  console.log(`\n${ok} ${dryRun ? 'would be patched' : 'patched'}, ${failures.length} failed`);
  if (failures.length > 0) process.exit(1);

  if (!dryRun) {
    console.log('\nVerify through the index the app actually reads, not the database:');
    console.log(`  curl -s ${SERVER}/index.json > /tmp/idx.json`);
    console.log("  jq '[.bundles[] | select(.summary == null)] | length' /tmp/idx.json    # must be 0");
    console.log("  jq '[.bundles[] | select(.category == null)] | length' /tmp/idx.json   # must be 0");
    console.log("  jq '[.bundles[] | select(.featured)] | length' /tmp/idx.json           # 4-6");
    console.log('And prove no zip moved: diff the sha256 set captured before this run against after.');
  }
}

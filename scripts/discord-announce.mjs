#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseChangelog,
  parseEnvFile,
  buildReleaseEmbed,
  buildSpotlightEmbed,
  buildDevEmbed,
} from './changelog.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASELINE_DELAY_MS = 2000;

const { values: args } = parseArgs({
  options: {
    version: { type: 'string' },
    all: { type: 'boolean', default: false },
    dev: { type: 'boolean', default: false },
    title: { type: 'string' },
    body: { type: 'string' },
    'dry-run': { type: 'boolean', default: false },
  },
});

const dryRun = args['dry-run'];

function fail(msg) {
  console.error(`error: ${msg}`);
  process.exit(1);
}

function loadEnv() {
  const fromFile = existsSync(join(ROOT, '.env'))
    ? parseEnvFile(readFileSync(join(ROOT, '.env'), 'utf8'))
    : {};
  return {
    releases: process.env.DISCORD_RELEASES_WEBHOOK_URL ?? fromFile.DISCORD_RELEASES_WEBHOOK_URL,
    features: process.env.DISCORD_FEATURES_WEBHOOK_URL ?? fromFile.DISCORD_FEATURES_WEBHOOK_URL,
  };
}

async function post(webhookUrl, embed, label) {
  if (dryRun) {
    console.log(`[dry-run] ${label}:\n${JSON.stringify({ embeds: [embed] }, null, 2)}`);
    return;
  }
  if (!webhookUrl) fail(`missing webhook URL for ${label} (set env var or .env)`);
  const res = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ embeds: [embed] }),
  });
  if (!res.ok) fail(`${label}: Discord responded ${res.status} ${await res.text()}`);
  console.log(`posted: ${label}`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const modes = [args.version, args.all, args.dev].filter(Boolean).length;
if (modes !== 1) fail('use exactly one of --version X.Y.Z, --all, or --dev');

const { releases, features } = loadEnv();

if (args.dev) {
  if (!args.title || !args.body) fail('--dev requires --title and --body');
  const date = new Date().toISOString().slice(0, 10);
  await post(features, buildDevEmbed({ title: args.title, body: args.body, date }), `dev post "${args.title}"`);
} else {
  const entries = parseChangelog(readFileSync(join(ROOT, 'CHANGELOG.md'), 'utf8'));
  if (args.all) {
    for (const entry of [...entries].reverse()) {
      await post(releases, buildReleaseEmbed(entry), `release v${entry.version}`);
      if (!dryRun) await sleep(BASELINE_DELAY_MS);
    }
  } else {
    const entry = entries.find((e) => e.version === args.version);
    if (!entry) fail(`CHANGELOG.md has no section for version ${args.version}`);
    await post(releases, buildReleaseEmbed(entry), `release v${entry.version}`);
    const spotlight = buildSpotlightEmbed(entry);
    if (spotlight) await post(features, spotlight, `spotlight v${entry.version}`);
  }
}

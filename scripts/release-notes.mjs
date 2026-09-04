#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { parseChangelog } from './changelog.mjs';

const version = process.argv[2]?.replace(/^v/, '');
const entry = parseChangelog(readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8'))
  .find(entry => entry.version === version);
if (!entry) {
  console.error(`CHANGELOG.md has no release section for ${version ?? '(missing version)'}`);
  process.exit(1);
}
process.stdout.write(`${entry.body}\n`);

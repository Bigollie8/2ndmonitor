const VERSION_HEADING = /^## \[(\d+\.\d+\.\d+)\] - (\d{4}-\d{2}-\d{2})\s*$/;

export function parseChangelog(markdown) {
  const lines = markdown.split(/\r?\n/);
  const entries = [];
  let current = null;

  for (const line of lines) {
    const m = line.match(VERSION_HEADING);
    if (m) {
      current = { version: m[1], date: m[2], bodyLines: [] };
      entries.push(current);
    } else if (/^## /.test(line)) {
      current = null; // Unreleased or any other level-2 heading
    } else if (current) {
      current.bodyLines.push(line);
    }
  }

  return entries.map(({ version, date, bodyLines }) => {
    const body = bodyLines.join('\n').trim();
    return { version, date, body, added: extractAdded(body) };
  });
}

function extractAdded(body) {
  const m = body.match(/(?:^|\n)### Added\s*\n([\s\S]*?)(?=\n### |$)/);
  return m ? m[1].trim() : null;
}

export const CHANGELOG_URL =
  'https://github.com/Bigollie8/2ndmonitor/blob/main/CHANGELOG.md';

const EMBED_DESCRIPTION_MAX = 4096;

export function truncateDescription(text) {
  if (text.length <= EMBED_DESCRIPTION_MAX) return text;
  const suffix = `…[full changelog](${CHANGELOG_URL})`;
  return `${text.slice(0, EMBED_DESCRIPTION_MAX - suffix.length - 2)}\n\n${suffix}`.slice(0, EMBED_DESCRIPTION_MAX);
}

export function buildReleaseEmbed({ version, date, body }) {
  return {
    title: `2ndMonitor v${version}`,
    description: truncateDescription(body),
    color: 0x5865f2,
    footer: { text: `2ndMonitor Releases • ${date}` },
  };
}

export function buildSpotlightEmbed({ version, date, added }) {
  if (!added) return null;
  return {
    title: `✨ New in 2ndMonitor v${version}`,
    description: truncateDescription(added),
    color: 0x57f287,
    footer: { text: `2ndMonitor Features • ${date}` },
  };
}

export function buildDevEmbed({ title, body, date }) {
  return {
    title: `🔧 In development — ${title}`,
    description: truncateDescription(body),
    color: 0xfaa61a,
    footer: { text: `2ndMonitor Features • ${date}` },
  };
}

export function parseEnvFile(text) {
  const env = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    env[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }
  return env;
}

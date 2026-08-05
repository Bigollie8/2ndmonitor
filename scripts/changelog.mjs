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
    return {
      version, date, body,
      added: extractAdded(body),
      fixed: extractSection(body, 'Fixed'),
    };
  });
}

function extractAdded(body) {
  return extractSection(body, 'Added');
}

/** Pull one `### <name>` section's body out of a changelog entry.
 *  Returns null when the section is absent or empty. */
function extractSection(body, name) {
  const m = body.match(new RegExp(`(?:^|\\n)### ${name}\\s*\\n([\\s\\S]*?)(?=\\n### |$)`));
  if (!m) return null;
  const text = m[1].trim();
  if (!text || text.startsWith('### ')) return null;
  return text;
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

export function buildSpotlightEmbed({ version, date, added, fixed }) {
  // Fall back to Fixed when a release adds nothing (0.8.3). This only ever
  // read `### Added`, so a fixes-only release posted nothing to the features
  // channel — and 0.8.2, which shipped four fixes plus one incidental Added
  // line about licence notices, announced only the licence and read as though
  // that were the whole release.
  // Include BOTH sections when both exist. A fallback alone was not enough:
  // 0.8.2 shipped four fixes plus a single incidental Added line about licence
  // notices, so an Added-only spotlight announced the licence and nothing else
  // — which read as though the licence WAS the release.
  if (!added && !fixed) return null;
  const body = [
    added ? (fixed ? `**New**\n${added}` : added) : null,
    fixed ? (added ? `\n**Fixed**\n${fixed}` : fixed) : null,
  ].filter(Boolean).join('\n');
  return {
    title: added
      ? `✨ New in 2ndMonitor v${version}`
      : `🔧 Fixed in 2ndMonitor v${version}`,
    description: truncateDescription(body),
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

export function buildProgressEmbed({ title, body, date }) {
  return {
    title: `🚧 In progress — ${title}`,
    description: truncateDescription(body),
    color: 0xeb459e,
    footer: { text: `Dev Log • ${date}` },
  };
}

export function buildFeatureEmbed({ title, body, date }) {
  return {
    title: `✨ ${title}`,
    description: truncateDescription(body),
    color: 0x57f287,
    footer: { text: `2ndMonitor Features • ${date}` },
  };
}

export function buildInfoEmbed({ title, body, date }) {
  return {
    title: `📘 ${title}`,
    description: truncateDescription(body),
    color: 0x5bc0de,
    footer: { text: `2ndMonitor Info • ${date}` },
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

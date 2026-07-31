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

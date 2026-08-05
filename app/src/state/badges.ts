// ─────────────────────────────────────────────────────────────────────────────
// Badge presentation.
//
// Pure and node-testable: what a badge LOOKS like is a decision, and it is
// the same decision on a creator page, in the directory and beside a comment.
//
// Badges are granted by an admin and by nobody else (server/src/moderation.rs
// — there is no self-service path anywhere). This module only renders what
// the server says someone has.
// ─────────────────────────────────────────────────────────────────────────────

export interface BadgeStyle {
  label: string;
  glyph: string;
  colour: string;
  title: string;
}

/** The badges with a designed look. An unknown slug still renders — the
 *  server can grant a new kind without shipping a client update, and a
 *  generic chip is a far better outcome than a badge that silently vanishes. */
const KNOWN: Record<string, BadgeStyle> = {
  founder:   { label: 'Founder',   glyph: '★', colour: '#f5c451', title: 'Here from the beginning' },
  moderator: { label: 'Moderator', glyph: '⚑', colour: '#7cc6f5', title: 'Keeps the place tidy' },
  creator:   { label: 'Creator',   glyph: '◆', colour: '#7cf5d4', title: 'Publishes to the marketplace' },
  verified:  { label: 'Verified',  glyph: '✓', colour: '#8ef58e', title: 'Confirmed identity' },
  supporter: { label: 'Supporter', glyph: '♥', colour: '#f58ea8', title: 'Supports the project' },
  staff:     { label: 'Staff',     glyph: '⬢', colour: '#c39ef5', title: 'Works on the app' },
};

/** Title-cases an unknown slug: `early-adopter` → `Early Adopter`. */
function prettify(slug: string): string {
  return slug
    .split('-')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

export function badgeStyle(slug: string): BadgeStyle {
  const key = slug.trim().toLowerCase();
  const known = KNOWN[key];
  if (known) return known;
  return {
    label: prettify(key) || 'Badge',
    glyph: '●',
    colour: '#9aa4b2',
    title: prettify(key),
  };
}

/** Normalises whatever the server sent into a renderable list.
 *
 *  Defensive because this is author-adjacent data arriving over the network:
 *  non-strings are dropped, blanks are dropped, duplicates collapse, and the
 *  count is capped so a bulk grant cannot push a profile's name off screen. */
export function visibleBadges(raw: unknown, max = 4): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of raw) {
    if (typeof entry !== 'string') continue;
    const slug = entry.trim().toLowerCase();
    if (!slug || seen.has(slug)) continue;
    seen.add(slug);
    out.push(slug);
    if (out.length >= max) break;
  }
  return out;
}

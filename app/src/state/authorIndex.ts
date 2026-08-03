// ─────────────────────────────────────────────────────────────────────────────
// Author pages, derived entirely from the merged catalog.
//
// Pure module — no React, no Tauri — so it is node-testable. No endpoint
// either: the index already carries an author per bundle, so grouping is all
// an author page needs.
//
// `authorDisplay` is the server's `users.display_name` falling back to the
// masked email ("oli***"). A masked email is a poor page title, which is why
// display_name exists — but a bundle whose author never set one still gets a
// page rather than being hidden.
// ─────────────────────────────────────────────────────────────────────────────
import type { CatalogItem } from './catalog';

export interface AuthorSummary {
  author: string;
  items: CatalogItem[];
  totalDownloads: number;
}

/** The author label to link to, or `null` when there is no author page to
 *  offer. A first-party built-in is not a marketplace bundle and has no
 *  publisher to page. */
export function authorLabelOf(item: CatalogItem): string | null {
  if (item.source === 'first-party') return null;
  const label = item.authorDisplay?.trim();
  return label ? label : null;
}

export function authorIndexOf(items: CatalogItem[]): Map<string, AuthorSummary> {
  const out = new Map<string, AuthorSummary>();
  for (const item of items) {
    if (item.removed) continue;
    const author = authorLabelOf(item);
    if (!author) continue;
    const entry = out.get(author) ?? { author, items: [], totalDownloads: 0 };
    entry.items.push(item);
    entry.totalDownloads += item.downloads ?? 0;
    out.set(author, entry);
  }
  return out;
}

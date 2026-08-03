// ─────────────────────────────────────────────────────────────────────────────
// Version history per bundle, derived from the index.
//
// Pure module — no React, no Tauri — so it is node-testable.
//
// The signed index carries ONE ROW PER VERSION (`ORDER BY b.id, b.created_at`
// server-side; `mergeCatalog` does last-write-wins per id on top). That is
// what makes this free: a bundle's release history, its changelog per
// release, and its published/updated dates all fall out of grouping rows we
// already fetched, with no extra endpoint and no stored `updated_at` column
// that could disagree with the rows it summarises.
// ─────────────────────────────────────────────────────────────────────────────
import { catalogKey, type IndexBundle } from './catalog';
import { compareVersions } from './appCompat';
import type { DateMap } from './catalogSort';

export interface VersionEntry {
  version: string;
  approvedAt: number | null;
  changelog: string | null;
}

export interface BundleHistory {
  /** Newest first. */
  versions: VersionEntry[];
  /** Earliest approval across every version — the bundle's first release.
   *  `null` when no version carries a date (every bundle approved before the
   *  `approved_at` column existed). Deliberately not 0: zero would sort as
   *  the beginning of time, which is a claim, where null is the truth. */
  publishedAt: number | null;
  /** Latest approval across every version — the most recent release. */
  updatedAt: number | null;
}

export function buildVersionHistory(index: IndexBundle[]): Map<string, BundleHistory> {
  const grouped = new Map<string, VersionEntry[]>();
  for (const b of index) {
    const key = catalogKey(b.kind, b.id);
    const list = grouped.get(key) ?? [];
    list.push({
      version: b.version,
      approvedAt: b.approvedAt ?? null,
      changelog: b.changelog ?? null,
    });
    grouped.set(key, list);
  }

  const out = new Map<string, BundleHistory>();
  for (const [key, list] of grouped) {
    const versions = [...list].sort((a, b) => compareVersions(b.version, a.version));
    const dates = versions
      .map((v) => v.approvedAt)
      .filter((d): d is number => d != null);
    out.set(key, {
      versions,
      publishedAt: dates.length ? Math.min(...dates) : null,
      updatedAt: dates.length ? Math.max(...dates) : null,
    });
  }
  return out;
}

/** Narrows a history map to just the two dates `sortItems` needs. */
export function dateMapOf(history: Map<string, BundleHistory>): DateMap {
  const out: DateMap = new Map();
  for (const [key, h] of history) {
    out.set(key, { publishedAt: h.publishedAt, updatedAt: h.updatedAt });
  }
  return out;
}

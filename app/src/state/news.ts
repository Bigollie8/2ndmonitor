import { isTauri } from './tauri';

// ─────────────────────────────────────────────────────────────────────────────
// News tile state (0.8.6). Mirrors state/stocks.ts: a thin invoke wrapper plus
// a pure, tested config parser. Headlines come from the Rust
// `fetch_news_headlines` proxy — public BBC/Guardian RSS, no API key. RSS
// feeds send no CORS headers, so a direct browser fetch is off the table for
// the same reason the OpenSky and Yahoo proxies exist.
// ─────────────────────────────────────────────────────────────────────────────

export interface Headline {
  title: string;
  link: string;
  source: string;
  published: string | null;
}

export interface NewsResult {
  headlines: Headline[];
  error: string | null;
}

/** Category ids the Rust side maps to feeds. Display labels for the picker. */
export const NEWS_CATEGORIES = [
  { id: 'top', label: 'Top stories' },
  { id: 'world', label: 'World' },
  { id: 'politics', label: 'Politics' },
  { id: 'business', label: 'Business' },
  { id: 'tech', label: 'Tech' },
  { id: 'science', label: 'Science' },
  { id: 'sports', label: 'Sports' },
  { id: 'entertainment', label: 'Entertainment' },
] as const;

export type NewsCategory = (typeof NEWS_CATEGORIES)[number]['id'];

/** Publisher sets the Rust side maps per region (0.9.14). `uk` stays the
 *  default so existing tiles are unchanged. */
export const NEWS_REGIONS = [
  { id: 'uk', label: 'UK', publishers: ['BBC', 'The Guardian'] },
  { id: 'us', label: 'US', publishers: ['NYT', 'NPR'] },
] as const;

export type NewsRegion = (typeof NEWS_REGIONS)[number]['id'];

export interface NewsConfig {
  category: NewsCategory;
  region: NewsRegion;
}

export const DEFAULT_NEWS_CONFIG: NewsConfig = { category: 'top', region: 'uk' };

/** Parse a persisted `instance.config` blob — same parse-with-fallback
 *  pattern as parseStocksConfig / parseRadarConfig. */
export function parseNewsConfig(raw: unknown): NewsConfig {
  if (!raw || typeof raw !== 'object') return DEFAULT_NEWS_CONFIG;
  const c = raw as Record<string, unknown>;
  const category = NEWS_CATEGORIES.some((k) => k.id === c.category)
    ? (c.category as NewsCategory) : DEFAULT_NEWS_CONFIG.category;
  // Each field falls back independently: an old {category} blob keeps its
  // category and gains the UK default region; garbage in either field
  // degrades only that field.
  const region = NEWS_REGIONS.some((r) => r.id === c.region)
    ? (c.region as NewsRegion) : DEFAULT_NEWS_CONFIG.region;
  return { category, region };
}

/** "Sat, 05 Aug 2026 06:00:00 GMT" → "2h" style age, or null when unknown /
 *  unparsable / in the future (clock skew reads as "now", not "-3m"). */
export function headlineAge(published: string | null, nowMs: number): string | null {
  if (!published) return null;
  const t = Date.parse(published);
  if (Number.isNaN(t)) return null;
  const mins = Math.floor((nowMs - t) / 60_000);
  if (mins < 0) return 'now';
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

export async function fetchNewsHeadlines(category: NewsCategory, region: NewsRegion = 'uk'): Promise<NewsResult> {
  if (!isTauri) return { headlines: [], error: null };
  const { invoke } = await import('@tauri-apps/api/core');
  // No catch: usePoll drives its backoff off thrown errors, and unlike stocks
  // there IS a meaningful whole-fetch failure here (both feeds down).
  return await invoke<NewsResult>('fetch_news_headlines', { category, region });
}

/** Short badge for a headline's publisher name ("The Guardian" -> "GRD"). */
export function sourceBadge(source: string): string {
  const known: Record<string, string> = { 'BBC': 'BBC', 'The Guardian': 'GRD', 'NYT': 'NYT', 'NPR': 'NPR' };
  return known[source] ?? source.replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase();
}

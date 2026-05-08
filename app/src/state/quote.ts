/** zenquotes.io free API. Returns a single quote-of-the-day on /api/today.
 *  Public, key-less, CORS-friendly. */

export interface Quote {
  text: string;
  author: string;
  fetchedAt: number;
}

const STORAGE_KEY = '2mh.quote.today';

/** Fetch the day's quote, caching by ISO date so the same quote sticks for
 *  the calendar day. Returns the cached value when the network is unavailable. */
export async function fetchQuoteOfTheDay(): Promise<Quote | null> {
  const todayStamp = new Date().toISOString().slice(0, 10);
  const cached = readCache();
  if (cached && cached.date === todayStamp) {
    return { text: cached.text, author: cached.author, fetchedAt: cached.fetchedAt };
  }
  try {
    const res = await fetch('https://zenquotes.io/api/today');
    if (!res.ok) return cached ? toQuote(cached) : null;
    const data: unknown = await res.json();
    if (!Array.isArray(data) || data.length === 0) return cached ? toQuote(cached) : null;
    const first = data[0] as { q?: unknown; a?: unknown };
    if (typeof first.q !== 'string' || typeof first.a !== 'string') {
      return cached ? toQuote(cached) : null;
    }
    const fresh: Quote = { text: first.q, author: first.a, fetchedAt: Date.now() / 1000 };
    writeCache({ date: todayStamp, ...fresh });
    return fresh;
  } catch {
    return cached ? toQuote(cached) : null;
  }
}

interface CachedQuote {
  date: string; // YYYY-MM-DD
  text: string;
  author: string;
  fetchedAt: number;
}

function readCache(): CachedQuote | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedQuote;
    if (typeof parsed.date !== 'string' || typeof parsed.text !== 'string'
      || typeof parsed.author !== 'string' || typeof parsed.fetchedAt !== 'number') return null;
    return parsed;
  } catch { return null; }
}
function writeCache(c: CachedQuote): void {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(c)); } catch { /* ignore */ }
}
function toQuote(c: CachedQuote): Quote {
  return { text: c.text, author: c.author, fetchedAt: c.fetchedAt };
}

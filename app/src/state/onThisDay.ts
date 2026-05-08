/** Wikipedia "On this day" REST API.
 *  https://api.wikimedia.org/feed/v1/wikipedia/en/onthisday/all/{MM}/{DD}
 *  Public, key-less, generous CORS. */

export interface OnThisDayItem {
  /** Year as a signed integer; negative for BCE. */
  year: number;
  text: string;
  /** First linked article URL, when present. */
  url: string | null;
}

export interface OnThisDayPayload {
  events: OnThisDayItem[];
  births: OnThisDayItem[];
  deaths: OnThisDayItem[];
}

export async function fetchOnThisDay(): Promise<OnThisDayPayload | null> {
  const now = new Date();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const url = `https://api.wikimedia.org/feed/v1/wikipedia/en/onthisday/all/${mm}/${dd}`;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const data: unknown = await res.json();
    if (!data || typeof data !== 'object') return null;
    const d = data as { events?: unknown; births?: unknown; deaths?: unknown };
    return {
      events: pickItems(d.events).slice(0, 10),
      births: pickItems(d.births).slice(0, 10),
      deaths: pickItems(d.deaths).slice(0, 10),
    };
  } catch (err) {
    console.warn('on-this-day fetch failed', err);
    return null;
  }
}

function pickItems(raw: unknown): OnThisDayItem[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((e) => {
      if (!e || typeof e !== 'object') return null;
      const ev = e as { year?: unknown; text?: unknown; pages?: unknown };
      if (typeof ev.year !== 'number' || typeof ev.text !== 'string') return null;
      const firstPage = Array.isArray(ev.pages) && ev.pages.length > 0
        ? ev.pages[0] as { content_urls?: { desktop?: { page?: string } } }
        : null;
      const url = firstPage?.content_urls?.desktop?.page ?? null;
      return { year: ev.year, text: ev.text, url };
    })
    .filter((x): x is OnThisDayItem => x !== null);
}

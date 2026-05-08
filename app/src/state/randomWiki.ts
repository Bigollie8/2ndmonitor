/** Wikipedia random article summary endpoint.
 *  https://en.wikipedia.org/api/rest_v1/page/random/summary
 *  Public, key-less, CORS-friendly. Returns title, extract, thumbnail, URL. */

export interface WikiArticle {
  title: string;
  extract: string;
  url: string;
  thumbnailUrl: string | null;
  fetchedAt: number;
}

export async function fetchRandomArticle(): Promise<WikiArticle | null> {
  try {
    const res = await fetch('https://en.wikipedia.org/api/rest_v1/page/random/summary');
    if (!res.ok) return null;
    const data: unknown = await res.json();
    if (!data || typeof data !== 'object') return null;
    const d = data as {
      title?: unknown;
      extract?: unknown;
      content_urls?: { desktop?: { page?: unknown } };
      thumbnail?: { source?: unknown };
    };
    if (typeof d.title !== 'string' || typeof d.extract !== 'string') return null;
    const url = typeof d.content_urls?.desktop?.page === 'string' ? d.content_urls.desktop.page : '';
    const thumbnailUrl = typeof d.thumbnail?.source === 'string' ? d.thumbnail.source : null;
    return {
      title: d.title,
      extract: d.extract,
      url,
      thumbnailUrl,
      fetchedAt: Date.now() / 1000,
    };
  } catch (err) {
    console.warn('random-wiki fetch failed', err);
    return null;
  }
}

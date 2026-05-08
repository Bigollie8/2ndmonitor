/** The Space Devs Launch Library 2 API.
 *  https://ll.thespacedevs.com/2.2.0/launch/upcoming/
 *  Free public endpoint, key-less, CORS-friendly. Rate limited to 15 req/h
 *  for anonymous access — refresh sparingly. */

export interface SpaceLaunch {
  id: string;
  name: string;
  /** ISO datetime — null when launch isn't scheduled to a precise time yet. */
  net: string | null;
  /** Window start (often same as net for instantaneous windows). */
  windowStart: string | null;
  status: { name: string; abbrev: string };
  provider: string;
  rocket: string;
  pad: string;
  mission: string | null;
  imageUrl: string | null;
}

interface RawLaunch {
  id?: string;
  name?: string;
  net?: string;
  window_start?: string;
  status?: { name?: string; abbrev?: string };
  launch_service_provider?: { name?: string };
  rocket?: { configuration?: { name?: string } };
  pad?: { name?: string; location?: { name?: string } };
  mission?: { name?: string };
  image?: { image_url?: string } | string;
}

export async function fetchUpcomingLaunches(limit: number = 8): Promise<SpaceLaunch[]> {
  try {
    const url = `https://ll.thespacedevs.com/2.2.0/launch/upcoming/?limit=${limit}&mode=list`;
    const res = await fetch(url);
    if (!res.ok) return [];
    const data: unknown = await res.json();
    const results = (data as { results?: unknown }).results;
    if (!Array.isArray(results)) return [];
    return results.map(toLaunch).filter((x): x is SpaceLaunch => x !== null);
  } catch (err) {
    console.warn('launches fetch failed', err);
    return [];
  }
}

function toLaunch(raw: unknown): SpaceLaunch | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as RawLaunch;
  if (typeof r.id !== 'string' || typeof r.name !== 'string') return null;
  const padName = r.pad?.name && r.pad.location?.name
    ? `${r.pad.name}, ${r.pad.location.name}`
    : (r.pad?.name ?? r.pad?.location?.name ?? '');
  let imageUrl: string | null = null;
  if (typeof r.image === 'string') imageUrl = r.image;
  else if (r.image && typeof r.image === 'object' && typeof r.image.image_url === 'string') imageUrl = r.image.image_url;
  return {
    id: r.id,
    name: r.name,
    net: r.net ?? null,
    windowStart: r.window_start ?? null,
    status: { name: r.status?.name ?? '', abbrev: r.status?.abbrev ?? '' },
    provider: r.launch_service_provider?.name ?? '',
    rocket: r.rocket?.configuration?.name ?? '',
    pad: padName,
    mission: r.mission?.name ?? null,
    imageUrl,
  };
}

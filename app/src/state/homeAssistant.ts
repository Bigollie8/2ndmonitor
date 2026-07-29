/** Home Assistant REST API. The user provides the base URL of their HA install
 *  (e.g. http://homeassistant.local:8123) and a long-lived access token. We
 *  poll a configured set of entity_ids and let the user toggle on/off-style
 *  domains (light, switch, fan, input_boolean, automation, scene).
 *
 *  Reference: https://developers.home-assistant.io/docs/api/rest/ */

// The long-lived token lives in the encrypted secret store (see
// state/secrets.ts, key "ha_token"; legacy localStorage key "2mh.ha.token"
// is migrated on first read). Base URL + entity list are not secrets and
// stay in plain localStorage.
const URL_KEY = '2mh.ha.url';
const ENTITIES_KEY = '2mh.ha.entities';

export interface HaState {
  entity_id: string;
  state: string;
  attributes: Record<string, unknown>;
  last_updated: string;
}

export function getStoredUrl(): string {
  return localStorage.getItem(URL_KEY) ?? '';
}
export function setStoredUrl(u: string): void {
  const cleaned = u.trim().replace(/\/$/, '');
  if (cleaned) localStorage.setItem(URL_KEY, cleaned);
  else localStorage.removeItem(URL_KEY);
}
export function getStoredEntities(): string[] {
  const raw = localStorage.getItem(ENTITIES_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed
        .filter((s): s is string => typeof s === 'string')
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
    }
  } catch { /* fall through */ }
  return [];
}
export function setStoredEntities(list: string[]): void {
  const cleaned = list.map((s) => s.trim()).filter((s) => s.length > 0);
  localStorage.setItem(ENTITIES_KEY, JSON.stringify(cleaned));
}

async function authedFetch(url: string, token: string, init?: RequestInit): Promise<Response> {
  return fetch(url, {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });
}

export async function fetchEntityState(baseUrl: string, token: string, entityId: string): Promise<HaState | null> {
  try {
    const res = await authedFetch(`${baseUrl}/api/states/${encodeURIComponent(entityId)}`, token);
    if (!res.ok) return null;
    const data = await res.json();
    if (!data || typeof data !== 'object') return null;
    const d = data as { entity_id?: string; state?: string; attributes?: Record<string, unknown>; last_updated?: string };
    if (typeof d.entity_id !== 'string' || typeof d.state !== 'string') return null;
    return {
      entity_id: d.entity_id,
      state: d.state,
      attributes: d.attributes ?? {},
      last_updated: d.last_updated ?? '',
    };
  } catch (err) {
    console.warn(`HA state fetch failed for ${entityId}`, err);
    return null;
  }
}

export async function fetchAllStates(baseUrl: string, token: string, entityIds: string[]): Promise<HaState[]> {
  const out = await Promise.all(entityIds.map((id) => fetchEntityState(baseUrl, token, id)));
  return out.filter((s): s is HaState => s !== null);
}

/** Domains the tile knows how to toggle. Anything else renders as read-only. */
const TOGGLEABLE_DOMAINS = new Set(['light', 'switch', 'fan', 'input_boolean', 'automation']);
const ACTIONABLE_DOMAINS = new Set([...TOGGLEABLE_DOMAINS, 'scene', 'script']);

export function isToggleable(entityId: string): boolean {
  const dot = entityId.indexOf('.');
  if (dot === -1) return false;
  return TOGGLEABLE_DOMAINS.has(entityId.slice(0, dot));
}

export function isActionable(entityId: string): boolean {
  const dot = entityId.indexOf('.');
  if (dot === -1) return false;
  return ACTIONABLE_DOMAINS.has(entityId.slice(0, dot));
}

export async function callService(
  baseUrl: string,
  token: string,
  entityId: string,
  service: string,
): Promise<boolean> {
  const dot = entityId.indexOf('.');
  if (dot === -1) return false;
  const domain = entityId.slice(0, dot);
  try {
    const res = await authedFetch(`${baseUrl}/api/services/${domain}/${service}`, token, {
      method: 'POST',
      body: JSON.stringify({ entity_id: entityId }),
    });
    return res.ok;
  } catch (err) {
    console.warn('HA service call failed', err);
    return false;
  }
}

/** For toggleable entities, "on" is the on-state; for scene/script we treat
 *  every press as a fire (no toggle semantics). */
export async function pressEntity(baseUrl: string, token: string, entity: HaState): Promise<boolean> {
  const dot = entity.entity_id.indexOf('.');
  if (dot === -1) return false;
  const domain = entity.entity_id.slice(0, dot);

  if (domain === 'scene' || domain === 'script') {
    return callService(baseUrl, token, entity.entity_id, 'turn_on');
  }
  if (TOGGLEABLE_DOMAINS.has(domain)) {
    const next = entity.state === 'on' ? 'turn_off' : 'turn_on';
    return callService(baseUrl, token, entity.entity_id, next);
  }
  return false;
}

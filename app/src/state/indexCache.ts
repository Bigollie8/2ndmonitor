// ─────────────────────────────────────────────────────────────────────────────
// The last good signed index, persisted so the store works offline.
//
// Stores the RAW SIGNED BODY, never a re-serialized object. `server/src/
// index.rs` signs the exact serialized `bundles` array string and the app
// verifies that raw substring — re-serializing would change whitespace or key
// order and break verification. So the cache is a string in, a string out,
// and Rust re-verifies it on read.
//
// Also closes deferred finding #66: offline, the "Removed" row could not name
// what it held, because pass 1 is built-ins only, pass 2's folder was deleted
// and pass 3 was empty. A cached index gives pass 3 something to work with.
// ─────────────────────────────────────────────────────────────────────────────

const PREFIX = 'marketplace.indexCache.';

/** localStorage is a few MB; the index is tens of KB today but grows with the
 *  catalog. Refusing to cache an absurd body is cheaper than discovering the
 *  quota is full at the moment something else needs to write. */
const MAX_BODY = 2 * 1024 * 1024;

/** Namespaced per server: pointing the app at a different marketplace must
 *  not surface the previous server's catalog. Its pinned signing key differs,
 *  so it would fail verification anyway — but returning it at all is wrong. */
export function cacheKeyFor(url: string): string {
  return `${PREFIX}${url.trim().replace(/\/+$/, '')}`;
}

export function readCachedIndex(url: string): string | null {
  try {
    return localStorage.getItem(cacheKeyFor(url));
  } catch {
    return null;
  }
}

export function writeCachedIndex(body: string, url: string): void {
  if (body.length > MAX_BODY) return;
  try {
    localStorage.setItem(cacheKeyFor(url), body);
  } catch {
    // Quota exceeded or storage disabled. A missing cache is a degraded
    // experience, never an error worth surfacing — same silent-failure
    // contract as a missing preview image.
  }
}

export function clearCachedIndex(url: string): void {
  try {
    localStorage.removeItem(cacheKeyFor(url));
  } catch {
    // See writeCachedIndex.
  }
}

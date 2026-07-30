import { useEffect, useState, type ReactNode } from 'react';
import type { CatalogKind } from '../state/catalog';
import { previewCacheKey } from './previewCacheKey';

// ─────────────────────────────────────────────────────────────────────────────
// Renders a bundle's published preview image on a catalog card — the `image`
// branch of previewSource.ts's four-way split (spec C §6). `CatalogCard`
// renders `fallback` on its own for the `glyph`/`placeholder`/`live`
// branches; this component only ever gets mounted for the `image` branch, and
// itself falls back to whatever `fallback` it was given until (and unless)
// the fetch resolves.
//
// The page never fetches the image itself — no `<img src="https://…">`, no
// `fetch()`. Bytes come from the `marketplace_fetch_preview` Tauri command,
// which fetches through the Rust client, caps the response, and sniffs the
// magic number; what reaches the DOM here is only the `data:` URL it returns.
// That is why there is no `img-src` marketplace origin in the CSP — this is
// the only path an image can reach the page by.
// ─────────────────────────────────────────────────────────────────────────────

/** Module-level, shared by every mounted `PreviewImage` — the whole point.
 *  A card scrolling out of view and back remounts this component, and
 *  without a cache that lives outside any one instance it would refetch
 *  every time. Keyed `kind:id@version` (see previewCacheKey.ts).
 *
 *  A failed or invalid fetch is recorded as `null` in this SAME map, not left
 *  absent — spec §9 says a missing thumbnail is silent, but silent must still
 *  mean "asked once", not "asked again every time the card scrolls back into
 *  view". Presence of the key (via `.has`), not truthiness of the value, is
 *  what distinguishes "never asked" from "asked and it has nothing". */
const cache = new Map<string, string | null>();

/** In-flight request de-dup, keyed the same as `cache`. Needed because a
 *  cache MISS is not, by itself, exclusive: React 18 StrictMode's dev-only
 *  double-effect (mount → cleanup → mount) fires this effect twice in a row
 *  before the first run's `await invoke(...)` has resolved, so a second
 *  concurrent mount would see `cache.get(k) === undefined` too and start a
 *  second real IPC call — observed live (fetchCount reached 2 on a single
 *  first mount) before this map was added. Recording the in-flight promise
 *  here, and having every caller for the same key await THAT promise instead
 *  of starting its own, makes "attempted once" hold even when two effect
 *  invocations race, not just across genuine unmount/remount. */
const inflight = new Map<string, Promise<string | null>>();

export function PreviewImage({
  id, version, kind, url, fallback,
}: {
  id: string;
  version: string;
  kind: CatalogKind;
  /** Effective marketplace URL — pass `cfgUrl()` (state/marketplaceConfig.ts). */
  url: string;
  /** Shown until the fetch resolves, and permanently if it fails. Never a
   *  blank frame in between: initial render reads any already-cached answer
   *  synchronously, so a re-mounted (e.g. scrolled back into view) card with
   *  a cache hit never flashes the fallback before its image, and a cache
   *  miss shows the fallback immediately rather than nothing while the fetch
   *  is in flight. */
  fallback: ReactNode;
}) {
  const key = previewCacheKey(kind, id, version);
  const [dataUrl, setDataUrl] = useState<string | null>(() => cache.get(key) ?? null);

  useEffect(() => {
    const k = previewCacheKey(kind, id, version);
    const cached = cache.get(k);
    if (cached !== undefined) {
      // Already attempted (success or recorded failure) — do not refetch,
      // and sync state in case this instance mounted with a different
      // id/version than the one its initializer captured.
      setDataUrl(cached);
      return;
    }
    let cancelled = false;
    // Join an already-running fetch for this exact key rather than starting
    // a second one (see `inflight`'s doc comment) — this is what makes
    // "attempted once" hold under StrictMode's double-effect, not just
    // across a real unmount/remount.
    const existing = inflight.get(k);
    const promise = existing ?? (async (): Promise<string | null> => {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        const result = await invoke<string>('marketplace_fetch_preview', { url, id, version, kind });
        cache.set(k, result);
        return result;
      } catch {
        // Silent by design (spec §9) — a missing/unreachable/malformed
        // preview is not worth interrupting a user over. Cached as `null` so
        // this is attempted once, not once per scroll.
        cache.set(k, null);
        return null;
      } finally {
        inflight.delete(k);
      }
    })();
    if (!existing) inflight.set(k, promise);
    void promise.then((result) => { if (!cancelled) setDataUrl(result); });
    return () => { cancelled = true; };
  }, [id, version, kind, url]);

  if (dataUrl == null) return <>{fallback}</>;
  return (
    <img
      src={dataUrl}
      alt=""
      style={{ width: '100%', height: '100%', objectFit: 'cover' }}
    />
  );
}

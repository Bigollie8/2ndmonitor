import { useEffect, useState, type ReactNode } from 'react';
import type { CatalogKind } from '../state/catalog';
import { previewCacheKey } from './previewCacheKey';
import { loadPreview, peekPreview } from './previewCache';

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
//
// The actual cache/in-flight-dedup DECISION lives in previewCache.ts (a pure
// module, node-testable without mounting React) — this component is just the
// effect that computes the key and applies the result.
// ─────────────────────────────────────────────────────────────────────────────

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
  const [dataUrl, setDataUrl] = useState<string | null>(() => peekPreview(key) ?? null);

  useEffect(() => {
    const k = previewCacheKey(kind, id, version);
    // Reset synchronously to THIS key's answer the moment the key changes on
    // an already-mounted instance — e.g. `availableVersion` bumping between
    // index refreshes on the same catalog item. `catalogKey` (state/
    // catalog.ts) is `kind:id`, with no version, so a version bump does not
    // change `CatalogCard`'s React key: the same `PreviewImage` instance
    // stays mounted and this effect re-runs with new props instead of
    // remounting. Without this line, `dataUrl` would keep showing the OLD
    // version's cached image while the new fetch is in flight. Reading
    // `peekPreview` gives the right answer either way: a cached new-version
    // image shows instantly, otherwise the fallback shows while it loads.
    setDataUrl(peekPreview(k) ?? null);

    let cancelled = false;
    void loadPreview(k, async () => {
      const { invoke } = await import('@tauri-apps/api/core');
      return invoke<string>('marketplace_fetch_preview', { url, id, version, kind });
    }).then((result) => {
      // Silent on failure by design (spec §9) — `loadPreview` already
      // recorded it as `null`; a missing/unreachable/malformed preview is
      // not worth interrupting a user over.
      if (!cancelled) setDataUrl(result);
    });
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

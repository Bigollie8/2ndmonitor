# Catalog previews — design (spec C)

**Date:** 2026-07-30
**Branch:** `feat/milkdrop-visualizer`
**Scope:** piece **C** of the marketplace uplevel program. Ratings (D), the DOM sandbox (E) and the migration waves (F) are separate specs.

---

## 1. Goal

Every catalog card shows what the thing actually looks like. Today they show a grey placeholder rectangle, which makes a 65-item catalog unreadable at a glance — the exact problem the unified catalog was meant to solve.

## 2. Two kinds of preview, because the two kinds of content differ

**Visualizers preview themselves.** The app already owns a sandbox that renders bundle code to a canvas from an audio frame feed. A visualizer card can therefore run the real thing, live, reacting to whatever is playing. No asset to publish, nothing to store server-side, no trust decision — the code is already sandboxed, and a preview runs it in the same jail as the real surface.

**Tiles cannot.** A tile's value is its live data, and rendering one in a card would mean granting network permission and credentials before install — precisely backwards. Tiles therefore get a **published preview image**.

This asymmetry is the design. It is not a compromise; it follows from what each kind of content is.

## 3. Preview images are served, not bundled

A tile's preview image is uploaded at submission and served from the marketplace at `GET /bundle/:id/:version/preview` — **not** placed inside the bundle zip.

The alternative — adding `preview.png` to the zip-entry allowlist — was rejected. That allowlist is exactly `{manifest.json, main.js, preset.json, view.json}`, exact-string matched, and it is the boundary that makes `install_bundle_zip` the single trusted write path. Admitting binary content to it would mean decoding untrusted image bytes on the install path, and would put images in every user's install directory forever. Serving them separately keeps the allowlist untouched and keeps preview delivery entirely outside the install path.

The signed index gains one boolean per bundle, `hasPreview`, so the app knows whether to request an image without a speculative round trip. It sits inside the signed `bundles` array, so it is covered by the existing signature.

## 4. Fetching images without touching CSP

The app's CSP has no `img-src` for the marketplace host, and adding one would let any page-level image reference reach out. Instead the preview is fetched **through the existing Rust client** as bytes, size-capped, sniffed for a real PNG/JPEG magic number, and handed to the frontend as a data URL.

This reuses the verified-fetch path already used for the index and for bundles, keeps the renderer unable to make its own network requests, and means a hostile server can at worst serve a broken image rather than reach the network from the page context.

Cap: **256 KB** per preview, rejected above that. Non-image bytes are rejected on the magic number, not the declared content type.

## 5. Rendering the live visualizer previews

A card-sized live sandbox per visualizer is the good version of this feature and also the way to melt a laptop. Constraints:

- **Only visible cards render.** An `IntersectionObserver` starts a preview when its card scrolls into view and tears it down when it leaves.
- **A hard concurrency cap of 6** live preview sandboxes. Beyond that, cards queue and show their static fallback until a slot frees.
- **Previews pause when the window hides**, reusing the existing `hub://window-visibility` event that already pauses the main visualizer rAF loop.
- Preview sandboxes run at a reduced frame budget (target 30fps, not the main surface's cap) and at card resolution.
- A preview that errors falls back to the static treatment and does not retry — a bundle that throws on every frame must not spin.

## 6. Fallbacks, in order

1. Visualizer with installed code → live sandbox preview.
2. Tile or uninstalled visualizer with `hasPreview` → fetched image.
3. First-party item → its existing geometric glyph from `TILE_META`, rendered large. These never get published previews, because they are never published.
4. Anything else → the current placeholder block.

Every card renders something. No card is ever blank while a preview loads; the fallback shows first and the preview replaces it.

## 7. Publishing

`scripts/bundles.mjs` gains preview handling: a bundle directory may contain `preview.png`, which the `publish` verb uploads alongside the submission and the `seed` verb ignores (seeds are installed locally and their previews come from the index like any other). The server stores the image on the submission row and serves it only once the bundle is approved, matching how bundle zips are already gated on `status = 'approved'`.

Bundles without a preview are still publishable — `hasPreview` is simply false.

## 8. Server changes

- `bundles` table gains `preview BLOB` and the index query gains `preview IS NOT NULL AS hasPreview`.
- `POST /submissions` accepts an optional base64 `preview` field, validated as a real PNG/JPEG under 256 KB before storage.
- `GET /bundle/:id/:version/preview` serves it with the right content type, 404 when absent or unapproved.
- The admin review page shows the preview, so a human approving a bundle can see what they are approving.

## 9. Error handling

- Preview fetch fails → the fallback stays. No error surface; a missing thumbnail is not worth interrupting a user over.
- Preview image decodes to nothing → fallback, and the bad `hasPreview` is not cached as true.
- Live preview sandbox fails to init → fallback, no retry, and the failure is logged once.
- Server-side, an oversized or non-image upload is rejected at submission with a specific message rather than stored and served broken.

## 10. Testing

- Pure: the fallback-selection rule (which of the four branches an item takes) as a tested function, mirroring `catalogCardTags`.
- Pure: the image-bytes validator — magic-number sniffing, the size cap, and rejection of a PNG header followed by garbage.
- Rust: the fetch path's cap and content sniffing, mirroring the existing `FETCH_CAP` tests.
- Server: submission accepts a valid PNG, rejects an oversized one, rejects a non-image; the index reports `hasPreview` correctly; the endpoint 404s for an unapproved bundle.
- Live, in the app: previews appear, only visible cards render, the concurrency cap holds, and previews stop when the window hides.

## 11. Explicitly out of scope

Ratings (D), the DOM sandbox (E), the migration waves (F). Animated preview *images* (APNG/WebP) — visualizers animate live and tiles are static, so there is no case for them. Preview capture tooling: previews are authored, not screenshotted by the app.

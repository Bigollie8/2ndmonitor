// ─────────────────────────────────────────────────────────────────────────────
// One decision, in one place: what image represents a person?
//
// An uploaded picture when they have one, their generated identicon when they
// do not. Everywhere — creator pages, the directory, comments, the forum, the
// shoutbox, your own profile — so the same person never appears as two
// different things in two places.
// ─────────────────────────────────────────────────────────────────────────────
import { identiconDataUri } from './identicon';
import { cfgUrl } from './marketplaceConfig';

/** `hasAvatar` comes from the server (`/creators/:handle` and the directory).
 *  When it is false — or when there is no handle to fetch one by — this
 *  returns the identicon data URI, so callers never deal with a broken image.
 *
 *  `cacheBust` forces a fresh fetch after someone changes their own picture;
 *  without it the 300s cache header would leave them looking at the old one
 *  and reasonably conclude the upload failed. */
export function avatarSrc(opts: {
  handle: string | null | undefined;
  hasAvatar?: boolean;
  seed?: string | null;
  size?: number;
  cacheBust?: number;
}): string {
  const { handle, hasAvatar, seed, size = 64, cacheBust } = opts;
  if (hasAvatar && handle) {
    const base = cfgUrl().replace(/\/+$/, '');
    const suffix = cacheBust ? `?v=${cacheBust}` : '';
    return `${base}/creators/${encodeURIComponent(handle)}/avatar${suffix}`;
  }
  return identiconDataUri(seed || handle || '?', size);
}

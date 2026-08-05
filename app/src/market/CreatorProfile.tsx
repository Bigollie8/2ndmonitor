import { useEffect, useState, type MutableRefObject } from 'react';
import type { CatalogItem } from '../state/catalog';
import type { SpectrumState } from '../state/tauri';
import { identiconDataUri } from '../state/identicon';
import { cfgUrl } from '../state/marketplaceConfig';
import { MarketCard } from './MarketCard';
import { FollowButton } from './FollowButton';
import { BadgeChips } from './BadgeChips';
import { ProfileDashboard } from '../community/ProfileDashboard';

const MONO = '"JetBrains Mono", ui-monospace, monospace';

export interface CreatorBundle {
  id: string;
  version: string;
  kind: string;
  name: string;
  summary: string | null;
  category: string | null;
  downloads: number;
  approvedAt: number | null;
}

export interface Creator {
  handle: string;
  /** Their chosen profile colour, or null. Server guarantees #rrggbb. */
  accent?: string | null;
  /** Admin-granted. Unknown slugs still render (state/badges.ts). */
  badges?: unknown;
  displayName: string | null;
  bio: string | null;
  links: string[];
  avatarSeed: string;
  createdAt: number;
  bundles: CreatorBundle[];
  totalDownloads: number;
}

/** A creator's public page, served by the marketplace.
 *
 *  Replaces the derived `AuthorPage`, which grouped the signed index by
 *  `authorDisplay` and therefore could only ever title itself with a masked
 *  email. This one has a name, a bio and an avatar because there is finally a
 *  writer for those columns.
 *
 *  Cards are rendered from the LOCAL catalog where the item is known, so
 *  install state, ratings and previews all stay correct — the endpoint's own
 *  bundle list is only used to decide which items belong to this creator, and
 *  as the fallback when the catalog has not seen one. */
export function CreatorProfile({
  handle, items, accent, accent2, spectrumRef, appVersion, glyphOf, cardMin, signedIn, onOpen,
}: {
  handle: string;
  /** Gates the follow toggle; the count shows regardless. */
  signedIn: boolean;
  /** The merged catalog, for resolving each published id to a real card. */
  items: CatalogItem[];
  accent: string;
  accent2: string;
  spectrumRef?: MutableRefObject<SpectrumState>;
  appVersion: string;
  glyphOf: (item: CatalogItem) => string | null;
  cardMin: number;
  onOpen: (item: CatalogItem) => void;
}) {
  const [creator, setCreator] = useState<Creator | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setCreator(null);
    setFailed(false);
    void (async () => {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        const res = await invoke<Creator>('marketplace_fetch_creator', { url: cfgUrl(), handle });
        if (!cancelled) setCreator(res);
      } catch {
        // Unsigned browse data on the ratings contract: a failure means "no
        // profile", never an error worth interrupting browsing over.
        if (!cancelled) setFailed(true);
      }
    })();
    return () => { cancelled = true; };
  }, [handle]);

  if (failed) {
    return (
      <div style={{ padding: 18, fontSize: 11.5, color: 'rgba(255,255,255,0.45)' }}>
        Could not load @{handle} right now.
      </div>
    );
  }
  if (!creator) {
    return (
      <div style={{ padding: 18, fontSize: 11.5, color: 'rgba(255,255,255,0.35)' }}>
        Loading @{handle}…
      </div>
    );
  }

  // Their colour on their page, the app's otherwise. The server constrains
  // it to #rrggbb, so this can only ever be a colour.
  const tint = creator.accent ?? accent;
  const byId = new Map(items.map((i) => [i.id, i]));
  const cards = creator.bundles
    .map((b) => byId.get(b.id))
    .filter((i): i is CatalogItem => i != null && !i.removed);

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: 18 }}>
      <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
        <img
          src={identiconDataUri(creator.avatarSeed || creator.handle, 72)}
          alt=""
          width={72}
          height={72}
          style={{ borderRadius: 12, flexShrink: 0, border: `1px solid ${creator.accent ?? 'rgba(255,255,255,0.09)'}` }}
        />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 18, fontWeight: 700, color: 'rgba(255,255,255,0.95)' }}>
            {creator.displayName ?? creator.handle}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 2, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 11, fontFamily: MONO, color: tint }}>@{creator.handle}</span>
            <BadgeChips badges={creator.badges} />
          </div>
          {creator.bio && (
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.66)', marginTop: 8, lineHeight: 1.45 }}>
              {creator.bio}
            </div>
          )}
          {creator.links.length > 0 && (
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 8 }}>
              {creator.links.map((l) => (
                <a
                  key={l}
                  href={l}
                  target="_blank"
                  rel="noreferrer noopener"
                  style={{ fontSize: 11, fontFamily: MONO, color: 'rgba(255,255,255,0.5)' }}
                >{l.replace(/^https:\/\//, '')}</a>
              ))}
            </div>
          )}
          <div style={{ fontSize: 10.5, fontFamily: MONO, color: 'rgba(255,255,255,0.35)', marginTop: 8 }}>
            {creator.bundles.length} published · {creator.totalDownloads} installs
          </div>
          <div style={{ marginTop: 10 }}>
            <FollowButton handle={creator.handle} accent={tint} signedIn={signedIn} />
          </div>
        </div>
      </div>

      {cards.length > 0 ? (
        <div style={{
          display: 'grid', gap: 12, marginTop: 18,
          gridTemplateColumns: `repeat(auto-fill, minmax(${cardMin}px, 1fr))`,
        }}>
          {cards.map((item) => (
            <MarketCard
              key={item.key}
              item={item}
              accent={accent}
              accent2={accent2}
              spectrumRef={spectrumRef}
              appVersion={appVersion}
              glyph={glyphOf(item)}
              onOpen={() => onOpen(item)}
            />
          ))}
        </div>
      ) : (
        <div style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.45)', marginTop: 18 }}>
          {creator.bundles.length === 0
            ? 'Nothing published yet.'
            : 'Their published work is not in your catalog right now.'}
        </div>
      )}
    </div>
  );
}

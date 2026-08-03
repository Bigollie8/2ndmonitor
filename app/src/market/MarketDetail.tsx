import { useState, type MutableRefObject } from 'react';
import type { CatalogItem } from '../state/catalog';
import type { SpectrumState } from '../state/tauri';
import type { BundleHistory } from '../state/catalogVersions';
import { canLivePreview } from '../components/previewSource';
import { LivePreview } from '../components/LivePreview';
import { StarRating } from '../components/StarRating';
import { PermissionList } from './PermissionList';
import { InstallButton } from './InstallButton';
import { MediaGallery } from './MediaGallery';
import { ReviewList } from './ReviewList';
import { ReviewForm } from './ReviewForm';
import { authorLabelOf } from '../state/authorIndex';
import { glyphFor } from './MarketCard';

const MONO = '"JetBrains Mono", ui-monospace, monospace';

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <div style={{ marginTop: 18 }}>
    <div style={{
      fontSize: 9, fontFamily: MONO, fontWeight: 700, letterSpacing: '0.12em',
      color: 'rgba(255,255,255,0.28)', textTransform: 'uppercase', marginBottom: 7,
    }}>{title}</div>
    {children}
  </div>
);

const dateOf = (sec: number | null): string =>
  sec == null ? '—' : new Date(sec * 1000).toLocaleDateString();

/** The detail body: one item, everything known about it, and the single
 *  place install happens.
 *
 *  The media gallery arrives in Phase 5 — until then the hero is the existing
 *  single preview, shown large. */
export function MarketDetail({
  item, history, accent, accent2, spectrumRef, appVersion, glyph: tileGlyph,
  busy, disabled, signedIn, ratingBusy, onRate, onInstall, onOpenLibrary, onTag,
  onAuthor, onReviewError,
}: {
  item: CatalogItem;
  history: BundleHistory | undefined;
  accent: string;
  accent2: string;
  spectrumRef?: MutableRefObject<SpectrumState>;
  appVersion: string;
  glyph: string | null;
  busy: boolean;
  disabled: boolean;
  signedIn: boolean;
  ratingBusy: boolean;
  onRate: (stars: number) => void;
  onInstall: () => void;
  onOpenLibrary: () => void;
  onTag: (tag: string) => void;
  onAuthor: (author: string) => void;
  /** A failed review post is flashed by the shell, unlike a failed fetch. */
  onReviewError: (message: string) => void;
}) {
  const [reviewKey, setReviewKey] = useState(0);
  const authorLabel = authorLabelOf(item);
  const glyph = glyphFor(item, tileGlyph);
  const fallbackContent = (
    <span style={{ fontSize: 56, fontWeight: 700, color: `${accent}cc` }}>{glyph}</span>
  );
  // Auto-mounted, unlike a card's hover-gated preview: this is ONE sandbox
  // for one item the user deliberately opened, not six speculative ones. The
  // finding-31 rule is about ambient mounting, not about live rendering.
  const live = canLivePreview(item);

  return (
    <div style={{ padding: 18, overflowY: 'auto', flex: 1 }}>
      {/* The live render sits BESIDE the gallery, never in place of it: they
          answer different questions ("what does this do on my machine" vs
          "what did the author intend to show"), and an uninstalled bundle has
          only the gallery. */}
      <MediaGallery item={item} accent={accent} fallback={fallbackContent} />

      {live && (
        <div style={{
          aspectRatio: '16 / 9', borderRadius: 12, overflow: 'hidden', marginTop: 10,
          background: `linear-gradient(135deg, ${accent}22, ${accent}08)`,
          border: `1px solid ${accent}2a`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <LivePreview
            bundleId={item.id}
            accent={accent}
            accent2={accent2}
            spectrumRef={spectrumRef}
            fallback={fallbackContent}
          />
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 14 }}>
        <span style={{ fontSize: 18, fontWeight: 700, color: 'rgba(255,255,255,0.95)' }}>
          {item.name}
        </span>
        <span style={{ fontSize: 10, fontFamily: MONO, color: 'rgba(255,255,255,0.35)' }}>
          {item.kind} · v{item.installed ? item.installedVersion : item.availableVersion ?? '—'}
        </span>
      </div>

      {/* Linked only where there is an author to link to: a first-party
          built-in has no publisher, so no link is offered rather than one
          leading to an empty page. */}
      {authorLabel ? (
        <button
          onClick={() => onAuthor(authorLabel)}
          style={{
            background: 'transparent', border: 'none', padding: 0, marginTop: 3, cursor: 'pointer',
            fontSize: 11, fontFamily: MONO, color: accent, textAlign: 'left',
          }}
        >by {authorLabel} ›</button>
      ) : item.authorDisplay ? (
        <div style={{ fontSize: 11, fontFamily: MONO, color: 'rgba(255,255,255,0.4)', marginTop: 3 }}>
          by {item.authorDisplay}
        </div>
      ) : null}

      {item.summary && (
        <div style={{ fontSize: 12.5, color: 'rgba(255,255,255,0.72)', marginTop: 10, lineHeight: 1.45 }}>
          {item.summary}
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 14 }}>
        <InstallButton
          item={item}
          accent={accent}
          appVersion={appVersion}
          busy={busy}
          disabled={disabled}
          onInstall={onInstall}
          onOpenLibrary={onOpenLibrary}
        />
        <StarRating
          rating={item.rating}
          signedIn={signedIn}
          ratable={item.source !== 'first-party'}
          busy={ratingBusy}
          onRate={onRate}
        />
      </div>

      {item.tags.length > 0 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 12 }}>
          {item.tags.map((t) => (
            <button
              key={t}
              onClick={() => onTag(t)}
              style={{
                padding: '3px 9px', borderRadius: 999, fontSize: 10.5, fontFamily: MONO,
                background: 'rgba(255,255,255,0.04)', color: 'rgba(255,255,255,0.6)',
                border: '1px solid rgba(255,255,255,0.09)', cursor: 'pointer',
              }}
            >#{t}</button>
          ))}
        </div>
      )}

      {item.description && item.description !== item.summary && (
        <Section title="About">
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.65)', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
            {item.description}
          </div>
        </Section>
      )}

      <Section title="Permissions">
        <PermissionList permissions={item.permissions} accent={accent} />
      </Section>

      <Section title="Versions">
        {history && history.versions.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {history.versions.map((v) => (
              <div key={v.version}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
                  <span style={{ fontSize: 11.5, fontFamily: MONO, color: 'rgba(255,255,255,0.75)' }}>
                    v{v.version}
                  </span>
                  <span style={{ fontSize: 10, fontFamily: MONO, color: 'rgba(255,255,255,0.3)' }}>
                    {dateOf(v.approvedAt)}
                  </span>
                </div>
                {v.changelog && (
                  <div style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.55)', marginTop: 2, whiteSpace: 'pre-wrap' }}>
                    {v.changelog}
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.4)' }}>
            No published version history.
          </div>
        )}
      </Section>

      <Section title="Reviews">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <ReviewForm
            bundleId={item.id}
            accent={accent}
            signedIn={signedIn}
            onPosted={() => setReviewKey((n) => n + 1)}
            onError={onReviewError}
          />
          <ReviewList bundleId={item.id} accent={accent} reloadKey={reviewKey} />
        </div>
      </Section>

      <Section title="Details">
        <div style={{
          display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '5px 14px',
          fontSize: 11, fontFamily: MONO, color: 'rgba(255,255,255,0.55)',
        }}>
          <span style={{ color: 'rgba(255,255,255,0.32)' }}>installs</span>
          <span>{item.downloads ?? '—'}</span>
          <span style={{ color: 'rgba(255,255,255,0.32)' }}>rating</span>
          <span>{item.rating ? `${item.rating.avg} (${item.rating.count})` : 'unrated'}</span>
          <span style={{ color: 'rgba(255,255,255,0.32)' }}>published</span>
          <span>{dateOf(history?.publishedAt ?? null)}</span>
          <span style={{ color: 'rgba(255,255,255,0.32)' }}>updated</span>
          <span>{dateOf(history?.updatedAt ?? null)}</span>
          <span style={{ color: 'rgba(255,255,255,0.32)' }}>category</span>
          <span>{item.category}</span>
          {item.minAppVersion && (
            <>
              <span style={{ color: 'rgba(255,255,255,0.32)' }}>needs app</span>
              <span>{item.minAppVersion}</span>
            </>
          )}
        </div>
      </Section>
    </div>
  );
}

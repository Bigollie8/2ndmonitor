import { tileLabel } from '../state/layoutWireframe';
import type { PublishedLayout, PublishedTile } from '../state/layoutPublish';

const MONO = '"JetBrains Mono", ui-monospace, monospace';

/** A creator's layout rendered as a real arrangement — their dashboard as
 *  their portrait.
 *
 *  This draws the STRUCTURE, not live data. Every tile sits at its true
 *  fractional rect with its real name, so the shape is exactly the dashboard
 *  they designed, but nothing here mounts a tile or fetches anything.
 *
 *  That is a deliberate line, not a shortcut. A published layout carries no
 *  config by design (state/layoutPublish.ts strips it field-by-field), so
 *  there is nothing to render live FROM — and running real tiles inside a
 *  profile page would mean somebody else's page deciding what network calls
 *  your app makes. The arrangement is the interesting part anyway: it is
 *  what makes one person's dashboard recognisably theirs. */
export function ProfileDashboard({ layout, accent, height = 190 }: {
  layout: PublishedLayout;
  accent: string;
  height?: number;
}) {
  const tiles: PublishedTile[] = layout.landscape?.length ? layout.landscape : layout.portrait ?? [];
  if (tiles.length === 0) return null;

  // The layout's own accent when it has a valid one — same rule the
  // wireframe applies, and it keeps a creator's colour with their work.
  const tint = /^#[0-9a-fA-F]{3,8}$/.test(layout.theme?.accent ?? '') ? layout.theme.accent : accent;

  return (
    <div
      style={{
        position: 'relative', width: '100%', height,
        borderRadius: 10, overflow: 'hidden',
        background: `linear-gradient(140deg, ${tint}14, rgba(0,0,0,0.35))`,
        border: `1px solid ${tint}33`,
      }}
    >
      {tiles.map((t, i) => {
        const label = tileLabel(String(t.type));
        // Rects are fractions of the canvas, already clamped to 0..1 at
        // publish time, so percentages map straight across at any size.
        const w = `${t.rect.w * 100}%`;
        const h = `${t.rect.h * 100}%`;
        const tiny = t.rect.w < 0.14 || t.rect.h < 0.14;
        return (
          <div
            key={`${t.type}-${i}`}
            title={label}
            style={{
              position: 'absolute',
              left: `${t.rect.x * 100}%`,
              top: `${t.rect.y * 100}%`,
              width: w,
              height: h,
              padding: 3,
              boxSizing: 'border-box',
            }}
          >
            <div style={{
              width: '100%', height: '100%', borderRadius: 6,
              background: 'rgba(255,255,255,0.05)',
              border: `1px solid ${tint}2e`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              overflow: 'hidden',
            }}>
              {/* Hidden on blocks too small to hold it — a spilling label
                  stops the whole thing reading as a layout. */}
              {!tiny && (
                <span style={{
                  fontSize: 8.5, fontFamily: MONO, letterSpacing: '0.04em',
                  color: 'rgba(255,255,255,0.5)', textAlign: 'center',
                  padding: '0 4px', lineHeight: 1.2,
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  maxWidth: '100%',
                }}>{label}</span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

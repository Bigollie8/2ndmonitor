import { useEffect, useState } from 'react';
import { fetchCreators, type DirectoryCreator } from '../state/community';
import { avatarSrc } from '../state/avatarUrl';
import { BadgeChips } from '../market/BadgeChips';

const MONO = '"JetBrains Mono", ui-monospace, monospace';

/** Everyone who has claimed a handle, browsable and searchable.
 *
 *  Search is debounced and runs on the SERVER — the directory is not
 *  necessarily small, and filtering a truncated first page in the client
 *  would quietly hide people. */
export function CreatorsDirectory({ accent, onOpenCreator }: {
  accent: string;
  onOpenCreator: (handle: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [creators, setCreators] = useState<DirectoryCreator[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      setFailed(false);
      void fetchCreators(query)
        .then((list) => { if (!cancelled) setCreators(list); })
        .catch(() => { if (!cancelled) { setCreators([]); setFailed(true); } });
    }, query ? 220 : 0);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [query]);

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: 18 }}>
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search creators…"
        spellCheck={false}
        style={{
          width: '100%', maxWidth: 340, padding: '7px 10px', fontSize: 12,
          background: 'rgba(255,255,255,0.05)', color: '#fff', outline: 'none',
          border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, boxSizing: 'border-box',
        }}
      />

      {creators == null ? (
        <div style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.35)', marginTop: 16 }}>Loading…</div>
      ) : failed ? (
        <div style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.45)', marginTop: 16 }}>
          Could not reach the marketplace right now.
        </div>
      ) : creators.length === 0 ? (
        <div style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.45)', marginTop: 16 }}>
          {query ? `Nobody matches “${query}”.` : 'No creators yet.'}
        </div>
      ) : (
        <div style={{
          display: 'grid', gap: 10, marginTop: 16,
          gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))',
        }}>
          {creators.map((c) => {
            // Their accent if they picked one, the app's otherwise. Server
            // guarantees #rrggbb, so it can only ever be a colour.
            const tint = c.accent ?? accent;
            return (
              <button
                key={c.handle}
                onClick={() => onOpenCreator(c.handle)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 11, textAlign: 'left',
                  padding: '10px 12px', borderRadius: 10, cursor: 'pointer',
                  background: 'rgba(255,255,255,0.025)',
                  border: `1px solid ${tint}22`,
                }}
              >
                <img
                  src={avatarSrc({ handle: c.handle, hasAvatar: c.hasAvatar, seed: c.avatarSeed, size: 38 })}
                  alt="" width={38} height={38}
                  style={{ borderRadius: 9, border: `1px solid ${tint}55`, flexShrink: 0, objectFit: 'cover' }}
                />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{
                    fontSize: 12.5, fontWeight: 600, color: 'rgba(255,255,255,0.9)',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>{c.displayName ?? c.handle}</div>
                  <div style={{ fontSize: 10, fontFamily: MONO, color: tint, marginTop: 1 }}>
                    @{c.handle}
                  </div>
                  <div style={{ marginTop: 4 }}>
                    <BadgeChips badges={c.badges} size="small" />
                  </div>
                  <div style={{ fontSize: 9.5, fontFamily: MONO, color: 'rgba(255,255,255,0.35)', marginTop: 4 }}>
                    {c.published} published · {c.followers} follower{c.followers === 1 ? '' : 's'}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

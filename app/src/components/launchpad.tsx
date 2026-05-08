import type { Bookmark } from './browser-player';

interface LaunchpadProps {
  bookmarks: Bookmark[];
  onPick: (url: string) => void;
}

export function Launchpad({ bookmarks, onPick }: LaunchpadProps) {
  if (bookmarks.length === 0) {
    return (
      <div style={{
        position: 'absolute', inset: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: 'rgba(255,255,255,0.55)', fontSize: 13,
        fontFamily: '"JetBrains Mono", ui-monospace, monospace',
        textAlign: 'center', padding: 24, lineHeight: 1.5,
      }}>
        <div>
          <div style={{ fontSize: 32, marginBottom: 12 }}>📺</div>
          <div style={{ color: 'rgba(255,255,255,0.85)', fontWeight: 600, marginBottom: 4 }}>
            No bookmarks yet
          </div>
          <div>Add one in Tweaks → Video → Bookmarks.</div>
        </div>
      </div>
    );
  }

  return (
    <div style={{
      position: 'absolute', inset: 0, padding: 24, overflow: 'auto',
    }}>
      <div style={{
        display: 'grid', gap: 14,
        gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
      }}>
        {bookmarks.map((b) => (
          <button
            key={b.id}
            onClick={() => onPick(b.url)}
            style={{
              aspectRatio: '4 / 3',
              background: b.color,
              border: 'none', borderRadius: 12,
              color: '#fff', cursor: 'pointer',
              display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center', gap: 6,
              boxShadow: '0 4px 14px rgba(0,0,0,0.35)',
              transition: 'transform 120ms ease, box-shadow 120ms ease',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.transform = 'translateY(-2px)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.transform = 'translateY(0)'; }}
          >
            <div style={{
              fontSize: 36, fontWeight: 800, letterSpacing: '-0.02em',
              textShadow: '0 2px 6px rgba(0,0,0,0.35)',
              fontFamily: '"JetBrains Mono", ui-monospace, monospace',
            }}>{b.letters}</div>
            <div style={{ fontSize: 12, fontWeight: 600, opacity: 0.95 }}>{b.name}</div>
          </button>
        ))}
      </div>
    </div>
  );
}

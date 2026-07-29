import { useEffect, useMemo, useState } from 'react';
import type { TileType, TileInstance, Rect, Orientation } from '../state/layout';
import {
  ALL_TILE_TYPES,
  DEFAULT_LANDSCAPE_LAYOUT,
  DEFAULT_PORTRAIT_LAYOUT,
  findEmptyRect,
} from '../state/layout';
import { TILE_META, TILE_CATEGORY_LABELS, type TileCategory } from '../state/tileMeta';
import { MarketplaceTab } from './MarketplaceTab';

const MONO = '"JetBrains Mono", ui-monospace, monospace';

const CATEGORY_ORDER = Object.keys(TILE_CATEGORY_LABELS) as TileCategory[];

/** The one canonical tile-management surface: search, category chips, and
 *  explicit Add / Remove buttons per card. Clicking a card body never
 *  adds or removes — only the buttons do. Same external contract as the old
 *  edit-mode picker gallery so edit mode and App can drop it in. */
export function TileLibrary({
  orientation, canvas, tiles, profileName, accent,
  onAdd, onRemove, onClose,
}: {
  orientation: Orientation;
  canvas: { w: number; h: number };
  tiles: TileInstance[];
  profileName: string;
  accent: string;
  onAdd: (type: TileType, rect: Rect) => void;
  onRemove: (instanceId: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState<TileCategory | 'all'>('all');
  const [showMarket, setShowMarket] = useState(false);

  // Esc closes the modal (capture + stopPropagation so App's cascade doesn't
  // also fire).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  const defaults = orientation === 'portrait' ? DEFAULT_PORTRAIT_LAYOUT : DEFAULT_LANDSCAPE_LAYOUT;

  const handleAdd = (type: TileType) => {
    const preferred = defaults[type];
    const rect = findEmptyRect(tiles.map((t) => t.rect), preferred, canvas);
    onAdd(type, rect);
  };

  /** Remove the most recently added instance of a type (last in the array —
   *  addInstance appends). */
  const handleRemove = (type: TileType) => {
    const instances = tiles.filter((t) => t.type === type);
    const last = instances[instances.length - 1];
    if (last) onRemove(last.instanceId);
  };

  // Search filters on label + description substring; combines with the
  // active category chip. Chip counts are live (they reflect the search).
  const q = query.trim().toLowerCase();
  const searchMatches = useMemo(
    () => ALL_TILE_TYPES.filter((id) => {
      if (!q) return true;
      const meta = TILE_META[id];
      return `${meta.label} ${meta.description}`.toLowerCase().includes(q);
    }),
    [q],
  );
  const countFor = (cat: TileCategory | 'all') =>
    cat === 'all'
      ? searchMatches.length
      : searchMatches.filter((id) => TILE_META[id].category === cat).length;
  const visible = searchMatches.filter(
    (id) => activeCategory === 'all' || TILE_META[id].category === activeCategory,
  );

  return (
    <div
      onClick={onClose}
      style={{
        position: 'absolute', inset: 0, zIndex: 70,
        background: 'rgba(8,9,12,0.55)', backdropFilter: 'blur(2px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(820px, 92%)', maxHeight: '82%',
          background: 'rgba(20,22,28,0.98)', backdropFilter: 'blur(20px)',
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: 12, boxShadow: '0 24px 60px rgba(0,0,0,0.5)',
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div style={{
          padding: '12px 18px', borderBottom: '1px solid rgba(255,255,255,0.06)',
          display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0,
        }}>
          <div style={{ width: 8, height: 8, background: accent, borderRadius: 2 }} />
          <span style={{ fontSize: 13, fontWeight: 600, color: '#fff' }}>Tile Library</span>
          <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)', fontFamily: MONO }}>
            · "{profileName}" · {orientation}
          </span>
          <div style={{ flex: 1 }} />
          <button onClick={() => setShowMarket((v) => !v)} style={{
            padding: '5px 11px', fontSize: 11.5, cursor: 'pointer', borderRadius: 6,
            background: showMarket ? `${accent}20` : 'transparent',
            color: showMarket ? accent : 'rgba(255,255,255,0.6)',
            border: showMarket ? `1px solid ${accent}55` : '1px solid rgba(255,255,255,0.1)',
          }}>{showMarket ? '← Tiles' : '⬇ Marketplace'}</button>
          {!showMarket && (
            <input
              type="text" value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search tiles…"
              autoFocus
              spellCheck={false}
              style={{
                width: 180, fontSize: 11.5, padding: '5px 9px',
                background: 'rgba(0,0,0,0.3)',
                border: '1px solid rgba(255,255,255,0.08)',
                borderRadius: 6, color: '#fff', outline: 'none',
              }}
            />
          )}
          <button onClick={onClose} title="Close (Esc)" style={{
            padding: '4px 10px', fontSize: 12,
            background: 'transparent', color: 'rgba(255,255,255,0.55)',
            border: '1px solid rgba(255,255,255,0.1)', borderRadius: 5, cursor: 'pointer',
          }}>×</button>
        </div>

        {showMarket && <MarketplaceTab accent={accent} onClose={() => setShowMarket(false)} />}

        {/* Category chips */}
        {!showMarket && <div style={{
          padding: '10px 18px', borderBottom: '1px solid rgba(255,255,255,0.05)',
          display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', flexShrink: 0,
        }}>
          <CategoryChip
            label="All" count={countFor('all')}
            active={activeCategory === 'all'}
            onClick={() => setActiveCategory('all')}
            accent={accent}
          />
          {CATEGORY_ORDER.map((cat) => (
            <CategoryChip
              key={cat}
              label={TILE_CATEGORY_LABELS[cat]}
              count={countFor(cat)}
              active={activeCategory === cat}
              onClick={() => setActiveCategory(cat)}
              accent={accent}
            />
          ))}
        </div>}

        {/* Card grid */}
        {!showMarket && <div style={{
          padding: '14px 18px', overflow: 'auto',
          display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10,
          alignContent: 'start',
        }}>
          {visible.length === 0 && (
            <div style={{
              gridColumn: '1 / -1', padding: '24px 0', textAlign: 'center',
              fontSize: 11.5, color: 'rgba(255,255,255,0.4)',
            }}>
              No tiles match "{query.trim()}"
            </div>
          )}
          {visible.map((id) => (
            <TileCard
              key={id}
              id={id}
              count={tiles.filter((t) => t.type === id).length}
              accent={accent}
              onAdd={() => handleAdd(id)}
              onRemove={() => handleRemove(id)}
            />
          ))}
        </div>}
      </div>
    </div>
  );
}

function CategoryChip({ label, count, active, onClick, accent }: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
  accent: string;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 5,
        padding: '3px 10px', fontSize: 11, borderRadius: 999,
        background: active ? `${accent}18` : 'rgba(255,255,255,0.04)',
        border: active ? `1px solid ${accent}55` : '1px solid rgba(255,255,255,0.08)',
        color: active ? accent : 'rgba(255,255,255,0.55)',
        fontWeight: active ? 600 : 400,
        cursor: 'pointer', lineHeight: 1.4,
      }}
    >
      {label}
      <span style={{
        fontSize: 9.5, fontFamily: MONO,
        color: active ? `${accent}cc` : 'rgba(255,255,255,0.35)',
      }}>{count}</span>
    </button>
  );
}

function TileCard({ id, count, accent, onAdd, onRemove }: {
  id: TileType;
  count: number;
  accent: string;
  onAdd: () => void;
  onRemove: () => void;
}) {
  const meta = TILE_META[id];
  const isViz = id === 'viz';
  const added = count > 0;

  // Tag chip: NEEDS KEY > ACCOUNT > BUILT-IN.
  const tag = meta.needsKey
    ? { text: 'NEEDS KEY', color: '#fbbf24', bg: 'rgba(245,158,11,0.1)' }
    : meta.account
      ? { text: 'ACCOUNT', color: '#7cf5d4', bg: 'rgba(124,245,212,0.08)' }
      : { text: 'BUILT-IN', color: 'rgba(255,255,255,0.4)', bg: 'rgba(255,255,255,0.05)' };

  // Action buttons. Card body clicks never add/remove.
  //  - multi-instance: always "+ Add"; "Remove" (last instance) when any exist
  //  - singleton: "+ Add" when absent, "Remove" when present
  //  - viz: cannot be removed — disabled button + tooltip
  const showAdd = meta.multiInstance || !added;
  const showRemove = added;
  const removeDisabled = isViz;

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', gap: 8,
      padding: 10, borderRadius: 10,
      background: added ? `${accent}08` : 'rgba(255,255,255,0.03)',
      border: added ? `1px solid ${accent}33` : '1px solid rgba(255,255,255,0.07)',
      minWidth: 0,
    }}>
      {/* Icon + label/description */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, minWidth: 0 }}>
        <div style={{
          width: 30, height: 30, borderRadius: 7, flexShrink: 0,
          background: `${accent}14`, border: `1px solid ${accent}33`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 15, color: 'rgba(255,255,255,0.85)', lineHeight: 1,
        }}>{meta.icon}</div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{
            display: 'flex', alignItems: 'baseline', gap: 6, minWidth: 0,
          }}>
            <span style={{
              fontSize: 12, fontWeight: 600, color: 'rgba(255,255,255,0.9)',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>{meta.label}</span>
            {meta.multiInstance && count > 0 && (
              <span style={{
                fontSize: 10, fontFamily: MONO, color: accent, flexShrink: 0,
              }}>×{count}</span>
            )}
          </div>
          <div style={{
            fontSize: 10, color: 'rgba(255,255,255,0.4)', marginTop: 1,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }} title={meta.description}>{meta.description}</div>
        </div>
      </div>

      {/* Tag + actions */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{
          fontSize: 9, fontFamily: MONO, fontWeight: 600, letterSpacing: '0.05em',
          padding: '2px 6px', borderRadius: 4,
          color: tag.color, background: tag.bg,
        }}>{tag.text}</span>
        <div style={{ flex: 1 }} />
        {showAdd && (
          <button
            onClick={onAdd}
            title={`Add ${meta.label}`}
            style={{
              padding: '3px 9px', fontSize: 10, fontWeight: 600,
              background: `${accent}22`, color: accent,
              border: `1px solid ${accent}44`, borderRadius: 5, cursor: 'pointer',
            }}
          >+ Add</button>
        )}
        {showRemove && (
          <button
            onClick={removeDisabled ? undefined : onRemove}
            disabled={removeDisabled}
            title={removeDisabled ? 'The visualizer cannot be removed' : `Remove ${meta.label}`}
            style={{
              padding: '3px 9px', fontSize: 10, fontWeight: 600,
              background: 'rgba(255,255,255,0.04)',
              color: removeDisabled ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.65)',
              border: '1px solid rgba(255,255,255,0.12)', borderRadius: 5,
              cursor: removeDisabled ? 'not-allowed' : 'pointer',
              opacity: removeDisabled ? 0.6 : 1,
            }}
          >Remove</button>
        )}
      </div>
    </div>
  );
}

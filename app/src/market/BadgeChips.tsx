import { badgeStyle, visibleBadges } from '../state/badges';

const MONO = '"JetBrains Mono", ui-monospace, monospace';

/** Admin-granted badges, rendered wherever a person appears.
 *
 *  Takes the raw server value rather than a cleaned array — normalising is
 *  `visibleBadges`' job, and doing it here means every caller gets the same
 *  defensive treatment of network data. */
export function BadgeChips({ badges, size = 'normal' }: {
  badges: unknown;
  size?: 'normal' | 'small';
}) {
  const list = visibleBadges(badges);
  if (list.length === 0) return null;
  const small = size === 'small';

  return (
    <span style={{ display: 'inline-flex', gap: 5, flexWrap: 'wrap', verticalAlign: 'middle' }}>
      {list.map((slug) => {
        const s = badgeStyle(slug);
        return (
          <span
            key={slug}
            title={s.title}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 3,
              padding: small ? '1px 5px' : '2px 7px',
              borderRadius: 999,
              fontSize: small ? 8.5 : 9.5,
              fontFamily: MONO, fontWeight: 700, letterSpacing: '0.04em',
              background: `${s.colour}1f`,
              color: s.colour,
              border: `1px solid ${s.colour}44`,
              whiteSpace: 'nowrap',
            }}
          >
            <span aria-hidden>{s.glyph}</span>
            {!small && s.label}
          </span>
        );
      })}
    </span>
  );
}

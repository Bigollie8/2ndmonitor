import { describePermission, permissionBadges } from '../state/permissionBadges';

const MONO = '"JetBrains Mono", ui-monospace, monospace';

/** Every declared permission in plain English, from the same
 *  `describePermission` the install dialog and the card badges use.
 *
 *  Declaring nothing gets its own line rather than an empty section — "this
 *  cannot phone home" is a selling point, and an absent section reads as
 *  missing information instead. */
export function PermissionList({ permissions, accent }: {
  permissions: string[];
  accent: string;
}) {
  if (permissions.length === 0) {
    return (
      <div style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.5)' }}>
        Declares no permissions — it cannot reach the network, store credentials, or run app commands.
      </div>
    );
  }
  const tones = new Map(permissionBadges(permissions).map((b) => [b.text, b.tone]));
  const warn = tones.get('key') === 'warn' || tones.get('command') === 'warn' || tones.get('unknown') === 'warn';
  return (
    <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 5 }}>
      {permissions.map((p) => (
        <li key={p} style={{
          display: 'flex', gap: 8, alignItems: 'baseline',
          fontSize: 11.5, color: 'rgba(255,255,255,0.7)',
        }}>
          <span style={{ color: warn ? '#fbbf24' : accent, fontFamily: MONO, fontSize: 10 }}>▸</span>
          <span>{describePermission(p)}</span>
        </li>
      ))}
    </ul>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// What a bundle's declared permissions look like on a card, and in prose.
//
// Pure module — no React, no Tauri — so it is node-testable.
//
// `describePermission` moved here from ContentLibrary.tsx, where it lived
// inside the install confirm dialog. That made the dialog the FIRST place a
// user could learn a tile wanted network access — the last possible moment.
// The same text now appears on the card badge, in the detail view, and in
// the dialog, from one source.
// ─────────────────────────────────────────────────────────────────────────────
import { parsePermission } from '../sandbox/manifest';

export interface PermBadge {
  text: string;
  /** Tooltip — carries the specifics the badge itself has no room for. */
  title: string;
  tone: 'neutral' | 'warn';
}

/** Human phrasing for one permission string. */
export function describePermission(p: string): string {
  const parsed = parsePermission(p);
  if (!parsed.ok) return p;
  if (parsed.perm.kind === 'net') return `Access the internet at ${parsed.perm.host}`;
  if (parsed.perm.kind === 'secret') return `Store a credential named "${parsed.perm.key}"`;
  return `Run the app command "${parsed.perm.command}"`;
}

export function permissionBadges(permissions: string[]): PermBadge[] {
  if (permissions.length === 0) {
    // Declaring nothing is a genuine selling point — "this cannot phone home"
    // — so it gets a badge rather than an empty space.
    return [{ text: 'offline', title: 'Declares no permissions', tone: 'neutral' }];
  }

  const hosts: string[] = [];
  const keys: string[] = [];
  const commands: string[] = [];
  const unparsed: string[] = [];

  for (const p of permissions) {
    const parsed = parsePermission(p);
    if (!parsed.ok) { unparsed.push(p); continue; }
    if (parsed.perm.kind === 'net') hosts.push(parsed.perm.host);
    else if (parsed.perm.kind === 'secret') keys.push(parsed.perm.key);
    else commands.push(parsed.perm.command);
  }

  const badges: PermBadge[] = [];
  if (hosts.length > 0) {
    badges.push({
      text: 'internet',
      title: hosts.length === 1
        ? `Accesses ${hosts[0]}`
        : `Accesses ${hosts.length} hosts: ${hosts.join(', ')}`,
      tone: 'neutral',
    });
  }
  if (keys.length > 0) {
    badges.push({
      text: 'key',
      title: `Stores ${keys.length === 1 ? 'a credential' : `${keys.length} credentials`}: ${keys.join(', ')}`,
      tone: 'warn',
    });
  }
  if (commands.length > 0) {
    badges.push({
      text: 'command',
      title: `Runs app commands: ${commands.join(', ')}`,
      tone: 'warn',
    });
  }
  if (unparsed.length > 0) {
    // Dropping something we could not parse would UNDERSTATE what the bundle
    // asked for. Overstating is recoverable; understating is not.
    badges.push({
      text: 'unknown',
      title: `Declares permissions this app version does not recognise: ${unparsed.join(', ')}`,
      tone: 'warn',
    });
  }
  return badges;
}

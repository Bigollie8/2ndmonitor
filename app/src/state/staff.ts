// ─────────────────────────────────────────────────────────────────────────────
// The staff surface's client bindings.
//
// Everything here authenticates with the signed-in user's OWN session. The
// shared ADMIN_TOKEN never reaches a client: a god credential sitting on every
// installed machine is one you cannot revoke without rotating it for
// everybody at once.
//
// Permission lives on the server (server/src/roles.rs). `fetchStaffRole` asks
// what the caller may do rather than inferring it from a badge, so the panel
// and the server can never disagree about who is allowed what.
// ─────────────────────────────────────────────────────────────────────────────
import { cfgUrl } from './marketplaceConfig';

export type StaffRole = 'user' | 'moderator' | 'admin';

export interface StaffCapabilities {
  role: StaffRole;
  canModerateContent: boolean;
  canManagePeople: boolean;
}

export interface ManagedUser {
  id: number;
  email: string;
  handle: string | null;
  displayName: string | null;
  avatarSeed: string | null;
  accent: string | null;
  badges: string[];
  role: StaffRole;
  suspended: boolean;
  verified: boolean;
  createdAt: number;
  hasAvatar: boolean;
  published: number;
  reportsFiled: number;
}

export interface Report {
  id: number;
  targetKind: string;
  targetId: string;
  reason: string;
  createdAt: number;
  /** The filer's handle. Named to match the server's own field (see
   *  moderation::queue) rather than renaming it in transit. Never null in
   *  practice -- reports are never anonymous -- but a deleted account would
   *  leave the LEFT JOIN empty. */
  reportedBy: string | null;
}

export interface AuditEntry {
  id: number;
  /** Null means the shared ADMIN_TOKEN, which belongs to whoever holds it.
   *  Rendered as such rather than given an invented name. */
  actor: string | null;
  action: string;
  args: Record<string, unknown>;
  prior: Record<string, unknown> | null;
  undoable: boolean;
  createdAt: number;
  undoneAt: number | null;
  undoneBy: string | null;
}

const invoke = async () => (await import('@tauri-apps/api/core')).invoke;

/** What this caller may do — or `null` when they are not staff at all.
 *
 *  Null rather than a throw: "you are not a moderator" is the normal answer
 *  for almost everybody, and the caller uses it to decide whether the panel
 *  exists, not to show an error. */
export async function fetchStaffRole(): Promise<StaffCapabilities | null> {
  try {
    return await (await invoke())<StaffCapabilities>(
      'marketplace_staff_whoami', { url: cfgUrl() },
    );
  } catch {
    return null;
  }
}

export async function fetchManagedUsers(query?: string): Promise<ManagedUser[]> {
  const res = await (await invoke())<{ users: ManagedUser[] }>(
    'marketplace_staff_users', { url: cfgUrl(), query: query ?? null },
  );
  return res.users ?? [];
}

export async function fetchReports(): Promise<Report[]> {
  const res = await (await invoke())<{ reports: Report[] }>(
    'marketplace_staff_reports', { url: cfgUrl() },
  );
  return res.reports ?? [];
}

/** One moderation action. Throws with the server's own words on refusal —
 *  "you do not have permission for that" is a real answer a moderator needs
 *  to see, not something to swallow. */
export async function moderate(
  action: string,
  args: Record<string, unknown> = {},
): Promise<void> {
  await (await invoke())('marketplace_moderate', { url: cfgUrl(), action, args });
}

export async function fetchAudit(): Promise<AuditEntry[]> {
  const res = await (await invoke())<{ entries: AuditEntry[] }>(
    'marketplace_staff_audit', { url: cfgUrl() },
  );
  return res.entries ?? [];
}

/** Reverse one logged action. The server derives the inverse from what it
 *  recorded — the client never guesses, because an undo built from a
 *  half-remembered argument list restores the wrong thing. */
export async function undoAction(id: number): Promise<void> {
  await (await invoke())('marketplace_undo', { url: cfgUrl(), id });
}

export interface Invite {
  code: string;
  note: string | null;
  maxUses: number;
  uses: number;
  expiresAt: number | null;
  revoked: boolean;
  createdAt: number;
  createdBy: string | null;
}

export async function createInvite(
  note?: string, maxUses?: number, expiresInDays?: number,
): Promise<string> {
  const res = await (await invoke())<{ code: string }>('marketplace_create_invite', {
    url: cfgUrl(), note: note ?? null, maxUses: maxUses ?? 1, expiresInDays: expiresInDays ?? null,
  });
  return res.code;
}

export async function fetchInvites(): Promise<Invite[]> {
  const res = await (await invoke())<{ invites: Invite[] }>(
    'marketplace_list_invites', { url: cfgUrl() },
  );
  return res.invites ?? [];
}

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

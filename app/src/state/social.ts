// ─────────────────────────────────────────────────────────────────────────────
// The community layer's client surface: follows, favourites, feed, comments,
// blocks, reports.
//
// Thin invoke wrappers, one per Tauri command, all typed. The contract every
// caller follows is the app's established one: READS fail silently (a dead
// follow count leaves a number blank, never blocks browsing), WRITES surface
// their errors (the user acted and deserves to know it did not land) — so
// these wrappers throw, and read-side callers catch.
// ─────────────────────────────────────────────────────────────────────────────
import { cfgUrl } from './marketplaceConfig';

export interface FollowStatus {
  handle: string;
  followers: number;
  following: boolean;
}

export interface FollowedCreator {
  handle: string;
  displayName: string | null;
  avatarSeed: string | null;
}

export interface FavouritesState {
  /** Public per-bundle counts — social proof. */
  counts: Record<string, number>;
  /** The caller's own favourites. Empty when signed out. */
  mine: string[];
}

export interface CommentEntry {
  id: number;
  handle: string | null;
  displayName: string | null;
  body: string;
  createdAt: number;
}

const invoke = async () => (await import('@tauri-apps/api/core')).invoke;

export async function fetchFollowStatus(handle: string): Promise<FollowStatus> {
  return (await invoke())('marketplace_follow_status', { url: cfgUrl(), handle });
}

export async function setFollow(handle: string, following: boolean): Promise<void> {
  await (await invoke())('marketplace_set_follow', { url: cfgUrl(), handle, following });
}

export async function fetchFollowsMine(): Promise<FollowedCreator[]> {
  const res = await (await invoke())<{ following: FollowedCreator[] }>(
    'marketplace_follows_mine', { url: cfgUrl() },
  );
  return res.following ?? [];
}

export async function fetchFavourites(): Promise<FavouritesState> {
  const res = await (await invoke())<FavouritesState>(
    'marketplace_fetch_favourites', { url: cfgUrl() },
  );
  return { counts: res.counts ?? {}, mine: res.mine ?? [] };
}

export async function setFavourite(id: string, favourite: boolean): Promise<void> {
  await (await invoke())('marketplace_set_favourite', { url: cfgUrl(), id, favourite });
}

export async function fetchFeedIds(): Promise<string[]> {
  const res = await (await invoke())<{ ids: string[] }>('marketplace_fetch_feed', { url: cfgUrl() });
  return res.ids ?? [];
}

export async function fetchComments(id: string): Promise<CommentEntry[]> {
  const res = await (await invoke())<{ comments: CommentEntry[] }>(
    'marketplace_fetch_comments', { url: cfgUrl(), id },
  );
  return res.comments ?? [];
}

export async function postComment(id: string, body: string): Promise<void> {
  await (await invoke())('marketplace_post_comment', { url: cfgUrl(), id, body });
}

export async function setBlock(handle: string, blocking: boolean): Promise<void> {
  await (await invoke())('marketplace_set_block', { url: cfgUrl(), handle, blocking });
}

export async function report(
  targetKind: 'comment' | 'review' | 'bundle' | 'creator',
  targetId: string,
  reason: string,
): Promise<void> {
  await (await invoke())('marketplace_report', { url: cfgUrl(), targetKind, targetId, reason });
}

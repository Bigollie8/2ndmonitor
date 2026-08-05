// ─────────────────────────────────────────────────────────────────────────────
// Directory, forum and shoutbox — the client surface for the second half of
// the community layer.
//
// Same contract as state/social.ts: reads throw and their callers catch
// (a dead list must never block browsing), writes throw and their callers
// SHOW the message (the user acted and deserves to know it did not land).
// ─────────────────────────────────────────────────────────────────────────────
import { cfgUrl } from './marketplaceConfig';

export interface DirectoryCreator {
  handle: string;
  displayName: string | null;
  avatarSeed: string | null;
  accent: string | null;
  badges: string[];
  createdAt: number;
  published: number;
  followers: number;
  hasAvatar?: boolean;
}

export interface Topic {
  id: number;
  title: string;
  body: string;
  bundleId: string | null;
  createdAt: number;
  lastAt: number;
  replyCount: number;
  handle: string | null;
  displayName: string | null;
  avatarSeed: string | null;
  accent: string | null;
}

export interface Reply {
  id: number;
  body: string;
  createdAt: number;
  handle: string | null;
  displayName: string | null;
  avatarSeed: string | null;
  accent: string | null;
}

export interface Shout {
  id: number;
  body: string;
  createdAt: number;
  handle: string | null;
  displayName: string | null;
  avatarSeed: string | null;
  accent: string | null;
}

const invoke = async () => (await import('@tauri-apps/api/core')).invoke;

/** Upload a picture (base64, no data: prefix) or clear it with ''. */
export async function setAvatar(image: string): Promise<void> {
  await (await invoke())('marketplace_set_avatar', { url: cfgUrl(), image });
}

export async function fetchCreators(query?: string): Promise<DirectoryCreator[]> {
  const res = await (await invoke())<{ creators: DirectoryCreator[] }>(
    'marketplace_fetch_creators', { url: cfgUrl(), query: query ?? null },
  );
  return res.creators ?? [];
}

export async function fetchTopics(bundleId?: string | null): Promise<Topic[]> {
  const res = await (await invoke())<{ topics: Topic[] }>(
    'marketplace_fetch_topics', { url: cfgUrl(), bundleId: bundleId ?? null },
  );
  return res.topics ?? [];
}

export async function createTopic(
  title: string, body: string, bundleId?: string | null,
): Promise<void> {
  await (await invoke())('marketplace_create_topic', {
    url: cfgUrl(), title, body, bundleId: bundleId ?? null,
  });
}

export async function fetchReplies(topicId: number): Promise<Reply[]> {
  const res = await (await invoke())<{ replies: Reply[] }>(
    'marketplace_fetch_replies', { url: cfgUrl(), topicId },
  );
  return res.replies ?? [];
}

export async function createReply(topicId: number, body: string): Promise<void> {
  await (await invoke())('marketplace_create_reply', { url: cfgUrl(), topicId, body });
}

export async function fetchShouts(): Promise<{ shouts: Shout[]; cooldown: number }> {
  const res = await (await invoke())<{ shouts: Shout[]; cooldown: number }>(
    'marketplace_fetch_shouts', { url: cfgUrl() },
  );
  return { shouts: res.shouts ?? [], cooldown: res.cooldown ?? 10 };
}

export async function postShout(body: string): Promise<void> {
  await (await invoke())('marketplace_post_shout', { url: cfgUrl(), body });
}

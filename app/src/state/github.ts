import { isTauri } from './tauri';

export type GithubFilter = 'assigned' | 'review-requested' | 'authored';

export interface GithubPr {
  id: number;
  number: number;
  title: string;
  url: string;
  repo: string;          // "owner/repo"
  user: string;          // PR author login
  draft: boolean;
  updatedAt: string;     // ISO date
  /** "assigned" / "review-requested" / "authored" — synthesized at fetch time
   *  so the tile can group rows; not part of GitHub's response. */
  bucket: GithubFilter;
}

// The GitHub PAT lives in the encrypted secret store (see state/secrets.ts,
// key "github_pat"; legacy localStorage key "2mh.github.pat" is migrated on
// first read). Only the non-secret username stays in plain localStorage.
const USER_KEY = '2mh.github.user';

export function getStoredUser(): string {
  return localStorage.getItem(USER_KEY) ?? '';
}
export function setStoredUser(u: string): void {
  if (u.trim()) localStorage.setItem(USER_KEY, u.trim());
  else localStorage.removeItem(USER_KEY);
}

interface RawSearchResp {
  total_count?: number;
  items?: RawIssueItem[];
}
export interface RawIssueItem {
  id?: number;
  number?: number;
  title?: string;
  html_url?: string;
  draft?: boolean;
  updated_at?: string;
  user?: { login?: string };
  repository_url?: string;
}

async function callGithub(token: string, query: string): Promise<RawSearchResp | null> {
  if (!isTauri) return null;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    return await invoke<RawSearchResp>('fetch_github_prs', { token, query });
  } catch (err) {
    console.warn('fetch_github_prs failed', err);
    return null;
  }
}

export function repoFromUrl(repoUrl: string | undefined): string {
  if (!repoUrl) return '';
  // "https://api.github.com/repos/owner/name" → "owner/name"
  const m = repoUrl.match(/repos\/([^/]+\/[^/]+)/);
  return m ? m[1] : '';
}

export function mapItems(items: RawIssueItem[] | undefined, bucket: GithubFilter): GithubPr[] {
  if (!items) return [];
  return items
    .filter((it) => typeof it.number === 'number' && typeof it.html_url === 'string')
    .map((it) => ({
      id: it.id ?? 0,
      number: it.number!,
      title: it.title ?? '(untitled)',
      url: it.html_url!,
      repo: repoFromUrl(it.repository_url),
      user: it.user?.login ?? '',
      draft: !!it.draft,
      updatedAt: it.updated_at ?? '',
      bucket,
    }));
}

/** Fetch all three buckets (assigned, review-requested, authored) for the
 *  configured user. Each is a separate `search/issues` call — GitHub's search
 *  doesn't support OR-of-qualifiers reliably. */
export async function fetchAllPrs(token: string, user: string): Promise<GithubPr[]> {
  if (!token || !user) return [];
  const queries: { q: string; bucket: GithubFilter }[] = [
    { q: `is:open is:pr assignee:${user} archived:false`, bucket: 'assigned' },
    { q: `is:open is:pr review-requested:${user} archived:false`, bucket: 'review-requested' },
    { q: `is:open is:pr author:${user} archived:false`, bucket: 'authored' },
  ];
  const results = await Promise.all(queries.map((q) => callGithub(token, q.q).then((r) => mapItems(r?.items, q.bucket))));
  return dedupePrs(results);
}

/** De-duplicate across buckets (a PR can be authored AND review-requested —
 *  keep the first occurrence, in the order the bucket lists were passed). */
export function dedupePrs(lists: GithubPr[][]): GithubPr[] {
  const seen = new Set<number>();
  const out: GithubPr[] = [];
  for (const list of lists) {
    for (const pr of list) {
      if (seen.has(pr.id)) continue;
      seen.add(pr.id);
      out.push(pr);
    }
  }
  return out;
}

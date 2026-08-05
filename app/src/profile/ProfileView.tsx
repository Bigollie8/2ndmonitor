import { useEffect, useState } from 'react';
import { useMarketplaceAuth } from '../state/marketplaceAuth';
import { identiconDataUri } from '../state/identicon';
import { cfgUrl } from '../state/marketplaceConfig';
import { useCatalogData } from '../state/useCatalogData';
import {
  fetchFollowsMine, fetchFollowStatus, fetchFavourites, setFollow, setFavourite,
  type FollowedCreator,
} from '../state/social';
import { AccountSignIn } from './AccountSignIn';
import { AccountPanel } from './AccountPanel';
import { BadgeChips } from '../market/BadgeChips';

const MONO = '"JetBrains Mono", ui-monospace, monospace';

type Tab = 'profile' | 'following' | 'favourites' | 'account';

interface AccountSummary {
  handle: string | null;
  displayName: string | null;
  avatarSeed: string | null;
  accent?: string | null;
  badges?: unknown;
}

/** The profile hub: who you are on the marketplace and who you care about.
 *
 *  Four tabs — Profile (view and edit), Following, Favourites, Account —
 *  in the same modal shell as the Library. Signed out it collapses to the
 *  sign-in/register form, because every other tab is about a person who
 *  does not exist yet.
 *
 *  Reads fail silently throughout (a blank stat never blocks the popout);
 *  the writes inside each tab surface their own errors. */
export function ProfileView({ accent, catalogRemoved, onClose }: {
  accent: string;
  /** For resolving favourite ids against the merged catalog. */
  catalogRemoved: string[];
  onClose: () => void;
}) {
  const { state } = useMarketplaceAuth();
  const signedIn = state.status === 'signed-in';
  const [tab, setTab] = useState<Tab>('profile');

  // Everything below is personal-read state: account summary for the header,
  // creator stats for the Profile tab, lists for the other two.
  const [account, setAccount] = useState<AccountSummary | null>(null);
  const [published, setPublished] = useState<number | null>(null);
  const [installs, setInstalls] = useState<number | null>(null);
  const [followers, setFollowers] = useState<number | null>(null);
  const [followingList, setFollowingList] = useState<FollowedCreator[] | null>(null);
  const [favIds, setFavIds] = useState<string[] | null>(null);
  const [favCounts, setFavCounts] = useState<Record<string, number>>({});
  const [actionError, setActionError] = useState('');

  const data = useCatalogData({ catalogRemoved });

  useEffect(() => {
    if (!signedIn) return;
    let cancelled = false;
    void (async () => {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        const a = await invoke<AccountSummary>('marketplace_account_get', { url: cfgUrl() });
        if (cancelled) return;
        setAccount(a);
        if (a.handle) {
          // Stats come from the same public endpoints anyone else would use
          // to look at this creator — so the numbers here can never disagree
          // with what the world sees.
          const [creator, follows] = await Promise.allSettled([
            invoke<{ bundles: unknown[]; totalDownloads: number }>(
              'marketplace_fetch_creator', { url: cfgUrl(), handle: a.handle },
            ),
            fetchFollowStatus(a.handle),
          ]);
          if (cancelled) return;
          if (creator.status === 'fulfilled') {
            setPublished(creator.value.bundles.length);
            setInstalls(creator.value.totalDownloads);
          }
          if (follows.status === 'fulfilled') setFollowers(follows.value.followers);
        }
      } catch {
        // Silent: the header just shows less.
      }
    })();
    return () => { cancelled = true; };
  }, [signedIn]);

  useEffect(() => {
    if (!signedIn || tab !== 'following') return;
    let cancelled = false;
    setFollowingList(null);
    void fetchFollowsMine()
      .then((l) => { if (!cancelled) setFollowingList(l); })
      .catch(() => { if (!cancelled) setFollowingList([]); });
    return () => { cancelled = true; };
  }, [signedIn, tab]);

  useEffect(() => {
    if (!signedIn || tab !== 'favourites') return;
    let cancelled = false;
    setFavIds(null);
    void fetchFavourites()
      .then((f) => {
        if (cancelled) return;
        setFavIds(f.mine);
        setFavCounts(f.counts);
      })
      .catch(() => { if (!cancelled) setFavIds([]); });
    return () => { cancelled = true; };
  }, [signedIn, tab]);

  const unfollow = async (handle: string) => {
    setActionError('');
    // Optimistic removal; a failed write puts the row back with the reason.
    const prev = followingList;
    setFollowingList((l) => (l ?? []).filter((c) => c.handle !== handle));
    try {
      await setFollow(handle, false);
    } catch (e) {
      setFollowingList(prev);
      setActionError(String(e));
    }
  };

  const unfavourite = async (id: string) => {
    setActionError('');
    const prev = favIds;
    setFavIds((l) => (l ?? []).filter((f) => f !== id));
    try {
      await setFavourite(id, false);
    } catch (e) {
      setFavIds(prev);
      setActionError(String(e));
    }
  };

  // Your colour on your page, the app's otherwise — the same rule your
  // public creator page follows, so the two never disagree.
  const tint = account?.accent ?? accent;
  const byId = new Map(data.items.map((i) => [i.id, i]));

  const tabButton = (t: Tab, label: string) => (
    <button
      key={t}
      onClick={() => setTab(t)}
      style={{
        padding: '4px 10px', borderRadius: 999, fontSize: 11, fontWeight: 600,
        background: tab === t ? `${accent}1f` : 'rgba(255,255,255,0.04)',
        color: tab === t ? accent : 'rgba(255,255,255,0.6)',
        border: tab === t ? `1px solid ${accent}44` : '1px solid rgba(255,255,255,0.08)',
        cursor: 'pointer',
      }}
    >{label}</button>
  );

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 60,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(0,0,0,0.5)',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(560px, 92vw)', maxHeight: '86vh', minHeight: 320,
          display: 'flex', flexDirection: 'column', borderRadius: 14,
          background: 'rgba(16,17,22,0.97)', border: '1px solid rgba(255,255,255,0.1)',
          backdropFilter: 'blur(18px)', overflow: 'hidden',
        }}
      >
        <div style={{
          display: 'flex', alignItems: 'center', gap: 12,
          padding: '12px 18px', borderBottom: '1px solid rgba(255,255,255,0.06)',
        }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: '#fff' }}>
            {signedIn && account?.handle ? `@${account.handle}` : 'Profile'}
          </span>
          <div style={{ flex: 1 }} />
          <button
            onClick={onClose}
            aria-label="Close profile"
            style={{
              background: 'transparent', border: 'none', cursor: 'pointer',
              color: 'rgba(255,255,255,0.5)', fontSize: 18, lineHeight: 1, padding: '0 4px',
            }}
          >×</button>
        </div>

        {!signedIn ? (
          <div style={{ padding: 18, overflowY: 'auto' }}>
            <AccountSignIn accent={accent} />
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', gap: 6, padding: '10px 18px 0', flexWrap: 'wrap' }}>
              {tabButton('profile', 'Profile')}
              {tabButton('following', 'Following')}
              {tabButton('favourites', 'Favourites')}
              {tabButton('account', 'Account')}
            </div>

            <div style={{ flex: 1, overflowY: 'auto', padding: 18 }}>
              {actionError && (
                <div style={{ fontSize: 11, color: '#fb7185', marginBottom: 10 }}>{actionError}</div>
              )}

              {tab === 'profile' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
                    <img
                      src={identiconDataUri(account?.avatarSeed || account?.handle || '?', 72)}
                      alt=""
                      width={72}
                      height={72}
                      style={{ borderRadius: 12, border: `1px solid ${account?.accent ?? 'rgba(255,255,255,0.09)'}` }}
                    />
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 16, fontWeight: 700, color: 'rgba(255,255,255,0.95)' }}>
                        {account?.displayName ?? account?.handle ?? '—'}
                      </div>
                      {account?.handle && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 3, flexWrap: 'wrap' }}>
                          <span style={{ fontSize: 11, fontFamily: MONO, color: tint }}>
                            @{account.handle}
                          </span>
                          <BadgeChips badges={account.badges} />
                        </div>
                      )}
                      <div style={{ fontSize: 10.5, fontFamily: MONO, color: 'rgba(255,255,255,0.4)', marginTop: 6 }}>
                        {published ?? '–'} published · {installs ?? '–'} installs · {followers ?? '–'} followers
                      </div>
                    </div>
                  </div>

                  <div style={{ height: 1, background: 'rgba(255,255,255,0.06)' }} />
                  <AccountPanel accent={accent} signedIn={signedIn} />
                  {/* Said here because "upload a picture" is what everyone
                      reaches for: the avatar is GENERATED, on purpose. Zero
                      image moderation, and it can never be a slur, a logo,
                      or a photograph of someone. */}
                  <div style={{ fontSize: 10, fontFamily: MONO, color: 'rgba(255,255,255,0.35)', lineHeight: 1.5 }}>
                    Your avatar is generated from your handle — there is nothing to upload.
                  </div>
                </div>
              )}

              {tab === 'following' && (
                followingList == null ? (
                  <div style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.35)' }}>Loading…</div>
                ) : followingList.length === 0 ? (
                  <div style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.45)' }}>
                    You are not following anyone yet. Find creators through any bundle's author link.
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {followingList.map((c) => (
                      <div key={c.handle} style={{
                        display: 'flex', alignItems: 'center', gap: 10,
                        padding: '7px 10px', borderRadius: 8,
                        background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.06)',
                      }}>
                        <img
                          src={identiconDataUri(c.avatarSeed || c.handle, 30)}
                          alt="" width={30} height={30}
                          style={{ borderRadius: 7, border: '1px solid rgba(255,255,255,0.09)' }}
                        />
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <div style={{ fontSize: 12, fontWeight: 600, color: 'rgba(255,255,255,0.85)' }}>
                            {c.displayName ?? c.handle}
                          </div>
                          <div style={{ fontSize: 10, fontFamily: MONO, color: accent }}>@{c.handle}</div>
                        </div>
                        <button
                          onClick={() => void unfollow(c.handle)}
                          style={{
                            padding: '3px 10px', fontSize: 10, fontWeight: 600, borderRadius: 5,
                            background: 'rgba(255,255,255,0.04)', color: 'rgba(255,255,255,0.65)',
                            border: '1px solid rgba(255,255,255,0.12)', cursor: 'pointer',
                          }}
                        >Unfollow</button>
                      </div>
                    ))}
                  </div>
                )
              )}

              {tab === 'favourites' && (
                favIds == null ? (
                  <div style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.35)' }}>Loading…</div>
                ) : favIds.length === 0 ? (
                  <div style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.45)' }}>
                    Nothing favourited yet — the ★ on any bundle's page adds it here.
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {favIds.map((id) => {
                      const item = byId.get(id);
                      return (
                        <div key={id} style={{
                          display: 'flex', alignItems: 'center', gap: 10,
                          padding: '7px 10px', borderRadius: 8,
                          background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.06)',
                        }}>
                          <span style={{ fontSize: 13, color: accent }}>★</span>
                          <div style={{ minWidth: 0, flex: 1 }}>
                            <div style={{ fontSize: 12, fontWeight: 600, color: 'rgba(255,255,255,0.85)' }}>
                              {item?.name ?? id}
                            </div>
                            <div style={{ fontSize: 10, fontFamily: MONO, color: 'rgba(255,255,255,0.38)' }}>
                              {item?.kind ?? 'not in your catalog right now'}
                              {favCounts[id] != null ? ` · ★ ${favCounts[id]}` : ''}
                            </div>
                          </div>
                          <button
                            onClick={() => void unfavourite(id)}
                            aria-label="Remove from favourites"
                            style={{
                              padding: '3px 10px', fontSize: 10, fontWeight: 600, borderRadius: 5,
                              background: 'rgba(255,255,255,0.04)', color: 'rgba(255,255,255,0.65)',
                              border: '1px solid rgba(255,255,255,0.12)', cursor: 'pointer',
                            }}
                          >Remove</button>
                        </div>
                      );
                    })}
                  </div>
                )
              )}

              {tab === 'account' && <AccountSignIn accent={accent} />}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

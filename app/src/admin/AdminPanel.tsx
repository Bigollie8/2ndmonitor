import { useEffect, useState } from 'react';
import {
  fetchStaffRole, fetchManagedUsers, fetchReports, moderate,
  type StaffCapabilities, type ManagedUser, type Report,
} from '../state/staff';
import { avatarSrc } from '../state/avatarUrl';
import { BadgeChips } from '../market/BadgeChips';

const MONO = '"JetBrains Mono", ui-monospace, monospace';

type Tab = 'users' | 'reports';

const GRANTABLE = ['founder', 'moderator', 'creator', 'verified', 'supporter', 'staff'];

/** The staff panel: people, and the queue of things reported about them.
 *
 *  Rendered only for moderators and admins, but that is presentation. The
 *  server decides every permission (server/src/roles.rs) and refuses on its
 *  own, so a modified client that forces this open gets a wall of 403s rather
 *  than any actual power.
 *
 *  Destructive actions are gated on `canManagePeople` — suspension, renaming
 *  and role changes reach across everything somebody has ever posted, unlike
 *  hiding one comment. */
export function AdminPanel({ accent, onClose, onOpenCreator }: {
  accent: string;
  onClose: () => void;
  onOpenCreator: (handle: string) => void;
}) {
  const [caps, setCaps] = useState<StaffCapabilities | null | 'loading'>('loading');
  const [tab, setTab] = useState<Tab>('users');
  const [query, setQuery] = useState('');
  const [users, setUsers] = useState<ManagedUser[] | null>(null);
  const [reports, setReports] = useState<Report[] | null>(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [reload, setReload] = useState(0);

  useEffect(() => {
    void fetchStaffRole().then((c) => setCaps(c));
  }, []);

  useEffect(() => {
    if (caps === 'loading' || !caps || tab !== 'users') return;
    let cancelled = false;
    const timer = setTimeout(() => {
      void fetchManagedUsers(query)
        .then((u) => { if (!cancelled) setUsers(u); })
        .catch(() => { if (!cancelled) setUsers([]); });
    }, query ? 220 : 0);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [caps, tab, query, reload]);

  useEffect(() => {
    if (caps === 'loading' || !caps || tab !== 'reports') return;
    let cancelled = false;
    setReports(null);
    void fetchReports()
      .then((r) => { if (!cancelled) setReports(r); })
      .catch(() => { if (!cancelled) setReports([]); });
    return () => { cancelled = true; };
  }, [caps, tab, reload]);

  const act = async (label: string, action: string, args: Record<string, unknown>) => {
    setBusy(label);
    setError('');
    setNote('');
    try {
      await moderate(action, args);
      setNote(`${label} — done.`);
      setReload((n) => n + 1);
    } catch (e) {
      // The server's own words, including "you do not have permission for
      // that" — a real answer a moderator needs to see rather than a
      // swallowed failure.
      setError(String(e));
    } finally {
      setBusy('');
    }
  };

  const shell = (children: React.ReactNode) => (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 62,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(0,0,0,0.55)',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(960px, 94vw)', height: 'min(680px, 88vh)',
          display: 'flex', flexDirection: 'column', borderRadius: 14,
          background: 'rgba(16,17,22,0.98)', border: '1px solid rgba(255,255,255,0.1)',
          backdropFilter: 'blur(18px)', overflow: 'hidden',
        }}
      >{children}</div>
    </div>
  );

  const header = (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10,
      padding: '12px 18px', borderBottom: '1px solid rgba(255,255,255,0.06)',
    }}>
      <span style={{ fontSize: 13, fontWeight: 600, color: '#fff' }}>Staff</span>
      {caps && caps !== 'loading' && (
        <span style={{
          fontSize: 9.5, fontFamily: MONO, fontWeight: 700, padding: '2px 7px',
          borderRadius: 999, background: `${accent}1f`, color: accent,
          border: `1px solid ${accent}44`, textTransform: 'uppercase',
        }}>{caps.role}</span>
      )}
      <div style={{ width: 6 }} />
      {caps && caps !== 'loading' && (['users', 'reports'] as Tab[]).map((t) => (
        <button
          key={t}
          onClick={() => setTab(t)}
          style={{
            padding: '4px 11px', borderRadius: 999, fontSize: 11, fontWeight: 600,
            background: tab === t ? `${accent}1f` : 'rgba(255,255,255,0.04)',
            color: tab === t ? accent : 'rgba(255,255,255,0.6)',
            border: tab === t ? `1px solid ${accent}44` : '1px solid rgba(255,255,255,0.08)',
            cursor: 'pointer', textTransform: 'capitalize',
          }}
        >{t}</button>
      ))}
      <div style={{ flex: 1 }} />
      <button
        onClick={onClose}
        aria-label="Close staff panel"
        style={{
          background: 'transparent', border: 'none', cursor: 'pointer',
          color: 'rgba(255,255,255,0.5)', fontSize: 18, lineHeight: 1, padding: '0 4px',
        }}
      >×</button>
    </div>
  );

  if (caps === 'loading') {
    return shell(<>{header}<div style={{ padding: 18, fontSize: 11.5, color: 'rgba(255,255,255,0.35)' }}>Checking…</div></>);
  }
  if (!caps) {
    return shell(<>{header}
      <div style={{ padding: 18, fontSize: 11.5, color: 'rgba(255,255,255,0.5)' }}>
        You do not have staff access on this marketplace.
      </div>
    </>);
  }

  return shell(
    <>
      {header}
      <div style={{ flex: 1, overflowY: 'auto', padding: 18, minHeight: 0 }}>
        {error && <div style={{ fontSize: 11, color: '#fb7185', marginBottom: 10 }}>{error}</div>}
        {note && <div style={{ fontSize: 11, color: '#7cf5d4', marginBottom: 10 }}>{note}</div>}

        {tab === 'users' ? (
          <>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by handle, name or email…"
              spellCheck={false}
              style={{
                width: '100%', maxWidth: 360, padding: '7px 10px', fontSize: 12,
                background: 'rgba(255,255,255,0.05)', color: '#fff', outline: 'none',
                border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, boxSizing: 'border-box',
              }}
            />

            {users == null ? (
              <div style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.35)', marginTop: 14 }}>Loading…</div>
            ) : users.length === 0 ? (
              <div style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.45)', marginTop: 14 }}>
                {query ? `Nobody matches “${query}”.` : 'No accounts.'}
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 14 }}>
                {users.map((u) => (
                  <div
                    key={u.id}
                    style={{
                      padding: '10px 12px', borderRadius: 10,
                      background: u.suspended ? 'rgba(251,113,133,0.06)' : 'rgba(255,255,255,0.025)',
                      border: `1px solid ${u.suspended ? 'rgba(251,113,133,0.25)' : 'rgba(255,255,255,0.07)'}`,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
                      <img
                        src={avatarSrc({ handle: u.handle, hasAvatar: u.hasAvatar, seed: u.avatarSeed, size: 34 })}
                        alt="" width={34} height={34}
                        style={{ borderRadius: 8, objectFit: 'cover', flexShrink: 0, border: '1px solid rgba(255,255,255,0.1)' }}
                      />
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
                          <span style={{ fontSize: 12.5, fontWeight: 600, color: 'rgba(255,255,255,0.9)' }}>
                            {u.displayName ?? u.handle ?? '(no handle)'}
                          </span>
                          {u.handle && (
                            <button
                              onClick={() => onOpenCreator(u.handle!)}
                              style={{
                                background: 'transparent', border: 'none', padding: 0, cursor: 'pointer',
                                fontSize: 10.5, fontFamily: MONO, color: u.accent ?? accent,
                              }}
                            >@{u.handle} ›</button>
                          )}
                          {u.role !== 'user' && (
                            <span style={{
                              fontSize: 8.5, fontFamily: MONO, fontWeight: 700, padding: '1px 6px',
                              borderRadius: 999, background: 'rgba(255,255,255,0.06)',
                              color: 'rgba(255,255,255,0.7)', border: '1px solid rgba(255,255,255,0.14)',
                              textTransform: 'uppercase',
                            }}>{u.role}</span>
                          )}
                          {u.suspended && (
                            <span style={{
                              fontSize: 8.5, fontFamily: MONO, fontWeight: 700, padding: '1px 6px',
                              borderRadius: 999, background: 'rgba(251,113,133,0.15)',
                              color: '#fb7185', border: '1px solid rgba(251,113,133,0.35)',
                              textTransform: 'uppercase',
                            }}>suspended</span>
                          )}
                          <BadgeChips badges={u.badges} size="small" />
                        </div>
                        <div style={{ fontSize: 9.5, fontFamily: MONO, color: 'rgba(255,255,255,0.32)', marginTop: 3 }}>
                          {u.email} · {u.published} published · {u.reportsFiled} reports filed
                          {!u.verified && ' · unverified'}
                        </div>
                      </div>
                    </div>

                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 9 }}>
                      {u.hasAvatar && (
                        <button
                          disabled={!!busy}
                          onClick={() => void act(`Removed @${u.handle}'s picture`, 'remove-avatar', { handle: u.handle })}
                          style={smallBtn(false)}
                        >Remove picture</button>
                      )}

                      {/* People-level actions. Hidden for moderators because
                          they reach across everything somebody has posted —
                          and refused server-side regardless. */}
                      {caps.canManagePeople && u.handle && (
                        <>
                          <button
                            disabled={!!busy}
                            onClick={() => void act(
                              u.suspended ? `Unsuspended @${u.handle}` : `Suspended @${u.handle}`,
                              u.suspended ? 'unsuspend' : 'suspend',
                              { handle: u.handle },
                            )}
                            style={smallBtn(!u.suspended)}
                          >{u.suspended ? 'Unsuspend' : 'Suspend'}</button>

                          <select
                            value={u.role}
                            disabled={!!busy}
                            onChange={(e) => void act(
                              `@${u.handle} is now ${e.target.value}`,
                              'set-role',
                              { handle: u.handle, role: e.target.value },
                            )}
                            style={{
                              fontSize: 10, padding: '3px 6px', borderRadius: 5,
                              background: 'rgba(0,0,0,0.35)', color: 'rgba(255,255,255,0.75)',
                              border: '1px solid rgba(255,255,255,0.14)', cursor: 'pointer',
                            }}
                          >
                            <option value="user">user</option>
                            <option value="moderator">moderator</option>
                            <option value="admin">admin</option>
                          </select>

                          <select
                            value=""
                            disabled={!!busy}
                            onChange={(e) => {
                              const badge = e.target.value;
                              if (!badge) return;
                              const has = u.badges.includes(badge);
                              void act(
                                `${has ? 'Removed' : 'Granted'} ${badge}`,
                                has ? 'revoke-badge' : 'grant-badge',
                                { handle: u.handle, badge },
                              );
                            }}
                            style={{
                              fontSize: 10, padding: '3px 6px', borderRadius: 5,
                              background: 'rgba(0,0,0,0.35)', color: 'rgba(255,255,255,0.75)',
                              border: '1px solid rgba(255,255,255,0.14)', cursor: 'pointer',
                            }}
                          >
                            <option value="">badge…</option>
                            {GRANTABLE.map((b) => (
                              <option key={b} value={b}>
                                {u.badges.includes(b) ? `− ${b}` : `+ ${b}`}
                              </option>
                            ))}
                          </select>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        ) : (
          reports == null ? (
            <div style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.35)' }}>Loading…</div>
          ) : reports.length === 0 ? (
            <div style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.45)' }}>
              Nothing reported. Quiet is good.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {reports.map((r) => (
                <div key={r.id} style={{
                  padding: '10px 12px', borderRadius: 10,
                  background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.07)',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span style={{
                      fontSize: 9, fontFamily: MONO, fontWeight: 700, padding: '1px 6px',
                      borderRadius: 999, background: 'rgba(255,255,255,0.06)',
                      color: 'rgba(255,255,255,0.65)', border: '1px solid rgba(255,255,255,0.12)',
                      textTransform: 'uppercase',
                    }}>{r.targetKind}</span>
                    <span style={{ fontSize: 10.5, fontFamily: MONO, color: 'rgba(255,255,255,0.55)' }}>
                      #{r.targetId}
                    </span>
                    <div style={{ flex: 1 }} />
                    {/* Never anonymous — somebody filing hundreds is itself
                        visible from this column. */}
                    <span style={{ fontSize: 9.5, fontFamily: MONO, color: 'rgba(255,255,255,0.3)' }}>
                      by {r.reportedBy ? `@${r.reportedBy}` : 'unknown'} · {new Date(r.createdAt * 1000).toLocaleDateString()}
                    </span>
                  </div>
                  <div style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.7)', marginTop: 5, whiteSpace: 'pre-wrap' }}>
                    {r.reason}
                  </div>
                  <div style={{ display: 'flex', gap: 6, marginTop: 9, flexWrap: 'wrap' }}>
                    {r.targetKind === 'comment' && (
                      <button
                        disabled={!!busy}
                        onClick={() => void act('Comment hidden', 'hide-comment', { id: Number(r.targetId) })}
                        style={smallBtn(false)}
                      >Hide comment</button>
                    )}
                    <button
                      disabled={!!busy}
                      onClick={() => void act('Report closed', 'resolve', { id: r.id })}
                      style={smallBtn(true)}
                    >Close report</button>
                  </div>
                </div>
              ))}
            </div>
          )
        )}
      </div>
    </>,
  );
}

const smallBtn = (primary: boolean): React.CSSProperties => ({
  padding: '3px 9px', fontSize: 10, fontWeight: 600, borderRadius: 5,
  background: primary ? 'rgba(255,255,255,0.06)' : 'rgba(251,113,133,0.1)',
  color: primary ? 'rgba(255,255,255,0.75)' : '#fb7185',
  border: `1px solid ${primary ? 'rgba(255,255,255,0.14)' : 'rgba(251,113,133,0.3)'}`,
  cursor: 'pointer',
});

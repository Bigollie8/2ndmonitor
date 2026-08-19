import { useCallback, useEffect, useState } from 'react';
import { cfgUrl } from '../state/marketplaceConfig';

const MONO = '"JetBrains Mono", ui-monospace, monospace';

interface Account {
  email: string;
  handle: string | null;
  displayName: string | null;
  bio: string | null;
  links: string[];
  accent?: string | null;
  avatarSeed: string | null;
  suspended: boolean;
}

/** Your own creator profile: claim a handle, set a name, bio and links.
 *
 *  The handle claim is deliberately one-way in the UI as well as the server.
 *  Changing it would let someone shed a reputation and would rot every link
 *  to their work, so once set the field becomes read-only and says why.
 *
 *  Writes surface their errors. Unlike the read paths in this app, which fail
 *  silently like a missing preview, the user typed something here and
 *  deserves to know if it did not land — the server returns a readable
 *  reason for every rejection and this shows it verbatim. */
/** The offered colours. A fixed palette rather than a free hex field: every
 *  one of these is legible against the app's dark surfaces, which an
 *  arbitrary colour is not. The server still validates #rrggbb, so this is a
 *  usability choice rather than the security boundary. */
const PROFILE_COLOURS = [
  '#7cf5d4', '#7cc6f5', '#a78bfa', '#f5a97c', '#f57c9c', '#8ef58e', '#f5e07c', '#c9d1d9',
];

export function AccountPanel({ accent, signedIn }: { accent: string; signedIn: boolean }) {
  const [account, setAccount] = useState<Account | null>(null);
  const [handleDraft, setHandleDraft] = useState('');
  const [name, setName] = useState('');
  const [bio, setBio] = useState('');
  const [links, setLinks] = useState('');
  // Your profile colour. A COLOUR is the whole customisation surface on
  // purpose: it cannot be a slur, a logo, or a photograph of somebody, which
  // an uploaded banner can, so it needs no moderation at all.
  const [profileAccent, setProfileAccent] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** kind drives the styling: an error must not look like the dim grey
   *  "Saved." — the tester's save failures hid in plain sight (0.9.4). */
  const [notice, setNoticeState] = useState<{ text: string; kind: 'ok' | 'err' } | null>(null);
  const setNotice = (text: string, kind: 'ok' | 'err' = 'ok') =>
    setNoticeState(text ? { text, kind } : null);

  const load = useCallback(async () => {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const a = await invoke<Account>('marketplace_account_get', { url: cfgUrl() });
      setAccount(a);
      setName(a.displayName ?? '');
      setBio(a.bio ?? '');
      setLinks((a.links ?? []).join('\n'));
      setProfileAccent(a.accent ?? null);
    } catch (e) {
      setNotice(String(e));
    }
  }, []);

  useEffect(() => {
    if (signedIn) { void load(); return; }
    // Signed-out (0.9.12): drop the previous account's data and form drafts,
    // or a re-register into a NEW account starts from the OLD account's
    // email/handle/bio still sitting in this panel.
    setAccount(null);
    setHandleDraft('');
    setName('');
    setBio('');
    setLinks('');
    setProfileAccent(null);
    setNoticeState(null);
  }, [signedIn, load]);

  if (!signedIn) {
    return (
      <div style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.5)' }}>
        Sign in above to set up your creator profile.
      </div>
    );
  }

  const claim = async () => {
    setBusy(true);
    setNotice('');
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('marketplace_claim_handle', { url: cfgUrl(), handle: handleDraft });
      await load();
      setNotice('Handle claimed.');
    } catch (e) {
      setNotice(String(e), 'err');
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    setBusy(true);
    setNotice('');
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('marketplace_account_patch', {
        url: cfgUrl(),
        patch: {
          displayName: name,
          bio,
          // One per line, blanks dropped — a textarea is friendlier than
          // three inputs for something most people leave empty.
          links: links.split('\n').map((l) => l.trim()).filter(Boolean),
          // '' clears it server-side, back to the app's accent.
          accent: profileAccent ?? '',
        },
      });
      await load();
      setNotice('Saved.');
    } catch (e) {
      setNotice(String(e), 'err');
    } finally {
      setBusy(false);
    }
  };

  const field = {
    padding: '5px 9px', fontSize: 11.5, borderRadius: 6, width: '100%',
    background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.9)',
    border: '1px solid rgba(255,255,255,0.1)', outline: 'none', fontFamily: 'inherit',
  } as const;
  const label = {
    display: 'block', fontSize: 10.5, color: 'rgba(255,255,255,0.45)', marginBottom: 3,
  } as const;
  const button = (enabled: boolean) => ({
    padding: '4px 12px', fontSize: 11, fontWeight: 600, borderRadius: 6,
    background: `${accent}22`, color: accent, border: `1px solid ${accent}44`,
    cursor: enabled ? 'pointer' : 'not-allowed', opacity: enabled ? 1 : 0.5,
  } as const);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* No avatar or handle here: the popout header above already shows
          both, and three copies of the same face on one panel is what
          testing turned up. The masked email stays because it is the one
          identity fact the header does not carry. */}
      {account?.email && (
        <div style={{ fontSize: 10, fontFamily: MONO, color: 'rgba(255,255,255,0.3)' }}>
          {account.email}
        </div>
      )}

      {account?.handle ? (
        <div style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.4)' }}>
          Your handle is set. Changing it would break links to your work, so an admin has to do it.
        </div>
      ) : (
        <div>
          <div style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.5)', marginBottom: 5 }}>
            Choose a handle — 3–24 characters, letters, numbers, hyphens and underscores.
            You need one before you can publish, and it cannot be changed afterwards.
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              value={handleDraft}
              onChange={(e) => setHandleDraft(e.target.value)}
              placeholder="your-handle"
              style={field}
            />
            <button onClick={() => void claim()} disabled={busy || !handleDraft.trim()}
              style={button(!busy && !!handleDraft.trim())}>Claim</button>
          </div>
        </div>
      )}

      {/* Labelled rather than placeholder-only: a placeholder disappears the
          moment you type, so a filled-in form became three unexplained
          boxes. */}
      <div>
        <label style={label}>Display name</label>
        <input value={name} onChange={(e) => setName(e.target.value)}
          placeholder="Optional — your handle shows when blank" maxLength={40} style={field} />
      </div>
      <div>
        <label style={label}>Bio</label>
        <textarea value={bio} onChange={(e) => setBio(e.target.value)}
          placeholder="A line about what you make" rows={2} maxLength={280}
          style={{ ...field, resize: 'vertical' }} />
        <div style={{ fontSize: 9.5, fontFamily: MONO, color: 'rgba(255,255,255,0.28)', marginTop: 3 }}>
          {bio.length}/280
        </div>
      </div>
      <div>
        <label style={label}>Links</label>
        <textarea value={links} onChange={(e) => setLinks(e.target.value)}
          placeholder="https://example.com"
          rows={3} style={{ ...field, resize: 'vertical', fontFamily: MONO, fontSize: 10.5 }} />
        <div style={{ fontSize: 9.5, fontFamily: MONO, color: 'rgba(255,255,255,0.28)', marginTop: 3 }}>
          One per line, up to three, https only
        </div>
      </div>

      <div>
        <div style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.45)', marginBottom: 5 }}>
          Profile colour
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          {PROFILE_COLOURS.map((c) => (
            <button
              key={c}
              onClick={() => setProfileAccent(c)}
              aria-label={`Use ${c}`}
              style={{
                width: 22, height: 22, borderRadius: 999, cursor: 'pointer',
                background: c,
                border: profileAccent === c
                  ? '2px solid rgba(255,255,255,0.85)'
                  : '1px solid rgba(255,255,255,0.15)',
              }}
            />
          ))}
          <button
            onClick={() => setProfileAccent(null)}
            style={{
              padding: '3px 9px', fontSize: 10, borderRadius: 999, cursor: 'pointer',
              background: 'rgba(255,255,255,0.04)', color: 'rgba(255,255,255,0.6)',
              border: profileAccent == null
                ? '2px solid rgba(255,255,255,0.5)'
                : '1px solid rgba(255,255,255,0.12)',
            }}
          >Default</button>
        </div>
      </div>

      {/* Errors get a full-width red banner ABOVE the button — the old dim
          grey one-liner in the corner is exactly where the tester's real
          save failures went to die (0.9.4). */}
      {notice && notice.kind === 'err' && (
        <div style={{
          fontSize: 11, lineHeight: 1.5, color: '#fca5a5', padding: '8px 10px',
          borderRadius: 6, background: 'rgba(239,68,68,0.08)',
          border: '1px solid rgba(239,68,68,0.3)',
        }}>
          Couldn't save: {notice.text}
        </div>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        {notice && notice.kind === 'ok' && (
          <span style={{ fontSize: 10.5, color: '#86efac', flex: 1 }}>{notice.text}</span>
        )}
        <div style={{ flex: 1 }} />
        <button onClick={() => void save()} disabled={busy} style={button(!busy)}>
          {busy ? 'Saving…' : 'Save profile'}
        </button>
      </div>
    </div>
  );
}

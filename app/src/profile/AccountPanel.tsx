import { useCallback, useEffect, useState } from 'react';
import { identiconDataUri } from '../state/identicon';
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
  const [notice, setNotice] = useState('');

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

  useEffect(() => { if (signedIn) void load(); }, [signedIn, load]);

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
      setNotice(String(e));
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
      setNotice(String(e));
    } finally {
      setBusy(false);
    }
  };

  const field = {
    padding: '5px 9px', fontSize: 11.5, borderRadius: 6, width: '100%',
    background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.9)',
    border: '1px solid rgba(255,255,255,0.1)', outline: 'none', fontFamily: 'inherit',
  } as const;
  const button = (enabled: boolean) => ({
    padding: '4px 12px', fontSize: 11, fontWeight: 600, borderRadius: 6,
    background: `${accent}22`, color: accent, border: `1px solid ${accent}44`,
    cursor: enabled ? 'pointer' : 'not-allowed', opacity: enabled ? 1 : 0.5,
  } as const);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
        <img
          src={identiconDataUri(account?.avatarSeed || account?.handle || '?', 48)}
          alt=""
          width={48}
          height={48}
          style={{ borderRadius: 10, border: '1px solid rgba(255,255,255,0.09)' }}
        />
        <div style={{ fontSize: 11, fontFamily: MONO, color: 'rgba(255,255,255,0.45)' }}>
          {account?.handle ? `@${account.handle}` : 'no handle yet'}
          <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)' }}>{account?.email}</div>
        </div>
      </div>

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

      <input value={name} onChange={(e) => setName(e.target.value)}
        placeholder="Display name" maxLength={40} style={field} />
      <textarea value={bio} onChange={(e) => setBio(e.target.value)}
        placeholder="A line about what you make" rows={2} maxLength={280}
        style={{ ...field, resize: 'vertical' }} />
      <textarea value={links} onChange={(e) => setLinks(e.target.value)}
        placeholder={'https://example.com\nOne link per line, up to three, https only'}
        rows={3} style={{ ...field, resize: 'vertical', fontFamily: MONO, fontSize: 10.5 }} />

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

      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        {notice && (
          <span style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.6)', flex: 1 }}>{notice}</span>
        )}
        <div style={{ flex: 1 }} />
        <button onClick={() => void save()} disabled={busy} style={button(!busy)}>
          {busy ? 'Saving…' : 'Save profile'}
        </button>
      </div>
    </div>
  );
}

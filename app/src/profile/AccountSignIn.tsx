import { useEffect, useState } from 'react';
import { useMarketplaceAuth, register, verifyAccount } from '../state/marketplaceAuth';
import { cfgUrl } from '../state/marketplaceConfig';

const MONO = '"JetBrains Mono", ui-monospace, monospace';

// Same stacked-field styling the Settings panes use — this component lived
// there until 0.9.0 moved the whole profile system into its own surface, and
// keeping the field look identical is what makes the move read as a move
// rather than a redesign.
const fieldInputStyle: React.CSSProperties = {
  width: '100%', fontSize: 11.5, padding: '6px 9px', marginTop: 3,
  background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.08)',
  borderRadius: 6, color: '#fff', outline: 'none', boxSizing: 'border-box',
};
const fieldLabelStyle: React.CSSProperties = {
  fontSize: 10.5, color: 'rgba(255,255,255,0.45)',
};

function ActionButton({ label, onClick, accent }: { label: string; onClick: () => void; accent?: string }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '5px 12px', fontSize: 11, fontWeight: 600, borderRadius: 6,
        background: accent ? `${accent}22` : 'rgba(255,255,255,0.05)',
        color: accent ?? 'rgba(255,255,255,0.7)',
        border: accent ? `1px solid ${accent}44` : '1px solid rgba(255,255,255,0.12)',
        cursor: 'pointer',
      }}
    >{label}</button>
  );
}

/** Sign in, create an account, or sign out.
 *
 *  Moved out of Settings (where it was `MarketplaceAccountEditor`) into the
 *  profile popout — behaviour unchanged. The comments below each document a
 *  deliberate decision; they moved with the code so nobody "simplifies" them
 *  away. */
export function AccountSignIn({ accent }: { accent: string }) {
  const { state, signIn, signOut } = useMarketplaceAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  // Until 0.9.0 there was no way to create an account from inside the app at
  // all -- the only one that existed had been made by hand with curl. A
  // marketplace built around a community of creators needs a door.
  const [mode, setMode] = useState<'sign-in' | 'register'>('sign-in');
  const [registering, setRegistering] = useState(false);
  const [registerNote, setRegisterNote] = useState('');
  const [registerError, setRegisterError] = useState('');
  const [invite, setInvite] = useState('');

  const busy = state.status === 'checking' || state.status === 'signing-in' || registering;
  const canSubmit = !busy && email.trim() !== '' && password !== '';

  // The password only ever needs to live in this state for the duration of
  // one sign-in attempt — leaving it in the JS heap for the rest of the
  // popout's lifetime is pointless exposure. Cleared on success; deliberately
  // NOT cleared on failure, so a typo is one correction away rather than a
  // full retype.
  useEffect(() => {
    if (state.status === 'signed-in') { setPassword(''); setEmail(''); }
  }, [state.status]);

  // The server URL is user-editable (Settings -> Marketplace -> Server &
  // signing key, or anything else that can write the marketplace.url
  // localStorage key) and, unlike the signed index, a login POST has no
  // pinned-key verification of its own — an https:// URL pointed at an
  // attacker's host is indistinguishable from the real one by the https
  // check alone. Surfacing the exact host the password is about to be sent
  // to turns a silent redirect into a visible one.
  const targetHost = (() => {
    try { return new URL(cfgUrl()).host; } catch { return cfgUrl(); }
  })();

  const handleSignIn = () => {
    if (!canSubmit) return;
    void signIn(email.trim(), password);
  };

  const handleRegister = async () => {
    if (!canSubmit) return;
    setRegistering(true);
    setRegisterError('');
    setRegisterNote('');
    try {
      const { verifyToken, verified } = await register(
        cfgUrl(), email.trim(), password, invite,
      );
      if (verified) {
        // An invite already proved a human vouched for them, so there is
        // nothing left to confirm and no email to wait for.
        setRegisterNote('Account created. You can sign in now.');
        setMode('sign-in');
      } else if (verifyToken) {
        // The server is in dev-email mode and handed the token straight back,
        // so finish the job rather than asking someone to go and find an
        // email that was only ever printed to a log.
        await verifyAccount(cfgUrl(), verifyToken);
        setRegisterNote('Account created and confirmed. You can sign in now.');
        setMode('sign-in');
      } else {
        setRegisterNote('Account created. Check your email for the confirmation link, then sign in.');
      }
      setPassword('');
    } catch (e) {
      // The server's own words: "already exists", "not accepting new
      // accounts", a password rule. All different problems that read
      // differently, so none of them become a generic failure message.
      setRegisterError(String(e));
    } finally {
      setRegistering(false);
    }
  };

  if (state.status === 'signed-in') {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.75)' }}>
          Signed in{state.email ? <> as <span style={{ fontFamily: MONO, color: accent }}>{state.email}</span></> : ''}
        </div>
        <ActionButton label="Sign out" onClick={() => void signOut()} />
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 460 }}>
      <div style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.45)' }}>
        {mode === 'register' ? 'Creating an account on' : 'Signing in to'}{' '}
        <span style={{ fontFamily: MONO, color: accent }}>{targetHost}</span>
      </div>
      <div>
        <label style={fieldLabelStyle}>Email</label>
        <input
          type="email" value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={busy}
          spellCheck={false}
          autoComplete="username"
          style={fieldInputStyle}
        />
      </div>
      <div>
        <label style={fieldLabelStyle}>Password</label>
        <input
          type="password" value={password}
          onChange={(e) => setPassword(e.target.value)}
          disabled={busy}
          autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return;
            if (mode === 'register') void handleRegister(); else handleSignIn();
          }}
          style={fieldInputStyle}
        />
        {mode === 'register' && (
          <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)', marginTop: 4 }}>
            At least 8 characters.
          </div>
        )}
      </div>
      {mode === 'register' && (
        <div>
          <label style={fieldLabelStyle}>Invite code</label>
          <input
            value={invite}
            onChange={(e) => setInvite(e.target.value)}
            placeholder="XXXX-XXXX-XXXX"
            disabled={busy}
            spellCheck={false}
            autoCapitalize="characters"
            style={{ ...fieldInputStyle, fontFamily: MONO, letterSpacing: '0.06em' }}
          />
          {/* Said plainly, because "leave it blank" only works on a server
              that can send mail — and this one may not be able to. */}
          <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)', marginTop: 4, lineHeight: 1.5 }}>
            A code gets you in straight away. Without one, this marketplace has to
            email you a confirmation — which only works if its owner has set up mail.
          </div>
        </div>
      )}
      {/* On failure, the server's own message (wrong password vs. unverified
         vs. unreachable server are different problems and read differently
         here) — never a generic "sign-in failed". See login_status_message
         in marketplace.rs. */}
      {state.status === 'error' && (
        <div style={{ color: '#fb7185', fontSize: 11 }}>{state.message}</div>
      )}
      {registerError && (
        <div style={{ color: '#fb7185', fontSize: 11 }}>{registerError}</div>
      )}
      {registerNote && (
        <div style={{ color: '#7cf5d4', fontSize: 11 }}>{registerNote}</div>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        {mode === 'sign-in' ? (
          <ActionButton
            label={state.status === 'signing-in' ? 'Signing in…' : 'Sign in'}
            onClick={handleSignIn}
            accent={canSubmit ? accent : undefined}
          />
        ) : (
          <ActionButton
            label={registering ? 'Creating…' : 'Create account'}
            onClick={() => { void handleRegister(); }}
            accent={canSubmit ? accent : undefined}
          />
        )}
        <button
          onClick={() => {
            setMode(mode === 'sign-in' ? 'register' : 'sign-in');
            setRegisterError('');
            setRegisterNote('');
          }}
          style={{
            background: 'transparent', border: 'none', padding: 0, cursor: 'pointer',
            fontSize: 11, color: 'rgba(255,255,255,0.5)', textDecoration: 'underline',
          }}
        >
          {mode === 'sign-in' ? 'Create an account' : 'I already have an account'}
        </button>
      </div>
    </div>
  );
}

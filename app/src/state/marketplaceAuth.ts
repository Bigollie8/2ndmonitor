// ─────────────────────────────────────────────────────────────────────────────
// Marketplace sign-in. The app is anonymous today — this is the first
// credential-handling path it has ever had, so it gets the same treatment as
// every other secret: the session token lives Rust-side in the DPAPI store
// (secrets.rs, via marketplace.rs's marketplace_login/logout/session_status
// commands) and NEVER crosses into this module, this file's state, or
// localStorage. What crosses the IPC boundary is a bool and an already-masked
// email string ("oli***") — see marketplace.rs's doc comment for why that
// masking happens Rust-side, before the value is ever stored, rather than
// here.
//
// `authReducer` below is the pure decision this task's tests target — the
// signed-out → signing-in → signed-in → error state machine — following the
// pattern used elsewhere in this codebase (seedStatus.ts's latch,
// contentRegistry.ts's resolveVizSurface): the React binding
// (useMarketplaceAuth) is a thin, untested wrapper; the decision it wraps is
// a plain function tested without React at all.
// ─────────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useReducer } from 'react';
import { isTauri } from './tauri';
import { cfgUrl } from './marketplaceConfig';

export type AuthState =
  | { status: 'checking' }
  | { status: 'signed-out' }
  | { status: 'signing-in' }
  | { status: 'signed-in'; email: string | null }
  | { status: 'error'; message: string };

export type AuthAction =
  | { type: 'STATUS_LOADED'; signedIn: boolean; email: string | null }
  | { type: 'LOGIN_START' }
  | { type: 'LOGIN_SUCCESS'; email: string | null }
  | { type: 'LOGIN_FAILURE'; message: string }
  | { type: 'LOGOUT' };

export const initialAuthState: AuthState = { status: 'checking' };

/** Pure state machine — no React, no Tauri, no I/O. Every transition is
 *  unconditional on the PRIOR state (e.g. LOGIN_START always yields
 *  'signing-in', whether coming from 'signed-out' or 'error') — the reducer's
 *  job is just "given this event, what does the UI show now", not policing
 *  which events are legal from which state. Guarding "don't let the user
 *  submit while already signing in" belongs to the UI (disable the button),
 *  not here. */
export function authReducer(state: AuthState, action: AuthAction): AuthState {
  switch (action.type) {
    case 'STATUS_LOADED':
      return action.signedIn
        ? { status: 'signed-in', email: action.email }
        : { status: 'signed-out' };
    case 'LOGIN_START':
      return { status: 'signing-in' };
    case 'LOGIN_SUCCESS':
      return { status: 'signed-in', email: action.email };
    case 'LOGIN_FAILURE':
      return { status: 'error', message: action.message };
    case 'LOGOUT':
      return { status: 'signed-out' };
    default:
      return state;
  }
}

// ---------------------------------------------------------------------------
// Tauri command wrappers. Each is a thin invoke() call — no logic worth unit
// testing lives here, which is why authReducer above is the tested surface.
// ---------------------------------------------------------------------------

export interface SessionStatus {
  signedIn: boolean;
  email: string | null;
}

export async function fetchSessionStatus(): Promise<SessionStatus> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<SessionStatus>('marketplace_session_status');
}

/** Resolves with nothing on success — the session token never crosses into
 *  this process's JS heap. A failed sign-in rejects with the message
 *  `marketplace_login` produced (see marketplace.rs's login_status_message):
 *  the server's actual reason (wrong password / unverified / rate-limited)
 *  or a transport failure, never a single generic string for both. */
export async function login(url: string, email: string, password: string): Promise<void> {
  const { invoke } = await import('@tauri-apps/api/core');
  await invoke('marketplace_login', { url, email, password });
}

export async function logout(): Promise<void> {
  const { invoke } = await import('@tauri-apps/api/core');
  await invoke('marketplace_logout');
}

/** Creates an account.
 *
 *  Returns the verification token when the server is in dev-email mode and
 *  handed one back, and `null` when it sent a real email instead. The caller
 *  uses that to decide whether it can finish the flow immediately or has to
 *  say "check your email" — the app cannot know which mode a server is in
 *  without asking it. */
export async function register(
  url: string,
  email: string,
  password: string,
): Promise<{ verifyToken: string | null }> {
  const { invoke } = await import('@tauri-apps/api/core');
  const res = await invoke<{ verifyToken: string | null }>('marketplace_register', {
    url, email, password,
  });
  return { verifyToken: res?.verifyToken ?? null };
}

/** Confirms an address with the token from the verification email. */
export async function verifyAccount(url: string, token: string): Promise<void> {
  const { invoke } = await import('@tauri-apps/api/core');
  await invoke('marketplace_verify_account', { url, token });
}

// ---------------------------------------------------------------------------
// React binding.
// ---------------------------------------------------------------------------

export interface UseMarketplaceAuthResult {
  state: AuthState;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
}

/** Loads the current session status on mount, then exposes sign-in/sign-out
 *  actions that drive `authReducer`. Outside Tauri (plain browser dev) there
 *  is no secret store to sign into, so the status check resolves straight to
 *  'signed-out' and signIn fails fast with an explanatory message instead of
 *  attempting an invoke() that has no host to answer it. */
export function useMarketplaceAuth(): UseMarketplaceAuthResult {
  const [state, dispatch] = useReducer(authReducer, initialAuthState);

  useEffect(() => {
    if (!isTauri) {
      dispatch({ type: 'STATUS_LOADED', signedIn: false, email: null });
      return;
    }
    let cancelled = false;
    fetchSessionStatus()
      .then((s) => {
        if (!cancelled) dispatch({ type: 'STATUS_LOADED', signedIn: s.signedIn, email: s.email });
      })
      .catch(() => {
        if (!cancelled) dispatch({ type: 'STATUS_LOADED', signedIn: false, email: null });
      });
    return () => { cancelled = true; };
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    dispatch({ type: 'LOGIN_START' });
    if (!isTauri) {
      dispatch({ type: 'LOGIN_FAILURE', message: 'Marketplace sign-in requires the desktop app.' });
      return;
    }
    try {
      await login(cfgUrl(), email, password);
      const status = await fetchSessionStatus();
      dispatch({ type: 'LOGIN_SUCCESS', email: status.email });
    } catch (e) {
      dispatch({ type: 'LOGIN_FAILURE', message: String(e) });
    }
  }, []);

  const signOut = useCallback(async () => {
    if (isTauri) {
      try {
        await logout();
      } catch (e) {
        // Logout clearing a local secret store has no meaningful failure
        // mode short of a disk error; fall through to reflecting signed-out
        // in the UI regardless rather than stranding the user on a stale
        // "signed in" screen they have no way to dismiss.
        console.warn('marketplace logout failed', e);
      }
    }
    dispatch({ type: 'LOGOUT' });
  }, []);

  return { state, signIn, signOut };
}

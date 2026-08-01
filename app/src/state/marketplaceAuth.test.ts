import test from 'node:test';
import assert from 'node:assert/strict';
import { authReducer, initialAuthState, type AuthState } from './marketplaceAuth';

test('marketplaceAuth: starts in checking, not signed-out — nothing is known yet', () => {
  assert.deepEqual(initialAuthState, { status: 'checking' });
});

test('marketplaceAuth: STATUS_LOADED with no session settles to signed-out', () => {
  const next = authReducer({ status: 'checking' }, { type: 'STATUS_LOADED', signedIn: false, email: null });
  assert.deepEqual(next, { status: 'signed-out' });
});

test('marketplaceAuth: STATUS_LOADED with a session settles to signed-in, carrying the masked email', () => {
  const next = authReducer(
    { status: 'checking' },
    { type: 'STATUS_LOADED', signedIn: true, email: 'oli***' },
  );
  assert.deepEqual(next, { status: 'signed-in', email: 'oli***' });
});

test('marketplaceAuth: the happy path — signed-out, signing-in, signed-in', () => {
  let state: AuthState = { status: 'signed-out' };
  state = authReducer(state, { type: 'LOGIN_START' });
  assert.equal(state.status, 'signing-in');
  state = authReducer(state, { type: 'LOGIN_SUCCESS', email: 'oli***' });
  assert.deepEqual(state, { status: 'signed-in', email: 'oli***' });
});

test('marketplaceAuth: a signed-in session can carry no email at all (older session, or a store without one)', () => {
  const state = authReducer({ status: 'signing-in' }, { type: 'LOGIN_SUCCESS', email: null });
  assert.deepEqual(state, { status: 'signed-in', email: null });
});

test('marketplaceAuth: a failed sign-in lands on error carrying the server\'s own message', () => {
  const state = authReducer(
    { status: 'signing-in' },
    { type: 'LOGIN_FAILURE', message: 'incorrect email or password' },
  );
  assert.deepEqual(state, { status: 'error', message: 'incorrect email or password' });
});

// The whole point of this task: a wrong password and an unreachable server
// are different problems. The reducer doesn't invent the distinction (that's
// marketplace.rs's login_status_message) but it must carry whatever message
// arrives through unmodified — no generic "sign-in failed" substituted here.
test('marketplaceAuth: distinct failure messages are carried through unmodified, not collapsed', () => {
  const wrongPassword = authReducer(
    { status: 'signing-in' },
    { type: 'LOGIN_FAILURE', message: 'incorrect email or password' },
  );
  const unreachable = authReducer(
    { status: 'signing-in' },
    { type: 'LOGIN_FAILURE', message: 'request failed: connection refused' },
  );
  assert.notEqual(
    (wrongPassword as { status: 'error'; message: string }).message,
    (unreachable as { status: 'error'; message: string }).message,
  );
});

test('marketplaceAuth: retrying from error clears the old message — LOGIN_START always yields a clean signing-in', () => {
  const errored: AuthState = { status: 'error', message: 'incorrect email or password' };
  const retrying = authReducer(errored, { type: 'LOGIN_START' });
  assert.deepEqual(retrying, { status: 'signing-in' });
});

test('marketplaceAuth: LOGOUT returns to signed-out from any prior state', () => {
  const fromSignedIn = authReducer({ status: 'signed-in', email: 'oli***' }, { type: 'LOGOUT' });
  const fromError = authReducer({ status: 'error', message: 'x' }, { type: 'LOGOUT' });
  assert.deepEqual(fromSignedIn, { status: 'signed-out' });
  assert.deepEqual(fromError, { status: 'signed-out' });
});

// Regression guard: the token is never part of this state machine's shape —
// only a masked email, or nothing. A future edit adding a `token` field to
// LOGIN_SUCCESS or the signed-in state would be exactly the kind of change
// that reintroduces the credential into the frontend; this pins the key set
// so that change fails a test instead of silently landing.
test('marketplaceAuth: signed-in state carries only status and email — never a token field', () => {
  const state = authReducer({ status: 'signing-in' }, { type: 'LOGIN_SUCCESS', email: 'oli***' });
  assert.deepEqual(Object.keys(state).sort(), ['email', 'status']);
});

test('marketplaceAuth: error state carries only status and message — never a token field', () => {
  const state = authReducer({ status: 'signing-in' }, { type: 'LOGIN_FAILURE', message: 'nope' });
  assert.deepEqual(Object.keys(state).sort(), ['message', 'status']);
});

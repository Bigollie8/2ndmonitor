import test from 'node:test';
import assert from 'node:assert/strict';
import { checkDiscordClientId } from './discordId';

test('accepts a real snowflake, with or without stray whitespace', () => {
  assert.equal(checkDiscordClientId('123456789012345678').ok, true);
  assert.equal(checkDiscordClientId('  123456789012345678  ').ok, true);
  // 17 and 20 digits are both inside the accepted range.
  assert.equal(checkDiscordClientId('12345678901234567').ok, true);
  assert.equal(checkDiscordClientId('12345678901234567890').ok, true);
});

test('names the Public Key specifically — the most common wrong paste', () => {
  // 64 hex chars, shown directly beneath the Application ID on the same page.
  const r = checkDiscordClientId('a'.repeat(64));
  assert.equal(r.ok, false);
  assert.match(r.problem ?? '', /public key/i);
  assert.match(r.problem ?? '', /Application ID/);
});

test('refuses a bot token without echoing it back', () => {
  // Deliberately NOT shaped like a real Discord token. An earlier version of
  // this fixture used the authentic three-segment base64 form and GitHub's
  // push protection rejected the commit outright — correctly, since a scanner
  // cannot tell a convincing fake from a live credential. The validator only
  // needs "contains a dot and is long", so the fixture says what it is.
  const token = `not-a-real-token.${'x'.repeat(30)}.placeholder`;
  const r = checkDiscordClientId(token);
  assert.equal(r.ok, false);
  assert.match(r.problem ?? '', /token/i);
  // A secret must never be reflected into the UI.
  assert.ok(!(r.problem ?? '').includes(token));
});

test('catches a pasted URL', () => {
  const r = checkDiscordClientId('https://discord.com/developers/applications/123456789012345678');
  assert.equal(r.ok, false);
  assert.match(r.problem ?? '', /URL/i);
});

test('a truncated number says how many digits were found', () => {
  const r = checkDiscordClientId('12345');
  assert.equal(r.ok, false);
  assert.match(r.problem ?? '', /5/);
});

test('empty input asks for the id rather than erroring', () => {
  const r = checkDiscordClientId('   ');
  assert.equal(r.ok, false);
  assert.match(r.problem ?? '', /Paste/i);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parsePrivmsg, parseTags } from './twitchChat';

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

test('parsePrivmsg: full PRIVMSG with IRCv3 tags', () => {
  const line =
    '@badge-info=;badges=broadcaster/1;client-nonce=deadbeef;color=#FF0000;' +
    'display-name=Foo;emotes=25:0-4;first-msg=0;flags=;id=b34ccfc7-4977-403a-8a94-33c6bac34fb8;' +
    'mod=0;room-id=713936733;subscriber=0;tmi-sent-ts=1690000000000;turbo=0;user-id=713936733;user-type= ' +
    ':foo!foo@foo.tmi.twitch.tv PRIVMSG #channel :Kappa hello world';
  const p = parsePrivmsg(line);
  assert.ok(p, 'should parse');
  assert.equal(p.user, 'foo');
  assert.equal(p.displayName, 'Foo');
  assert.equal(p.color, '#FF0000');
  assert.equal(p.text, 'Kappa hello world');
});

test('parsePrivmsg: message body containing colons is preserved intact', () => {
  const line =
    '@color=#1E90FF;display-name=Bar :bar!bar@bar.tmi.twitch.tv PRIVMSG #chan ' +
    ':note: see https://example.com:8080/x :) end';
  const p = parsePrivmsg(line);
  assert.ok(p);
  assert.equal(p.text, 'note: see https://example.com:8080/x :) end');
  assert.equal(p.color, '#1E90FF');
});

test('parsePrivmsg: /me action arrives as CTCP ACTION and passes through as raw text', () => {
  // Twitch wraps /me messages in \x01ACTION ...\x01; the parser does not
  // special-case it, so the wrapper is preserved in text (documented behavior).
  const line = ':foo!foo@foo.tmi.twitch.tv PRIVMSG #chan :\x01ACTION waves at chat\x01';
  const p = parsePrivmsg(line);
  assert.ok(p);
  assert.equal(p.text, '\x01ACTION waves at chat\x01');
});

test('parsePrivmsg: no tag prefix — display name falls back to login, color to deterministic palette', () => {
  const line = ':somelogin!somelogin@somelogin.tmi.twitch.tv PRIVMSG #chan :hi there';
  const p = parsePrivmsg(line);
  assert.ok(p);
  assert.equal(p.user, 'somelogin');
  assert.equal(p.displayName, 'somelogin');
  assert.equal(p.text, 'hi there');
  // Fallback color is a synthesized hex color, deterministic per login.
  assert.match(p.color ?? '', HEX_COLOR);
  const again = parsePrivmsg(line);
  assert.ok(again);
  assert.equal(again.color, p.color);
});

test('parsePrivmsg: empty tag values — empty color/display-name fall back', () => {
  const line =
    '@badge-info=;badges=;color=;display-name=;emotes=;flags=;user-type= ' +
    ':baz!baz@baz.tmi.twitch.tv PRIVMSG #chan :yo';
  const p = parsePrivmsg(line);
  assert.ok(p);
  assert.equal(p.displayName, 'baz');
  assert.match(p.color ?? '', HEX_COLOR); // fell back to palette, not ''
});

test('parsePrivmsg: invalid color tag value falls back to palette color', () => {
  const line =
    '@color=red;display-name=Qux :qux!qux@qux.tmi.twitch.tv PRIVMSG #chan :hey';
  const p = parsePrivmsg(line);
  assert.ok(p);
  assert.notEqual(p.color, 'red');
  assert.match(p.color ?? '', HEX_COLOR);
});

test('parsePrivmsg: non-PRIVMSG lines are rejected', () => {
  assert.equal(parsePrivmsg(':tmi.twitch.tv 001 justinfan123 :Welcome, GLHF!'), null);
  assert.equal(parsePrivmsg('PING :tmi.twitch.tv'), null);
  assert.equal(parsePrivmsg(':foo!foo@foo.tmi.twitch.tv JOIN #chan'), null);
  assert.equal(
    parsePrivmsg('@emote-only=0;room-id=1 :tmi.twitch.tv ROOMSTATE #chan'),
    null,
  );
  // Contains the word PRIVMSG but not in the message-command position.
  assert.equal(parsePrivmsg('PRIVMSG'), null);
});

test('parsePrivmsg: malformed PRIVMSG (missing !user@host prefix) is rejected', () => {
  assert.equal(parsePrivmsg(':tmi.twitch.tv PRIVMSG #chan :hi'), null);
});

test('parseTags: splits on ; and first =, keeps empty values, skips pairs without =', () => {
  const tags = parseTags('a=1;b=;c;d=x=y;display-name=Some1');
  assert.deepEqual(tags, { a: '1', b: '', d: 'x=y', 'display-name': 'Some1' });
});

test('parseTags: empty string yields empty record', () => {
  assert.deepEqual(parseTags(''), {});
});

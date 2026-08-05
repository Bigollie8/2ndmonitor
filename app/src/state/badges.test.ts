import test from 'node:test';
import assert from 'node:assert/strict';
import { badgeStyle, visibleBadges } from './badges';

test('a known badge has its designed look', () => {
  const s = badgeStyle('founder');
  assert.equal(s.label, 'Founder');
  assert.equal(s.colour, '#f5c451');
});

test('badge lookup is case and whitespace insensitive', () => {
  assert.equal(badgeStyle('  MODERATOR ').label, 'Moderator');
});

// The server can grant a new kind without a client update. A badge that
// silently vanished would be worse than a generic chip.
test('an unknown badge still renders, title-cased', () => {
  const s = badgeStyle('early-adopter');
  assert.equal(s.label, 'Early Adopter');
  assert.equal(s.glyph, '●');
});

test('non-arrays and non-strings are dropped rather than thrown on', () => {
  assert.deepEqual(visibleBadges(null), []);
  assert.deepEqual(visibleBadges('founder'), []);
  assert.deepEqual(visibleBadges([1, {}, null, 'founder']), ['founder']);
});

test('blanks and duplicates collapse', () => {
  assert.deepEqual(visibleBadges(['founder', ' Founder ', '', '   ']), ['founder']);
});

// A bulk grant must not push someone's name off screen.
test('the visible count is capped', () => {
  const many = ['a', 'b', 'c', 'd', 'e', 'f'];
  assert.equal(visibleBadges(many).length, 4);
  assert.equal(visibleBadges(many, 2).length, 2);
});

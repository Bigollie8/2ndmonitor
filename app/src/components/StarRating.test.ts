import test from 'node:test';
import assert from 'node:assert/strict';
import { ratingDisplay } from './StarRating';

test('ratingDisplay: a null rating shows zero filled stars and no count, signed in or out', () => {
  const in_ = ratingDisplay(null, true);
  const out = ratingDisplay(null, false);
  assert.equal(in_.filledStars, 0);
  assert.equal(in_.countLabel, '');
  assert.equal(out.filledStars, 0);
  assert.equal(out.countLabel, '');
});

test('ratingDisplay: a zero-count rating object is treated identically to null', () => {
  const zero = ratingDisplay({ avg: 0, count: 0 }, true);
  const nul = ratingDisplay(null, true);
  assert.equal(zero.filledStars, nul.filledStars);
  assert.equal(zero.countLabel, nul.countLabel);
  assert.equal(zero.interactive, nul.interactive);
});

test('ratingDisplay: a real rating rounds the average to whole filled stars and shows the count', () => {
  const v = ratingDisplay({ avg: 4.2, count: 17 }, true);
  assert.equal(v.filledStars, 4);
  assert.equal(v.countLabel, '(17)');
});

test('ratingDisplay: rounding is to the nearest star, not floor or ceil', () => {
  assert.equal(ratingDisplay({ avg: 4.5, count: 2 }, true).filledStars, 5, '4.5 rounds up');
  assert.equal(ratingDisplay({ avg: 4.49, count: 2 }, true).filledStars, 4, '4.49 rounds down');
});

test('ratingDisplay: signed in is interactive regardless of whether a rating exists', () => {
  assert.equal(ratingDisplay(null, true).interactive, true);
  assert.equal(ratingDisplay({ avg: 3, count: 5 }, true).interactive, true);
});

test('ratingDisplay: signed out is never interactive, and says so in the tooltip', () => {
  const v = ratingDisplay({ avg: 3, count: 5 }, false);
  assert.equal(v.interactive, false);
  assert.match(v.tooltip, /sign in/i);
});

test('ratingDisplay: signed-in tooltip is distinct from the signed-out one for the same rating', () => {
  const rating = { avg: 3.6, count: 4 };
  const signedInTooltip = ratingDisplay(rating, true).tooltip;
  const signedOutTooltip = ratingDisplay(rating, false).tooltip;
  assert.notEqual(signedInTooltip, signedOutTooltip);
});

test('ratingDisplay: the tooltip pluralizes "rating(s)" correctly at the boundary', () => {
  assert.match(ratingDisplay({ avg: 5, count: 1 }, true).tooltip, /1 rating(?!s)/);
  assert.match(ratingDisplay({ avg: 5, count: 2 }, true).tooltip, /2 ratings/);
});

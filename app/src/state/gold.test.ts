import { test } from 'node:test';
import assert from 'node:assert/strict';
import { goldPricing, TROY_OUNCE_GRAMS, GOLD_SYMBOL } from './gold';
import type { StockQuote } from './stocks';

const quote = (over: Partial<StockQuote>): StockQuote => ({
  symbol: GOLD_SYMBOL, price: null, prev_close: null, currency: 'USD',
  short_name: 'Gold', error: null, ...over,
});

test('per-gram is per-oz divided by the troy ounce, exactly', () => {
  const g = goldPricing(quote({ price: 3110.34768, prev_close: 3000 }));
  assert.ok(g);
  assert.equal(g.perOz, 3110.34768);
  assert.ok(Math.abs(g.perGram - 100) < 1e-9);
  assert.ok(Math.abs(g.perGram - g.perOz / TROY_OUNCE_GRAMS) < 1e-12);
});

test('change percent computed only when both ends exist', () => {
  assert.ok(Math.abs(goldPricing(quote({ price: 3300, prev_close: 3000 }))!.changePct! - 10) < 1e-9);
  assert.equal(goldPricing(quote({ price: 3300 }))!.changePct, null);
  assert.equal(goldPricing(quote({ price: 3300, prev_close: 0 }))!.changePct, null);
});

test('unusable quotes yield null, never fake numbers', () => {
  assert.equal(goldPricing(undefined), null);
  assert.equal(goldPricing(null), null);
  assert.equal(goldPricing(quote({})), null);
  assert.equal(goldPricing(quote({ price: 0 })), null);
  assert.equal(goldPricing(quote({ price: -5 })), null);
  assert.equal(goldPricing(quote({ price: Number.NaN })), null);
});

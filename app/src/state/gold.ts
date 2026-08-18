// Gold spot pricing (0.9.8) — pure helpers for the Gold tile.
//
// Source: the existing Rust-side Yahoo proxy (`fetch_stock_quotes`) with
// COMEX gold futures `GC=F`, quoted in USD per TROY OUNCE. No new API or
// key. Spot gold IS 24-karat fine gold by definition, so "24K per gram" is
// exactly the per-ounce spot divided by grams-per-troy-ounce — there is no
// separate '24K price' to fetch.

import type { StockQuote } from './stocks';

/** One troy ounce in grams (exact definition: 31.1034768 g). */
export const TROY_OUNCE_GRAMS = 31.1034768;

/** Yahoo symbol for gold spot (COMEX front-month futures, USD/oz t). */
export const GOLD_SYMBOL = 'GC=F';

export interface GoldPricing {
  /** USD per troy ounce. */
  perOz: number;
  /** USD per gram — perOz / 31.1034768, consistent by construction. */
  perGram: number;
  /** Day change in percent vs previous close, when both ends exist. */
  changePct: number | null;
}

/** Derive both units from one quote. null when the quote has no usable
 *  price (fetch error, market data gap) — the tile renders its error state
 *  instead of a stale or fake number. */
export function goldPricing(q: StockQuote | undefined | null): GoldPricing | null {
  const price = q?.price;
  if (price == null || !isFinite(price) || price <= 0) return null;
  const prev = q?.prev_close;
  const changePct = prev != null && isFinite(prev) && prev !== 0
    ? ((price - prev) / prev) * 100
    : null;
  return { perOz: price, perGram: price / TROY_OUNCE_GRAMS, changePct };
}

import { isTauri } from './tauri';

export interface StockQuote {
  symbol: string;
  price: number | null;
  prev_close: number | null;
  currency: string | null;
  short_name: string | null;
  error: string | null;
}

/** Fetch a batch of quotes via the Rust-side Yahoo proxy. Returns an empty
 *  array when not in Tauri (no graceful browser fallback — Yahoo's CORS rules
 *  block direct browser calls anyway). */
export async function fetchStockQuotes(symbols: string[]): Promise<StockQuote[]> {
  if (!isTauri) return [];
  if (symbols.length === 0) return [];
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    return await invoke<StockQuote[]>('fetch_stock_quotes', { symbols });
  } catch (err) {
    console.warn('fetch_stock_quotes failed', err);
    return [];
  }
}

export interface StocksConfig {
  /** User's watchlist. Order is preserved in the tile. */
  symbols: string[];
}

export const DEFAULT_STOCKS_CONFIG: StocksConfig = {
  symbols: ['AAPL', 'MSFT', 'GOOGL', 'NVDA'],
};

export function parseStocksConfig(raw: unknown): StocksConfig {
  if (!raw || typeof raw !== 'object') return DEFAULT_STOCKS_CONFIG;
  const c = raw as Record<string, unknown>;
  if (!Array.isArray(c.symbols)) return DEFAULT_STOCKS_CONFIG;
  const symbols: string[] = [];
  for (const s of c.symbols) {
    if (typeof s !== 'string') continue;
    const trimmed = s.trim().toUpperCase();
    if (trimmed && trimmed.length <= 16 && symbols.length < 25) {
      symbols.push(trimmed);
    }
  }
  return { symbols: symbols.length > 0 ? symbols : DEFAULT_STOCKS_CONFIG.symbols };
}

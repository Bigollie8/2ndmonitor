# Stocks

Fetches `https://query1.finance.yahoo.com/v8/finance/chart/<symbol>?interval=1d&range=2d`
and shows one ticker's price. Migrated from the built-in `StocksTile`, with
a real capability loss — read on before installing.

## One symbol, not a watchlist — read why

The built-in reads a user-configured **watchlist** (`StocksConfig.symbols`,
an array, up to 25 tickers) and fetches all of them in a single Tauri
`invoke('fetch_stock_quotes', { symbols })`, which runs server-side in Rust
(`market.rs`) — a command declarative tiles cannot reach at all this phase
(`BROKER_COMMANDS` in `sandbox/broker.ts` ships empty on purpose; see
`DeclarativeTile.tsx`'s header comment). A declarative tile's only path to
Yahoo is a direct `net:` HTTP fetch, and that has two compounding
constraints:

1. **One `source.url` per tile, substituted only from `config`/`secret`.**
   There is no loop, no batching primitive — a `config` entry holding an
   array isn't even a supported shape (`ConfigDecl.type` is `"text"` or
   `"number"` only; see `sandbox/manifest.ts`). So even a comma-joined
   watchlist string couldn't turn into N separate fetches.
2. **Yahoo's batch endpoint requires auth.** `v7/finance/quote?symbols=A,B`
   — the one endpoint that could return multiple tickers from a single
   fetch — returned `401 Unauthorized` / `"User is unable to access this
   feature"` when tested live, unauthenticated. Yahoo gates it behind a
   crumb+cookie flow with no key-less equivalent. The single-symbol
   `v8/finance/chart/<symbol>` endpoint the Rust command actually calls
   per-symbol, by contrast, returned 200 live with no auth — confirmed by
   fetching it directly.

So this bundle is honestly what's left after both constraints: **track one
symbol**, set via `config.symbol` (`type: "text"`). Per the task brief, it
**starts empty** (no default, unlike the built-in's `AAPL, MSFT, GOOGL,
NVDA` default watchlist) — `needsSetup` blocks the first fetch until a
symbol is entered, same "needs setup" gate every config-only tile gets.
Bundle tiles are also `multiInstance: false` this phase (`tileRegistry.ts`),
so — unlike installing four copies of `tile-dictionary` for four words —
only one instance of this tile can be placed on the dashboard at all right
now, meaning **one ticker, not four**. Track more by asking for
multi-instance placement in a later phase, not by working around it here.

## Fields

Real response for `AAPL`, fetched live 2026-07-31 (`select:
"chart.result.0.meta"`):

```json
{
  "currency": "USD",
  "symbol": "AAPL",
  "regularMarketPrice": 301.395,
  "chartPreviousClose": 338.19
}
```

Resolved: `{{data.regularMarketPrice}}` → `301.395`, `{{data.symbol}}` →
`AAPL`, `{{data.chartPreviousClose}}` → `338.19`. Renders with the `stat`
primitive: price as the big value, symbol as the label above it, previous
close as the delta line below.

## Known limitations

- No % change — the built-in computes `(price - prev_close) / prev_close`
  client-side; the template grammar has no arithmetic, so `delta` shows the
  raw previous-close price ("prev 338.19") instead of a signed percentage,
  and there's no green/red color coding either (no conditional styling).
- No currency symbol/decimal-precision formatting (`formatPrice`'s
  4-decimals-under-$1 / `$`-prefix logic) — the raw number renders as-is.
- `config.symbol` substitutes into the URL path raw, unencoded (same
  pattern as `tile-dictionary`'s `config.word`) — case-insensitive (Yahoo
  normalizes `aapl` → `AAPL` in the response, confirmed live), but a
  symbol with characters `encodeURIComponent` would otherwise escape (e.g.
  a literal space) will break the request. Standard tickers (`AAPL`,
  `BRK.B`, `^GSPC`) are fine as typed.
- `intervalMs` is 60000 (1m), matching the built-in's `REFRESH_MS`. Well
  above the 15s floor.

No secrets. `config`: `symbol` (required before the tile fetches anything —
starts unconfigured). `net:query1.finance.yahoo.com` only.

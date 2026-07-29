import React, { useMemo, useState } from 'react';
import { HFTile } from './tiles';
import {
  type StockQuote,
  fetchStockQuotes,
  parseStocksConfig,
} from '../state/stocks';
import { usePoll } from '../state/usePoll';
import { TileEmpty, TileSkeleton } from './tileStates';
import type { Density } from '../types';

const REFRESH_MS = 60 * 1000;

export interface StocksTileProps {
  instanceId: string;
  density: Density;
  accent: string;
  editing: boolean;
  config: Record<string, unknown> | undefined;
  setConfig: (next: Record<string, unknown>) => void;
}

export function StocksTile({ density, accent, editing, config, setConfig }: StocksTileProps) {
  const parsed = useMemo(() => parseStocksConfig(config), [config]);
  const symbolsKey = parsed.symbols.join(',');
  // fetchStockQuotes returns [] both for "no symbols" and for a failed invoke,
  // so there is no reliable failure signal to promote to a throw; per-symbol
  // errors ride along inside each StockQuote.error and render in the rows.
  const { data, loading } = usePoll(
    () => fetchStockQuotes(parsed.symbols),
    REFRESH_MS,
    [symbolsKey],
  );
  const quotes: StockQuote[] = data ?? [];

  const [draft, setDraft] = useState<string>('');
  const [showEdit, setShowEdit] = useState<boolean>(false);

  const addSymbol = () => {
    const s = draft.trim().toUpperCase();
    if (!s) return;
    if (parsed.symbols.includes(s)) { setDraft(''); return; }
    setConfig({ ...parsed, symbols: [...parsed.symbols, s] } as unknown as Record<string, unknown>);
    setDraft('');
  };
  const removeSymbol = (sym: string) => {
    setConfig({
      ...parsed,
      symbols: parsed.symbols.filter((s) => s !== sym),
    } as unknown as Record<string, unknown>);
  };

  const headRight = (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
      <span style={{
        fontSize: 10, color: 'rgba(255,255,255,0.45)',
        fontFamily: '"JetBrains Mono", ui-monospace, monospace',
      }}>{parsed.symbols.length} {parsed.symbols.length === 1 ? 'ticker' : 'tickers'}</span>
      {editing && (
        <button
          onClick={() => setShowEdit((v) => !v)}
          style={{
            padding: '3px 8px', fontSize: 10, fontWeight: 600, borderRadius: 4,
            background: showEdit ? `${accent}22` : 'rgba(255,255,255,0.05)',
            color: showEdit ? accent : 'rgba(255,255,255,0.7)',
            border: showEdit ? `1px solid ${accent}55` : '1px solid rgba(255,255,255,0.08)',
            cursor: 'pointer',
            fontFamily: '"JetBrains Mono", ui-monospace, monospace',
          }}
        >{showEdit ? 'done' : 'edit'}</button>
      )}
    </div>
  );

  return (
    <HFTile title="Stocks" headRight={headRight} accent={accent} density={density} style={{ height: '100%' }}>
      <div style={{
        position: 'absolute', inset: 0, padding: 10,
        display: 'flex', flexDirection: 'column', gap: 4,
        overflow: 'hidden',
      }}>
        {parsed.symbols.length === 0 && (
          <TileEmpty icon="▲" line="No tickers. Add some in edit mode." />
        )}
        {parsed.symbols.length > 0 && loading && quotes.length === 0 && (
          <TileSkeleton rows={Math.min(parsed.symbols.length, 6)} />
        )}
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 1 }}>
          {!(loading && quotes.length === 0) && parsed.symbols.map((sym) => {
            const q = quotes.find((x) => x.symbol === sym);
            return (
              <Row
                key={sym}
                symbol={sym}
                quote={q}
                loading={loading && !q}
                accent={accent}
                showRemove={editing && showEdit}
                onRemove={() => removeSymbol(sym)}
              />
            );
          })}
        </div>
        {editing && showEdit && (
          <div style={{
            display: 'flex', gap: 6, paddingTop: 6,
            borderTop: '1px solid rgba(255,255,255,0.06)', flexShrink: 0,
          }}>
            <input
              type="text"
              value={draft}
              onChange={(e) => setDraft(e.target.value.toUpperCase())}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addSymbol(); } }}
              placeholder="Add ticker (e.g. TSLA)"
              maxLength={16}
              style={{
                flex: 1, fontSize: 11, padding: '5px 8px', borderRadius: 4,
                background: 'rgba(255,255,255,0.04)', color: '#fff',
                border: '1px solid rgba(255,255,255,0.1)',
                fontFamily: '"JetBrains Mono", ui-monospace, monospace', outline: 'none',
              }}
            />
            <button
              onClick={addSymbol}
              disabled={!draft.trim()}
              style={{
                padding: '5px 10px', fontSize: 11, fontWeight: 600, borderRadius: 4,
                background: draft.trim() ? accent : 'rgba(255,255,255,0.06)',
                color: draft.trim() ? '#000' : 'rgba(255,255,255,0.4)',
                border: 'none', cursor: draft.trim() ? 'pointer' : 'not-allowed',
              }}
            >Add</button>
          </div>
        )}
      </div>
    </HFTile>
  );
}

function Row({
  symbol, quote, loading, accent, showRemove, onRemove,
}: {
  symbol: string;
  quote: StockQuote | undefined;
  loading: boolean;
  accent: string;
  showRemove: boolean;
  onRemove: () => void;
}) {
  const price = quote?.price ?? null;
  const prev = quote?.prev_close ?? null;
  const hasError = !!quote?.error;
  const change = (price != null && prev != null && prev !== 0)
    ? ((price - prev) / prev) * 100
    : null;
  const changeColor = change == null ? 'rgba(255,255,255,0.4)'
    : change > 0 ? '#22c55e' : (change < 0 ? '#ef4444' : 'rgba(255,255,255,0.7)');

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10,
      padding: '4px 6px', fontSize: 11.5,
      background: 'transparent',
      borderRadius: 4,
    }}>
      <span style={{
        fontWeight: 700, color: '#fff',
        fontFamily: '"JetBrains Mono", ui-monospace, monospace',
        minWidth: 56,
      }}>{symbol}</span>
      <span style={{
        flex: 1,
        color: hasError ? '#fca5a5' : 'rgba(255,255,255,0.85)',
        fontFamily: '"JetBrains Mono", ui-monospace, monospace',
        textAlign: 'right',
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>
        {hasError ? quote!.error : (loading ? '…' : price != null ? formatPrice(price, quote?.currency) : '—')}
      </span>
      <span style={{
        color: changeColor, fontWeight: 600, minWidth: 56,
        fontFamily: '"JetBrains Mono", ui-monospace, monospace',
        textAlign: 'right',
      }}>
        {change == null ? '' : `${change >= 0 ? '+' : ''}${change.toFixed(2)}%`}
      </span>
      {showRemove && (
        <button
          onClick={onRemove}
          title={`Remove ${symbol}`}
          style={{
            background: 'transparent', border: 'none', cursor: 'pointer',
            color: 'rgba(255,255,255,0.5)', fontSize: 13, padding: '0 2px', lineHeight: 1,
          }}
        >×</button>
      )}
    </div>
  );
}

function formatPrice(p: number, currency: string | null | undefined): string {
  // Use 2 decimals for normal stocks, 4 for sub-dollar (penny stocks, FX, BTC fractional).
  const d = Math.abs(p) < 1 ? 4 : 2;
  const num = p.toFixed(d);
  if (currency && currency !== 'USD') return `${num} ${currency}`;
  return `$${num}`;
}

import React, { useEffect, useState } from 'react';
import { HFTile } from './tiles';
import { appActions } from '../state/tauri';
import {
  type GithubFilter,
  type GithubPr,
  fetchAllPrs,
  getStoredToken,
  getStoredUser,
  setStoredToken,
  setStoredUser,
} from '../state/github';
import type { Density } from '../types';

const REFRESH_MS = 5 * 60 * 1000;

const BUCKET_LABELS: Record<GithubFilter, string> = {
  assigned: 'Assigned to me',
  'review-requested': 'Review requested',
  authored: 'Authored by me',
};

const BUCKET_ORDER: GithubFilter[] = ['review-requested', 'assigned', 'authored'];

export interface GithubPrsTileProps {
  density: Density;
  accent: string;
  editing: boolean;
}

export function GithubPrsTile({ density, accent, editing }: GithubPrsTileProps) {
  const [token, setToken] = useState<string>(getStoredToken);
  const [user, setUser] = useState<string>(getStoredUser);
  const [prs, setPrs] = useState<GithubPr[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const configured = !!token && !!user;

  useEffect(() => {
    if (!configured) { setPrs([]); return; }
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const next = await fetchAllPrs(token, user);
        if (cancelled) return;
        setPrs(next);
      } catch (err) {
        if (cancelled) return;
        setError(String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    const id = setInterval(load, REFRESH_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, [token, user, configured]);

  const headRight = (
    <span style={{
      fontSize: 10, color: 'rgba(255,255,255,0.45)',
      fontFamily: '"JetBrains Mono", ui-monospace, monospace',
    }}>
      {!configured ? 'not connected' : loading ? 'loading…' : `${prs.length} open`}
    </span>
  );

  return (
    <HFTile title="GitHub PRs" headRight={headRight} accent={accent} density={density} style={{ height: '100%' }}>
      <div style={{
        position: 'absolute', inset: 0, padding: 10,
        display: 'flex', flexDirection: 'column', gap: 6,
        overflow: 'hidden',
      }}>
        {!configured && (
          <ConnectPanel
            editing={editing}
            accent={accent}
            onSave={(t, u) => { setStoredToken(t); setStoredUser(u); setToken(t); setUser(u); }}
          />
        )}
        {configured && error && (
          <div style={{
            color: '#fca5a5', fontSize: 11, padding: 8,
            background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: 5,
          }}>
            {error}
          </div>
        )}
        {configured && !error && prs.length === 0 && !loading && (
          <div style={{ color: 'rgba(255,255,255,0.45)', fontSize: 11, padding: 8 }}>
            No open PRs.
          </div>
        )}
        {configured && prs.length > 0 && (
          <div style={{
            flex: 1, minHeight: 0, overflowY: 'auto',
            display: 'flex', flexDirection: 'column', gap: 8,
          }}>
            {BUCKET_ORDER.map((bucket) => {
              const items = prs.filter((p) => p.bucket === bucket);
              if (items.length === 0) return null;
              return (
                <div key={bucket}>
                  <div style={{
                    fontSize: 9, fontWeight: 700, color: 'rgba(255,255,255,0.5)',
                    textTransform: 'uppercase', letterSpacing: '.06em', padding: '2px 6px',
                    fontFamily: '"JetBrains Mono", ui-monospace, monospace',
                  }}>{BUCKET_LABELS[bucket]} · {items.length}</div>
                  {items.map((pr) => <PrRow key={pr.id} pr={pr} accent={accent} />)}
                </div>
              );
            })}
          </div>
        )}
        {configured && editing && (
          <button
            onClick={() => { setStoredToken(''); setStoredUser(''); setToken(''); setUser(''); }}
            style={{
              padding: '4px 10px', fontSize: 10, fontWeight: 600, borderRadius: 4,
              background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.7)',
              border: '1px solid rgba(255,255,255,0.08)', cursor: 'pointer',
              alignSelf: 'flex-start', flexShrink: 0,
            }}
          >disconnect</button>
        )}
      </div>
    </HFTile>
  );
}

function PrRow({ pr, accent }: { pr: GithubPr; accent: string }) {
  return (
    <div
      onClick={() => { void appActions.openUrl(pr.url); }}
      style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '5px 6px', fontSize: 11.5,
        cursor: 'pointer', borderRadius: 4,
        background: 'rgba(255,255,255,0.02)',
      }}
      title={`${pr.repo} #${pr.number} — ${pr.title}`}
    >
      <span style={{
        color: pr.draft ? 'rgba(255,255,255,0.4)' : accent,
        fontFamily: '"JetBrains Mono", ui-monospace, monospace',
        flexShrink: 0,
      }}>#{pr.number}</span>
      <span style={{
        flex: 1, color: pr.draft ? 'rgba(255,255,255,0.55)' : '#fff',
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>{pr.title}</span>
      <span style={{
        fontSize: 9.5, color: 'rgba(255,255,255,0.4)', flexShrink: 0,
        fontFamily: '"JetBrains Mono", ui-monospace, monospace',
      }}>{pr.repo}</span>
    </div>
  );
}

function ConnectPanel({
  editing, accent, onSave,
}: { editing: boolean; accent: string; onSave: (token: string, user: string) => void }) {
  const [tok, setTok] = useState('');
  const [user, setUser] = useState('');
  return (
    <div style={{
      flex: 1, minHeight: 0, padding: 10,
      display: 'flex', flexDirection: 'column', gap: 8, justifyContent: 'center',
    }}>
      <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.7)', lineHeight: 1.5 }}>
        Connect to GitHub with a personal access token (classic, scope <span style={{ fontFamily: 'monospace', color: accent }}>repo</span>) and your username.
      </div>
      {editing ? (
        <>
          <input
            type="password"
            value={tok}
            onChange={(e) => setTok(e.target.value)}
            placeholder="ghp_..."
            style={inputStyle}
          />
          <input
            value={user}
            onChange={(e) => setUser(e.target.value)}
            placeholder="GitHub username"
            style={inputStyle}
          />
          <button
            onClick={() => { if (tok.trim() && user.trim()) onSave(tok.trim(), user.trim()); }}
            disabled={!tok.trim() || !user.trim()}
            style={{
              padding: '7px 12px', fontSize: 11, fontWeight: 700,
              background: tok.trim() && user.trim() ? accent : 'rgba(255,255,255,0.06)',
              color: tok.trim() && user.trim() ? '#000' : 'rgba(255,255,255,0.4)',
              border: 'none', borderRadius: 5,
              cursor: tok.trim() && user.trim() ? 'pointer' : 'not-allowed',
            }}
          >Connect</button>
        </>
      ) : (
        <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.45)' }}>
          Enter edit mode to configure.
        </div>
      )}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  fontSize: 11, padding: '6px 10px', borderRadius: 4,
  background: 'rgba(255,255,255,0.04)', color: '#fff',
  border: '1px solid rgba(255,255,255,0.1)',
  fontFamily: '"JetBrains Mono", ui-monospace, monospace', outline: 'none',
};

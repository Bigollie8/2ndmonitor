import React, { useState } from 'react';
import { HFTile } from './tiles';
import { appActions } from '../state/tauri';
import {
  type GithubFilter,
  type GithubPr,
  fetchAllPrs,
  getStoredUser,
  setStoredUser,
} from '../state/github';
import { useSecret } from '../state/secrets';
import { usePoll } from '../state/usePoll';
import { TileEmpty, TileError, TileNeedsSetup, TileSkeleton } from './tileStates';
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
  const { value: token, loaded, save: saveToken, clear: clearToken } =
    useSecret('github_pat', { legacyLocalStorageKey: '2mh.github.pat' });
  const [user, setUser] = useState<string>(getStoredUser);
  const [setupOpen, setSetupOpen] = useState(false);

  const configured = !!token && !!user;

  const { data, error, loading, refresh } = usePoll<GithubPr[]>(
    async () => {
      if (!token || !user) return [];
      return fetchAllPrs(token, user);
    },
    REFRESH_MS,
    [token, user, configured],
  );
  const prs = configured ? (data ?? []) : [];

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
        {loaded && !configured && !(editing || setupOpen) && (
          <TileNeedsSetup
            accent={accent}
            line={
              <>
                Connect to GitHub with a personal access token (classic, scope <span style={{ fontFamily: 'monospace', color: accent }}>repo</span>) and your username.
              </>
            }
            onSetup={() => setSetupOpen(true)}
          />
        )}
        {loaded && !configured && (editing || setupOpen) && (
          <ConnectPanel
            accent={accent}
            onSave={(t, u) => { void saveToken(t); setStoredUser(u); setUser(u); }}
          />
        )}
        {configured && error && <TileError line={error} onRetry={refresh} />}
        {configured && !error && loading && prs.length === 0 && <TileSkeleton rows={4} />}
        {configured && !error && prs.length === 0 && !loading && (
          <TileEmpty icon="⊕" line="No open PRs." />
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
            onClick={() => { void clearToken(); setStoredUser(''); setUser(''); }}
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
  accent, onSave,
}: { accent: string; onSave: (token: string, user: string) => void }) {
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
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  fontSize: 11, padding: '6px 10px', borderRadius: 4,
  background: 'rgba(255,255,255,0.04)', color: '#fff',
  border: '1px solid rgba(255,255,255,0.1)',
  fontFamily: '"JetBrains Mono", ui-monospace, monospace', outline: 'none',
};

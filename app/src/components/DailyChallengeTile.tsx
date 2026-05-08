import React, { useEffect, useState } from 'react';
import { HFTile } from './tiles';
import { appActions } from '../state/tauri';
import { type DailyChallenge, fetchDailyChallenge } from '../state/dailyChallenge';
import type { Density } from '../types';

const REFRESH_MS = 6 * 60 * 60 * 1000;

const DIFFICULTY_COLOR: Record<DailyChallenge['difficulty'], string> = {
  Easy: '#22c55e',
  Medium: '#facc15',
  Hard: '#ef4444',
};

export function DailyChallengeTile({ density, accent }: { density: Density; accent: string }) {
  const [challenge, setChallenge] = useState<DailyChallenge | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const c = await fetchDailyChallenge();
      if (!cancelled && c) setChallenge(c);
    };
    void load();
    const id = setInterval(load, REFRESH_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  const headRight = (
    <span style={{
      fontSize: 10, color: 'rgba(255,255,255,0.45)',
      fontFamily: '"JetBrains Mono", ui-monospace, monospace',
    }}>LeetCode</span>
  );

  return (
    <HFTile title="Daily challenge" headRight={headRight} accent={accent} density={density} style={{ height: '100%' }}>
      <div
        onClick={() => { if (challenge?.url) void appActions.openUrl(challenge.url); }}
        style={{
          position: 'absolute', inset: 0, padding: 12,
          display: 'flex', flexDirection: 'column', gap: 8,
          overflow: 'hidden',
          cursor: challenge?.url ? 'pointer' : 'default',
        }}
      >
        {!challenge && (
          <div style={{ color: 'rgba(255,255,255,0.45)', fontSize: 11, fontStyle: 'italic' }}>
            Loading…
          </div>
        )}
        {challenge && (
          <>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
              <span style={{
                fontSize: 11, color: 'rgba(255,255,255,0.5)',
                fontFamily: '"JetBrains Mono", ui-monospace, monospace',
              }}>#{challenge.questionId}</span>
              <span style={{
                fontSize: 14, fontWeight: 700, color: '#fff', flex: 1,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>{challenge.title}</span>
              <span style={{
                fontSize: 9, color: DIFFICULTY_COLOR[challenge.difficulty],
                padding: '1px 6px', borderRadius: 3,
                background: `${DIFFICULTY_COLOR[challenge.difficulty]}15`,
                border: `1px solid ${DIFFICULTY_COLOR[challenge.difficulty]}55`,
                fontFamily: '"JetBrains Mono", ui-monospace, monospace',
              }}>{challenge.difficulty}</span>
            </div>
            <div style={{
              fontSize: 11, color: 'rgba(255,255,255,0.7)', lineHeight: 1.5,
              overflow: 'hidden',
              display: '-webkit-box', WebkitLineClamp: 4 as any, WebkitBoxOrient: 'vertical' as any,
            }}>{challenge.preview}</div>
            <div style={{
              display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 'auto',
            }}>
              {challenge.topics.slice(0, 4).map((t) => (
                <span key={t} style={{
                  fontSize: 9, color: 'rgba(255,255,255,0.55)',
                  padding: '1px 5px', borderRadius: 3,
                  background: 'rgba(255,255,255,0.04)',
                  border: '1px solid rgba(255,255,255,0.08)',
                  fontFamily: '"JetBrains Mono", ui-monospace, monospace',
                }}>{t}</span>
              ))}
              <span style={{
                fontSize: 9, color: 'rgba(255,255,255,0.45)',
                fontFamily: '"JetBrains Mono", ui-monospace, monospace',
                marginLeft: 'auto',
              }}>{challenge.acRate.toFixed(1)}% accept</span>
            </div>
          </>
        )}
      </div>
    </HFTile>
  );
}

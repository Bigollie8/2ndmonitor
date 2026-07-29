import React from 'react';
import { HFTile } from './tiles';
import { type DockerContainer, fetchDockerContainers } from '../state/docker';
import { usePoll } from '../state/usePoll';
import type { Density } from '../types';

const REFRESH_MS = 30 * 1000;

export function DockerTile({ density, accent }: { density: Density; accent: string }) {
  const { data: result } = usePoll(
    async () => {
      // fetchDockerContainers returns null outside Tauri / on invoke failure;
      // usePoll drives backoff off thrown errors, so promote the null to a
      // throw. A daemon-side problem still arrives as result.error and renders
      // through the normal "unavailable" path below.
      const r = await fetchDockerContainers();
      if (r == null) throw new Error('fetch failed');
      return r;
    },
    REFRESH_MS,
    [],
  );

  const running = result?.containers.filter((c) => c.state === 'running').length ?? 0;
  const total = result?.containers.length ?? 0;

  const headRight = (
    <span style={{
      fontSize: 10, color: 'rgba(255,255,255,0.55)',
      fontFamily: '"JetBrains Mono", ui-monospace, monospace',
    }}>{result?.error ? 'unavailable' : `${running}/${total}`}</span>
  );

  return (
    <HFTile title="Docker" headRight={headRight} accent={accent} density={density} style={{ height: '100%' }}>
      <div style={{
        position: 'absolute', inset: 0, padding: 10,
        display: 'flex', flexDirection: 'column', gap: 4,
        overflow: 'hidden',
      }}>
        {result?.error && (
          <div style={{
            color: 'rgba(255,255,255,0.55)', fontSize: 11, padding: 8,
            background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)',
            borderRadius: 5, lineHeight: 1.5,
          }}>
            {result.error}
            <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', marginTop: 4 }}>
              Start Docker Desktop or expose `docker` in PATH.
            </div>
          </div>
        )}
        {!result && (
          <div style={{ color: 'rgba(255,255,255,0.45)', fontSize: 11, padding: 4 }}>Loading…</div>
        )}
        {result && !result.error && result.containers.length === 0 && (
          <div style={{ color: 'rgba(255,255,255,0.45)', fontSize: 11, padding: 4 }}>
            No containers.
          </div>
        )}
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 2 }}>
          {result?.containers.map((c) => <ContainerRow key={c.id} c={c} accent={accent} />)}
        </div>
      </div>
    </HFTile>
  );
}

function ContainerRow({ c, accent }: { c: DockerContainer; accent: string }) {
  const isRunning = c.state === 'running';
  const stateColor = isRunning ? '#22c55e'
    : c.state === 'exited' ? 'rgba(255,255,255,0.45)'
    : c.state === 'paused' ? '#facc15' : '#ef4444';
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8,
      padding: '5px 6px', fontSize: 11,
      background: 'rgba(255,255,255,0.02)',
      border: '1px solid rgba(255,255,255,0.06)',
      borderRadius: 4,
    }}>
      <span style={{
        width: 7, height: 7, borderRadius: 999, background: stateColor,
        boxShadow: isRunning ? `0 0 6px ${stateColor}` : 'none',
        flexShrink: 0,
      }} />
      <span style={{
        flex: 1, color: '#fff', fontWeight: 600,
        fontFamily: '"JetBrains Mono", ui-monospace, monospace',
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }} title={c.names}>{c.names}</span>
      <span style={{
        fontSize: 9.5, color: 'rgba(255,255,255,0.45)',
        fontFamily: '"JetBrains Mono", ui-monospace, monospace',
        flexShrink: 0, maxWidth: 120,
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }} title={c.image}>{c.image}</span>
      <span style={{
        fontSize: 9.5, color: stateColor,
        fontFamily: '"JetBrains Mono", ui-monospace, monospace',
        flexShrink: 0,
      }}>{c.state}</span>
    </div>
  );
}

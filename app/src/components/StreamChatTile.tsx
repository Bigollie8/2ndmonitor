import React, { useEffect, useMemo, useRef, useState } from 'react';
import { HFTile } from './tiles';
import {
  type ChatMessage,
  type ChatStatus,
  connectTwitchChat,
  parseTwitchChatConfig,
} from '../state/twitchChat';
import type { Density } from '../types';

const MAX_MESSAGES = 200;

export interface StreamChatTileProps {
  instanceId: string;
  density: Density;
  accent: string;
  editing: boolean;
  config: Record<string, unknown> | undefined;
  setConfig: (next: Record<string, unknown>) => void;
}

export function StreamChatTile({ density, accent, editing, config, setConfig }: StreamChatTileProps) {
  const parsed = useMemo(() => parseTwitchChatConfig(config), [config]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [status, setStatus] = useState<ChatStatus>({ kind: 'disconnected' });
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const stuckToBottomRef = useRef<boolean>(true);

  useEffect(() => {
    setMessages([]);
    if (!parsed.channel) {
      setStatus({ kind: 'disconnected' });
      return;
    }
    const cleanup = connectTwitchChat(parsed.channel, {
      onMessage: (msg) => {
        setMessages((prev) => {
          const next = [...prev, msg];
          if (next.length > MAX_MESSAGES) next.splice(0, next.length - MAX_MESSAGES);
          return next;
        });
      },
      onStatus: setStatus,
    });
    return cleanup;
  }, [parsed.channel]);

  // Track whether the user has scrolled up; pin to bottom only if they were
  // already near the bottom (so manual scrollback isn't yanked back down).
  const onScroll = () => {
    const el = scrollerRef.current;
    if (!el) return;
    const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
    stuckToBottomRef.current = dist < 40;
  };

  useEffect(() => {
    if (!stuckToBottomRef.current) return;
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages]);

  const headRight = (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
      <span style={{
        fontSize: 10, color: 'rgba(255,255,255,0.55)',
        fontFamily: '"JetBrains Mono", ui-monospace, monospace',
      }}>
        {parsed.channel ? `#${parsed.channel}` : 'no channel'}
      </span>
      <StatusDot status={status} />
    </div>
  );

  return (
    <HFTile title="Stream chat" headRight={headRight} accent={accent} density={density} style={{ height: '100%' }}>
      <div style={{
        position: 'absolute', inset: 0, padding: 0,
        display: 'flex', flexDirection: 'column',
        overflow: 'hidden',
      }}>
        {!parsed.channel && (
          <ConfigPanel editing={editing} accent={accent} initial={parsed.channel}
            onSave={(channel) => setConfig({ channel } as unknown as Record<string, unknown>)} />
        )}
        {parsed.channel && (
          <div
            ref={scrollerRef}
            onScroll={onScroll}
            style={{
              flex: 1, minHeight: 0, overflowY: 'auto',
              padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 3,
              fontSize: 11.5, lineHeight: 1.4,
            }}
          >
            {messages.length === 0 && (
              <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: 10, padding: 4 }}>
                {status.kind === 'connecting' ? 'connecting…'
                  : status.kind === 'connected' ? 'waiting for chatter…'
                  : 'disconnected.'}
              </div>
            )}
            {messages.map((m) => (
              <div key={m.id} style={{ overflowWrap: 'break-word' }}>
                <span style={{ color: m.color ?? '#fff', fontWeight: 700, marginRight: 6 }}>
                  {m.displayName}:
                </span>
                <span style={{ color: 'rgba(255,255,255,0.85)' }}>{m.text}</span>
              </div>
            ))}
          </div>
        )}
        {parsed.channel && editing && (
          <div style={{
            padding: 8, borderTop: '1px solid rgba(255,255,255,0.06)', flexShrink: 0,
          }}>
            <button
              onClick={() => setConfig({ channel: '' } as unknown as Record<string, unknown>)}
              style={{
                padding: '4px 10px', fontSize: 10, fontWeight: 600, borderRadius: 4,
                background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.7)',
                border: '1px solid rgba(255,255,255,0.08)', cursor: 'pointer',
              }}
            >change channel</button>
          </div>
        )}
      </div>
    </HFTile>
  );
}

function StatusDot({ status }: { status: ChatStatus }) {
  const color = status.kind === 'connected' ? '#22c55e'
    : status.kind === 'connecting' ? '#facc15' : 'rgba(255,255,255,0.3)';
  return <span style={{
    width: 7, height: 7, borderRadius: 999, background: color,
    boxShadow: status.kind === 'connected' ? `0 0 6px ${color}` : 'none',
  }} />;
}

function ConfigPanel({
  editing, accent, initial, onSave,
}: { editing: boolean; accent: string; initial: string; onSave: (channel: string) => void }) {
  const [draft, setDraft] = useState<string>(initial);
  return (
    <div style={{
      flex: 1, padding: 10,
      display: 'flex', flexDirection: 'column', gap: 8, justifyContent: 'center',
    }}>
      <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.7)', lineHeight: 1.5 }}>
        Connect to a Twitch channel to mirror chat. Read-only — no auth required.
      </div>
      {editing ? (
        <>
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && draft.trim()) onSave(draft.trim()); }}
            placeholder="channel name (e.g. shroud)"
            maxLength={32}
            style={inputStyle}
          />
          <button
            onClick={() => { if (draft.trim()) onSave(draft.trim()); }}
            disabled={!draft.trim()}
            style={{
              padding: '7px 12px', fontSize: 11, fontWeight: 700,
              background: draft.trim() ? accent : 'rgba(255,255,255,0.06)',
              color: draft.trim() ? '#000' : 'rgba(255,255,255,0.4)',
              border: 'none', borderRadius: 5,
              cursor: draft.trim() ? 'pointer' : 'not-allowed',
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

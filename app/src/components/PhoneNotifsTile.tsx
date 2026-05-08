import React, { useEffect, useRef, useState } from 'react';
import { HFTile } from './tiles';
import { appActions } from '../state/tauri';
import {
  type NtfyNotification,
  type NtfyStatus,
  getStoredServer,
  getStoredTopic,
  setStoredServer,
  setStoredTopic,
  subscribeNtfy,
} from '../state/ntfy';
import type { Density } from '../types';

const MAX_NOTIFICATIONS = 50;

export interface PhoneNotifsTileProps {
  density: Density;
  accent: string;
  editing: boolean;
}

export function PhoneNotifsTile({ density, accent, editing }: PhoneNotifsTileProps) {
  const [topic, setTopic] = useState<string>(getStoredTopic);
  const [server, setServer] = useState<string>(getStoredServer);
  const [notifs, setNotifs] = useState<NtfyNotification[]>([]);
  const [status, setStatus] = useState<NtfyStatus>({ kind: 'disconnected' });
  const seenIdsRef = useRef<Set<string>>(new Set());

  const configured = !!topic;

  useEffect(() => {
    if (!configured) { setNotifs([]); setStatus({ kind: 'disconnected' }); return; }
    seenIdsRef.current = new Set();
    const cleanup = subscribeNtfy(server, topic, {
      onNotification: (n) => {
        if (seenIdsRef.current.has(n.id)) return;
        seenIdsRef.current.add(n.id);
        setNotifs((prev) => {
          const next = [n, ...prev];
          if (next.length > MAX_NOTIFICATIONS) next.length = MAX_NOTIFICATIONS;
          return next;
        });
      },
      onStatus: setStatus,
    });
    return cleanup;
  }, [topic, server, configured]);

  const headRight = (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
      <span style={{
        fontSize: 10, color: 'rgba(255,255,255,0.55)',
        fontFamily: '"JetBrains Mono", ui-monospace, monospace',
      }}>{configured ? topic : 'no topic'}</span>
      <StatusDot status={status} />
    </div>
  );

  return (
    <HFTile title="Phone notifs" headRight={headRight} accent={accent} density={density} style={{ height: '100%' }}>
      <div style={{
        position: 'absolute', inset: 0, padding: 0,
        display: 'flex', flexDirection: 'column',
        overflow: 'hidden',
      }}>
        {!configured && (
          <ConfigPanel
            editing={editing}
            accent={accent}
            initialServer={server}
            onSave={(t, s) => {
              setStoredTopic(t); setStoredServer(s); setTopic(t); setServer(s);
            }}
          />
        )}
        {configured && notifs.length === 0 && (
          <div style={{
            flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: 'rgba(255,255,255,0.45)', fontSize: 11, padding: 12, textAlign: 'center',
          }}>
            {status.kind === 'connecting' ? 'connecting…'
              : status.kind === 'connected' ? `Listening on ${topic}.\nPublish from your phone to see notifications here.`
              : 'disconnected.'}
          </div>
        )}
        {configured && notifs.length > 0 && (
          <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '4px 6px' }}>
            {notifs.map((n) => <NotifRow key={n.id} notif={n} accent={accent} />)}
          </div>
        )}
        {configured && editing && (
          <div style={{ padding: 8, borderTop: '1px solid rgba(255,255,255,0.06)', flexShrink: 0 }}>
            <button
              onClick={() => { setStoredTopic(''); setTopic(''); setNotifs([]); }}
              style={{
                padding: '4px 10px', fontSize: 10, fontWeight: 600, borderRadius: 4,
                background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.7)',
                border: '1px solid rgba(255,255,255,0.08)', cursor: 'pointer',
              }}
            >change topic</button>
          </div>
        )}
      </div>
    </HFTile>
  );
}

function NotifRow({ notif, accent }: { notif: NtfyNotification; accent: string }) {
  const date = new Date(notif.time * 1000);
  const time = date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const handleClick = () => {
    if (notif.click) void appActions.openUrl(notif.click);
  };
  return (
    <div
      onClick={notif.click ? handleClick : undefined}
      style={{
        padding: '6px 8px', borderRadius: 5, marginBottom: 3,
        background: 'rgba(255,255,255,0.03)',
        border: '1px solid rgba(255,255,255,0.05)',
        cursor: notif.click ? 'pointer' : 'default',
      }}
    >
      <div style={{
        display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 2,
      }}>
        {notif.title && (
          <span style={{ fontSize: 11.5, fontWeight: 700, color: '#fff', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {notif.title}
          </span>
        )}
        <span style={{
          fontSize: 9.5, color: 'rgba(255,255,255,0.4)', flexShrink: 0,
          fontFamily: '"JetBrains Mono", ui-monospace, monospace',
        }}>{time}</span>
      </div>
      <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.85)', lineHeight: 1.4, overflowWrap: 'break-word' }}>
        {notif.message}
      </div>
      {notif.tags.length > 0 && (
        <div style={{ marginTop: 3, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {notif.tags.slice(0, 4).map((t) => (
            <span key={t} style={{
              fontSize: 9, color: accent,
              padding: '1px 5px', borderRadius: 3,
              background: `${accent}15`, border: `1px solid ${accent}33`,
              fontFamily: '"JetBrains Mono", ui-monospace, monospace',
            }}>{t}</span>
          ))}
        </div>
      )}
    </div>
  );
}

function StatusDot({ status }: { status: NtfyStatus }) {
  const color = status.kind === 'connected' ? '#22c55e'
    : status.kind === 'connecting' ? '#facc15' : 'rgba(255,255,255,0.3)';
  return <span style={{
    width: 7, height: 7, borderRadius: 999, background: color,
    boxShadow: status.kind === 'connected' ? `0 0 6px ${color}` : 'none',
  }} />;
}

function ConfigPanel({
  editing, accent, initialServer, onSave,
}: { editing: boolean; accent: string; initialServer: string; onSave: (topic: string, server: string) => void }) {
  const [topic, setTopic] = useState('');
  const [server, setServer] = useState(initialServer);
  return (
    <div style={{
      flex: 1, padding: 10,
      display: 'flex', flexDirection: 'column', gap: 8, justifyContent: 'center',
    }}>
      <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.7)', lineHeight: 1.5 }}>
        Pick a long random topic name and subscribe to it from the{' '}
        <span style={{ color: accent, fontFamily: 'monospace' }}>ntfy</span> app on your phone. Same topic on both sides.
      </div>
      {editing ? (
        <>
          <input
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder="topic name (e.g. xj91k_phone)"
            maxLength={64}
            style={inputStyle}
          />
          <input
            value={server}
            onChange={(e) => setServer(e.target.value)}
            placeholder="server (default: https://ntfy.sh)"
            style={inputStyle}
          />
          <button
            onClick={() => { if (topic.trim()) onSave(topic.trim(), server.trim() || 'https://ntfy.sh'); }}
            disabled={!topic.trim()}
            style={{
              padding: '7px 12px', fontSize: 11, fontWeight: 700,
              background: topic.trim() ? accent : 'rgba(255,255,255,0.06)',
              color: topic.trim() ? '#000' : 'rgba(255,255,255,0.4)',
              border: 'none', borderRadius: 5,
              cursor: topic.trim() ? 'pointer' : 'not-allowed',
            }}
          >Subscribe</button>
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

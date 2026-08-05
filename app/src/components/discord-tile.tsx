import { useEffect, useState } from 'react';
import { checkDiscordClientId } from '../state/discordId';
import { HFTile } from './tiles';
import type { Density } from '../types';
import {
  type DiscordGuild, type DiscordUser, type RpcNotification, type VoiceState,
  discordVoice, useDiscord, useDiscordRpc,
} from '../state/tauri';

const CDN = 'https://cdn.discordapp.com';

function userAvatarUrl(user: DiscordUser): string {
  if (user.avatar) {
    return `${CDN}/avatars/${user.id}/${user.avatar}.png?size=128`;
  }
  // Default avatars: legacy uses discriminator%5; new-style uses (id>>22)%6.
  if (user.discriminator && user.discriminator !== '0') {
    const idx = (parseInt(user.discriminator, 10) || 0) % 5;
    return `${CDN}/embed/avatars/${idx}.png`;
  }
  // BigInt path for the new (id>>22)%6 default.
  try {
    const idx = Number((BigInt(user.id) >> 22n) % 6n);
    return `${CDN}/embed/avatars/${idx}.png`;
  } catch {
    return `${CDN}/embed/avatars/0.png`;
  }
}

function guildIconUrl(guild: DiscordGuild): string | null {
  if (!guild.icon) return null;
  // Animated icons start with "a_". Use a still PNG either way.
  return `${CDN}/icons/${guild.id}/${guild.icon}.png?size=96`;
}

function guildInitials(name: string): string {
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
}

export function DiscordTile({ density, accent }: { density: Density; accent: string }) {
  const { state, connect, disconnect, getStoredClientId } = useDiscord();
  const [storedClientId, setStoredClientId] = useState<string | null>(null);

  useEffect(() => {
    getStoredClientId().then(setStoredClientId);
  }, [state.connected]);

  // One-click "sign out + sign back in with new scopes" used by the RPC banner.
  const reauthorize = async () => {
    if (!storedClientId) return;
    await disconnect();
    await connect(storedClientId);
  };

  return (
    <HFTile
      title="Discord"
      density={density}
      badge={
        state.connected ? (
          <span style={{
            fontSize: 9, color: '#22c55e', padding: '2px 6px', borderRadius: 4,
            background: 'rgba(34,197,94,0.12)', border: '1px solid rgba(34,197,94,0.3)',
            letterSpacing: '.05em',
          }}>● CONNECTED</span>
        ) : state.connecting ? (
          <span style={{
            fontSize: 9, color: '#fbbf24', padding: '2px 6px', borderRadius: 4,
            background: 'rgba(251,191,36,0.12)', border: '1px solid rgba(251,191,36,0.3)',
            letterSpacing: '.05em',
          }}>● AUTHORIZING</span>
        ) : (
          <span style={{
            fontSize: 9, color: 'rgba(255,255,255,0.5)', padding: '2px 6px', borderRadius: 4,
            background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
            letterSpacing: '.05em',
          }}>NOT CONNECTED</span>
        )
      }
      headRight={
        state.connected && state.user ? (
          <button
            onClick={() => disconnect()}
            style={{
              fontSize: 10, color: 'rgba(255,255,255,0.4)',
              background: 'transparent', border: 'none', cursor: 'pointer',
              fontFamily: '"JetBrains Mono", ui-monospace, monospace',
            }}
          >sign out</button>
        ) : undefined
      }
      style={{ height: '100%' }}
    >
      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        {state.connected && state.user ? (
          <ConnectedView
            user={state.user}
            guilds={state.guilds}
            accent={accent}
            hasData={state.has_data}
            onReconnect={reauthorize}
            clientId={storedClientId}
          />
        ) : (
          <ConnectView
            connecting={state.connecting}
            error={state.error}
            accent={accent}
            connect={connect}
            getStoredClientId={getStoredClientId}
          />
        )}
      </div>
    </HFTile>
  );
}

function ConnectedView({ user, guilds, accent, hasData, onReconnect, clientId }: {
  user: DiscordUser;
  guilds: DiscordGuild[];
  accent: string;
  hasData: boolean;
  onReconnect: () => Promise<void>;
  clientId: string | null;
}) {
  const rpc = useDiscordRpc();
  const inVoice = !!rpc.voice.channel_id;
  const displayName = user.global_name || user.username;
  const rpcNeedsReauth = rpc.error?.toLowerCase().includes('missing rpc scopes')
    || rpc.error?.toLowerCase().includes('scope');
  return (
    <>
      {/* User header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12,
        padding: 14, borderBottom: '1px solid rgba(255,255,255,0.06)',
        flexShrink: 0,
      }}>
        <img
          src={userAvatarUrl(user)}
          alt=""
          style={{
            width: 44, height: 44, borderRadius: 999,
            boxShadow: `0 0 0 2px ${accent}55, 0 4px 12px rgba(0,0,0,0.4)`,
          }}
        />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{displayName}</div>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', fontFamily: '"JetBrains Mono", ui-monospace, monospace' }}>@{user.username}</div>
        </div>
        <RpcStatusDot connected={rpc.connected} error={rpc.error} />
      </div>

      {/* RPC banner — visible when connected via OAuth but RPC isn't live yet */}
      {!rpc.connected && (
        <div style={{
          padding: '10px 14px',
          borderBottom: '1px solid rgba(255,255,255,0.05)',
          background: rpcNeedsReauth ? 'rgba(251,113,133,0.08)' : 'rgba(255,255,255,0.02)',
          display: 'flex', alignItems: 'center', gap: 10,
          flexShrink: 0,
        }}>
          <span style={{
            fontSize: 9, color: rpcNeedsReauth ? '#fb7185' : 'rgba(251,191,36,0.9)',
            textTransform: 'uppercase', letterSpacing: '.08em', fontWeight: 700,
            padding: '2px 6px', borderRadius: 3,
            background: rpcNeedsReauth ? 'rgba(251,113,133,0.12)' : 'rgba(251,191,36,0.12)',
            border: `1px solid ${rpcNeedsReauth ? 'rgba(251,113,133,0.35)' : 'rgba(251,191,36,0.35)'}`,
          }}>
            {rpcNeedsReauth ? '⚠ NEEDS REAUTH' : '◌ RPC IDLE'}
          </span>
          <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.7)', flex: 1, lineHeight: 1.4 }}>
            {rpcNeedsReauth
              ? 'Voice + DM notifications need extra scopes. Sign out and reconnect to grant them.'
              : (rpc.error || 'Waiting for Discord desktop client (must be running for RPC).')}
          </span>
          {rpcNeedsReauth && clientId && (
            <button
              onClick={() => onReconnect()}
              style={{
                padding: '6px 10px', fontSize: 11, fontWeight: 700,
                background: accent, color: '#000', border: 'none', borderRadius: 5,
                cursor: 'pointer', flexShrink: 0,
              }}
            >Reconnect</button>
          )}
        </div>
      )}

      {/* Voice channel section — only when in a call */}
      {inVoice && <VoiceSection voice={rpc.voice} accent={accent} selfUserId={rpc.self_user_id} />}

      {/* Notifications feed */}
      {rpc.notifications.length > 0 && (
        <NotificationsSection notifications={rpc.notifications} accent={accent} />
      )}

      {/* Servers — push to bottom, condensed if other sections are present */}
      <div style={{
        flex: 1, minHeight: 0, overflow: 'auto', padding: 10,
        borderTop: (inVoice || rpc.notifications.length > 0) ? '1px solid rgba(255,255,255,0.06)' : 'none',
      }}>
        {!hasData ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'rgba(255,255,255,0.4)', fontSize: 11 }}>
            Loading servers…
          </div>
        ) : guilds.length === 0 ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'rgba(255,255,255,0.4)', fontSize: 11 }}>
            No servers visible.
          </div>
        ) : (
          <>
            <div style={{
              fontSize: 9, color: 'rgba(255,255,255,0.4)',
              textTransform: 'uppercase', letterSpacing: '.08em',
              marginBottom: 8, fontWeight: 600,
              display: 'flex', justifyContent: 'space-between',
            }}>
              <span>Servers</span><span>{guilds.length}</span>
            </div>
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(56px, 1fr))',
              gap: 6,
            }}>
              {guilds.map((g) => <GuildIcon key={g.id} guild={g} accent={accent} />)}
            </div>
          </>
        )}
      </div>
    </>
  );
}

function RpcStatusDot({ connected, error }: { connected: boolean; error: string | null }) {
  const color = connected ? '#22c55e' : (error ? 'rgba(251,113,133,0.8)' : 'rgba(255,255,255,0.25)');
  const title = connected
    ? 'RPC connected — voice + notifications live'
    : error
      ? `RPC: ${error}`
      : 'RPC waiting (Discord desktop must be running)';
  return (
    <div title={title} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
      <span style={{
        width: 8, height: 8, borderRadius: 999, background: color,
        boxShadow: connected ? `0 0 8px ${color}` : 'none',
      }} />
      <span style={{
        fontSize: 8, color: 'rgba(255,255,255,0.4)', letterSpacing: '.1em',
        fontFamily: '"JetBrains Mono", ui-monospace, monospace',
      }}>RPC</span>
    </div>
  );
}

function VoiceSection({ voice, accent, selfUserId }: { voice: VoiceState; accent: string; selfUserId: string | null }) {
  const self = selfUserId ? voice.members.find((m) => m.user_id === selfUserId) : undefined;
  const muted = self?.muted ?? false;
  const deafened = self?.deafened ?? false;

  const [voiceError, setVoiceError] = useState<string | null>(null);
  useEffect(() => {
    if (!voiceError) return;
    const id = setTimeout(() => setVoiceError(null), 5000);
    return () => clearTimeout(id);
  }, [voiceError]);

  const onMute = async () => {
    setVoiceError(null);
    try { await discordVoice.setMute(!muted); }
    catch (e: any) { setVoiceError(`Mute: ${e?.message ?? e}`); }
  };
  const onDeaf = async () => {
    setVoiceError(null);
    try { await discordVoice.setDeaf(!deafened); }
    catch (e: any) { setVoiceError(`Deafen: ${e?.message ?? e}`); }
  };
  const onLeave = async () => {
    setVoiceError(null);
    try { await discordVoice.leave(); }
    catch (e: any) { setVoiceError(`Leave: ${e?.message ?? e}`); }
  };

  return (
    <div style={{
      padding: '10px 14px',
      background: `linear-gradient(180deg, ${accent}10, transparent 80%)`,
      borderBottom: '1px solid rgba(255,255,255,0.05)',
      flexShrink: 0,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <span style={{
          fontSize: 9, color: '#22c55e',
          textTransform: 'uppercase', letterSpacing: '.08em', fontWeight: 700,
          padding: '2px 6px', borderRadius: 3,
          background: 'rgba(34,197,94,0.12)', border: '1px solid rgba(34,197,94,0.3)',
        }}>● IN VOICE</span>
        <span style={{
          fontSize: 12, color: '#fff', fontWeight: 600,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>{voice.channel_name || '#unknown'}</span>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)' }}>
          {voice.members.length} {voice.members.length === 1 ? 'person' : 'people'}
        </span>
      </div>

      {voiceError && (
        <div
          onClick={() => setVoiceError(null)}
          title="Click to dismiss"
          style={{
            fontSize: 10.5, color: '#fca5a5',
            padding: '6px 8px', marginBottom: 8,
            background: 'rgba(239,68,68,0.08)',
            border: '1px solid rgba(239,68,68,0.25)',
            borderRadius: 4, cursor: 'pointer',
            fontFamily: '"JetBrains Mono", ui-monospace, monospace',
          }}
        >
          ⚠ {voiceError}
        </div>
      )}
      {/* Self controls — mute / deafen / leave */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
        <VoiceCtlButton
          icon={muted ? '🔇' : '🎙'}
          label={muted ? 'Unmute' : 'Mute'}
          active={muted}
          onClick={onMute}
        />
        <VoiceCtlButton
          icon={deafened ? '🔕' : '🎧'}
          label={deafened ? 'Undeafen' : 'Deafen'}
          active={deafened}
          onClick={onDeaf}
        />
        <VoiceCtlButton
          icon="✕"
          label="Leave"
          danger
          onClick={onLeave}
        />
      </div>

      {/* Every member, scrollable past ~3 rows — the old .slice(0, 8) simply
          hid the 9th person in a large call (0.8.6). */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', maxHeight: 96, overflowY: 'auto' }}>
        {voice.members.map((m) => (
          <VoiceMemberPill key={m.user_id} member={m} isSelf={m.user_id === selfUserId} />
        ))}
      </div>
    </div>
  );
}

function VoiceCtlButton({ icon, label, active, danger, onClick }: {
  icon: string;
  label: string;
  active?: boolean;
  danger?: boolean;
  onClick: () => void;
}) {
  const bg = danger
    ? 'rgba(239,68,68,0.12)'
    : (active ? 'rgba(251,113,133,0.18)' : 'rgba(255,255,255,0.04)');
  const border = danger
    ? 'rgba(239,68,68,0.35)'
    : (active ? 'rgba(251,113,133,0.5)' : 'rgba(255,255,255,0.08)');
  const color = danger ? '#fca5a5' : (active ? '#fda4af' : 'rgba(255,255,255,0.85)');
  return (
    <button
      onClick={onClick}
      title={label}
      style={{
        display: 'flex', alignItems: 'center', gap: 6,
        padding: '5px 10px', fontSize: 10.5, fontWeight: 600,
        background: bg, color, border: `1px solid ${border}`, borderRadius: 6,
        cursor: 'pointer', transition: 'background 0.15s, border-color 0.15s',
      }}
    >
      <span style={{ fontSize: 13, lineHeight: 1 }}>{icon}</span>
      <span>{label}</span>
    </button>
  );
}

function VoiceMemberPill({ member, isSelf }: { member: import('../state/tauri').VoiceMember; isSelf?: boolean }) {
  const name = (member.global_name || member.username) + (isSelf ? ' (you)' : '');
  const initial = (member.global_name || member.username).slice(0, 1).toUpperCase();
  const avatar = member.avatar
    ? `${CDN}/avatars/${member.user_id}/${member.avatar}.png?size=32`
    : null;
  return (
    <div title={name} style={{
      display: 'flex', alignItems: 'center', gap: 6,
      padding: '3px 8px 3px 3px', borderRadius: 999,
      background: member.speaking ? 'rgba(34,197,94,0.15)' : 'rgba(255,255,255,0.04)',
      border: member.speaking
        ? '1px solid rgba(34,197,94,0.5)'
        : (isSelf ? 'rgba(255,255,255,0.18)' : '1px solid rgba(255,255,255,0.06)'),
      transition: 'background 0.15s',
    }}>
      <div style={{
        width: 22, height: 22, borderRadius: 999, position: 'relative',
        background: avatar ? `center / cover no-repeat url(${avatar})` : 'rgba(255,255,255,0.08)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: 'rgba(255,255,255,0.7)', fontSize: 10, fontWeight: 700,
      }}>
        {!avatar && initial}
      </div>
      <span style={{
        fontSize: 11, color: '#fff', fontWeight: 500,
        maxWidth: 90, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>{name}</span>
      {member.muted && <span style={{ fontSize: 11, color: '#fb7185' }} title="muted">🔇</span>}
      {member.deafened && <span style={{ fontSize: 11, color: '#fb7185' }} title="deafened">🔕</span>}
    </div>
  );
}

function NotificationsSection({ notifications, accent }: { notifications: RpcNotification[]; accent: string }) {
  return (
    <div style={{
      padding: '8px 14px 4px',
      borderBottom: '1px solid rgba(255,255,255,0.05)',
      flexShrink: 0,
      maxHeight: 180,
      overflow: 'auto',
    }}>
      <div style={{
        fontSize: 9, color: 'rgba(255,255,255,0.45)',
        textTransform: 'uppercase', letterSpacing: '.08em',
        marginBottom: 6, fontWeight: 600,
        display: 'flex', justifyContent: 'space-between',
      }}>
        <span>Recent · DMs &amp; mentions</span>
        <span>{notifications.length}</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {/* All retained notifications (Rust keeps MAX_NOTIFICATIONS = 20).
            This container has been maxHeight+overflow:auto all along — the
            old .slice(0, 4) meant it never held enough rows to scroll, which
            read as "the tile can't scroll" (0.8.6). */}
        {notifications.map((n, i) => (
          <NotificationRow key={`${n.timestamp_ms}-${i}`} n={n} accent={accent} />
        ))}
      </div>
    </div>
  );
}

function NotificationRow({ n, accent }: { n: RpcNotification; accent: string }) {
  const ago = humanizeAgo(Date.now() - n.timestamp_ms);
  return (
    <div style={{
      display: 'flex', gap: 8, alignItems: 'flex-start',
      padding: '4px 6px', borderRadius: 5,
    }}>
      <div style={{
        width: 8, height: 8, borderRadius: 999, marginTop: 6,
        background: accent, boxShadow: `0 0 6px ${accent}`,
        flexShrink: 0,
      }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', gap: 6, alignItems: 'baseline' }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {n.title || n.author || 'Notification'}
          </span>
          <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.4)', fontFamily: '"JetBrains Mono", ui-monospace, monospace', flexShrink: 0 }}>{ago}</span>
        </div>
        <div style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.7)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {n.body}
        </div>
      </div>
    </div>
  );
}

function humanizeAgo(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

function GuildIcon({ guild, accent }: { guild: DiscordGuild; accent: string }) {
  const url = guildIconUrl(guild);
  return (
    <div title={guild.name} style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
      padding: 4, borderRadius: 8,
      transition: 'background 0.12s',
    }}
    onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.04)'; }}
    onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
    >
      {url ? (
        <img src={url} alt="" style={{
          width: 48, height: 48, borderRadius: 14,
          background: 'rgba(255,255,255,0.05)',
        }} />
      ) : (
        <div style={{
          width: 48, height: 48, borderRadius: 14,
          background: `linear-gradient(135deg, ${accent}66, ${accent}22)`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 14, fontWeight: 700, color: '#fff',
          fontFamily: '"JetBrains Mono", ui-monospace, monospace',
          letterSpacing: '0.04em',
        }}>{guildInitials(guild.name)}</div>
      )}
      <span style={{
        fontSize: 9, color: 'rgba(255,255,255,0.55)',
        maxWidth: 64, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        textAlign: 'center',
      }}>{guild.name}</span>
    </div>
  );
}

function ConnectView({ connecting, error, accent, connect, getStoredClientId }: {
  connecting: boolean;
  error: string | null;
  accent: string;
  connect: (id: string) => Promise<void>;
  getStoredClientId: () => Promise<string | null>;
}) {
  const [clientId, setClientId] = useState('');
  const [showHelp, setShowHelp] = useState(false);

  useEffect(() => {
    getStoredClientId().then((stored) => {
      if (stored) setClientId(stored);
    });
  }, []);

  // Validate BEFORE opening the browser (0.8.4). Discord answers a bad id with
  // a bare "unknown application" page that never says which field was wrong,
  // and the Application ID sits right beside the Public Key in the portal — so
  // the wrong paste is easy to make and impossible to diagnose from Discord's
  // own error.
  const idCheck = checkDiscordClientId(clientId);

  const submit = () => {
    if (connecting || !idCheck.ok) return;
    connect(clientId.trim()).catch((err) => console.error('connect failed', err));
  };

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: 14, gap: 10, minHeight: 0, overflow: 'auto' }}>
      <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.85)', lineHeight: 1.5 }}>
        Connect Discord to show your user, server list, and avatars in this tile. Read-only —
        we never post on your behalf.
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <label style={{ fontSize: 9, color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase', letterSpacing: '.08em', fontWeight: 600 }}>
          Discord Application ID
        </label>
        <input
          value={clientId}
          onChange={(e) => setClientId(e.target.value)}
          placeholder="e.g. 123456789012345678"
          spellCheck={false}
          style={{
            background: 'rgba(0,0,0,0.3)',
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: 6,
            color: '#fff',
            padding: '7px 10px',
            fontSize: 12,
            fontFamily: '"JetBrains Mono", ui-monospace, monospace',
            outline: 'none',
          }}
          onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
        />
        {/* Only nag once they've typed something — an empty field on first
            paint is the normal state, not a mistake. */}
        {clientId.trim() !== '' && idCheck.problem && (
          <span style={{ fontSize: 10.5, color: '#fca5a5', lineHeight: 1.45 }}>
            {idCheck.problem}
          </span>
        )}
      </div>

      <div style={{ display: 'flex', gap: 8 }}>
        <button
          onClick={submit}
          disabled={!idCheck.ok || connecting}
          style={{
            flex: 1,
            padding: '8px 12px', fontSize: 12, fontWeight: 700,
            background: clientId.trim() && !connecting ? accent : 'rgba(255,255,255,0.06)',
            color: clientId.trim() && !connecting ? '#000' : 'rgba(255,255,255,0.4)',
            border: 'none', borderRadius: 6,
            cursor: clientId.trim() && !connecting ? 'pointer' : 'not-allowed',
            transition: 'background 0.15s',
          }}
        >
          {connecting ? 'Authorizing…' : 'Connect Discord'}
        </button>
        <button
          onClick={() => setShowHelp((v) => !v)}
          style={{
            padding: '8px 12px', fontSize: 11, fontWeight: 600,
            background: 'rgba(255,255,255,0.04)',
            color: 'rgba(255,255,255,0.6)',
            border: '1px solid rgba(255,255,255,0.08)', borderRadius: 6,
            cursor: 'pointer',
          }}
        >
          {showHelp ? '×' : '?'}
        </button>
      </div>

      {error && (
        <div style={{ fontSize: 11, color: '#fca5a5', padding: 8, borderRadius: 6, background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)' }}>
          {error}
        </div>
      )}

      {showHelp && (
        <div style={{
          fontSize: 11, color: 'rgba(255,255,255,0.7)', lineHeight: 1.5,
          padding: 10, borderRadius: 6,
          background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)',
        }}>
          <div style={{ fontWeight: 600, color: '#fff', marginBottom: 6 }}>One-time setup:</div>
          <ol style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 4 }}>
            <li>Open <span style={{ color: accent, fontFamily: '"JetBrains Mono", ui-monospace, monospace' }}>discord.com/developers/applications</span></li>
            <li>Click <b>New Application</b>. Pick any name.</li>
            <li>Open <b>OAuth2 → Redirects</b>. Add{' '}
              <span style={{ color: accent, fontFamily: '"JetBrains Mono", ui-monospace, monospace' }}>http://localhost:14201/callback</span>{' '}
              and save.
            </li>
            <li>Go to <b>General Information</b> and copy <b>Application ID</b> —
              a long number. Not the <b>Public Key</b> just below it, and never a
              bot token. (The OAuth2 page shows the same number labelled
              <b> Client ID</b>.)</li>
            <li>Click Connect — the browser opens, you click Authorize, you're done.</li>
          </ol>
        </div>
      )}
    </div>
  );
}

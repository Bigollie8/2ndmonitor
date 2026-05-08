/** Anonymous read-only Twitch IRC over WebSocket.
 *  We connect with a justinfan* nick (Twitch's anonymous-read convention), no
 *  OAuth required. Caller gets a stream of parsed messages until disconnect.
 *
 *  Twitch IRC reference: https://dev.twitch.tv/docs/irc */

export interface ChatMessage {
  id: string;             // synthesized; Twitch's tag id is unreliable
  user: string;           // login name
  displayName: string;
  color: string | null;   // user-chosen color from IRCv3 tags
  text: string;
  timestamp: number;
}

export interface ChatHandlers {
  onMessage: (msg: ChatMessage) => void;
  onStatus: (status: ChatStatus) => void;
}

export type ChatStatus =
  | { kind: 'connecting' }
  | { kind: 'connected' }
  | { kind: 'disconnected'; reason?: string };

const PALETTE = ['#fb7185', '#60a5fa', '#a78bfa', '#facc15', '#7cf5d4', '#fb923c', '#22c55e', '#ec4899'];

function colorForUser(login: string): string {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < login.length; i++) {
    h = Math.imul(h ^ login.charCodeAt(i), 16777619) >>> 0;
  }
  return PALETTE[h % PALETTE.length]!;
}

export function connectTwitchChat(channel: string, handlers: ChatHandlers): () => void {
  const channelLower = channel.trim().toLowerCase();
  if (!channelLower) {
    handlers.onStatus({ kind: 'disconnected', reason: 'no channel' });
    return () => {};
  }

  let cancelled = false;
  let ws: WebSocket | null = null;
  let reconnectTimer: number | null = null;
  let nextId = 0;

  const connect = () => {
    if (cancelled) return;
    handlers.onStatus({ kind: 'connecting' });
    const anonNick = `justinfan${Math.floor(Math.random() * 100000) + 1000}`;
    ws = new WebSocket('wss://irc-ws.chat.twitch.tv:443');

    ws.onopen = () => {
      if (!ws) return;
      // Tag capability gives us color, display-name, etc.
      ws!.send('CAP REQ :twitch.tv/tags');
      ws!.send(`PASS SCHMOOPIIE`); // ignored for justinfan but the IRC spec wants something
      ws!.send(`NICK ${anonNick}`);
      ws!.send(`JOIN #${channelLower}`);
    };

    ws.onmessage = (ev) => {
      const data = typeof ev.data === 'string' ? ev.data : '';
      // Twitch may pack multiple IRC lines per WebSocket frame.
      for (const line of data.split('\r\n')) {
        if (!line) continue;
        if (line.startsWith('PING')) {
          ws?.send('PONG :tmi.twitch.tv');
          continue;
        }
        // Connected once we see the welcome / room state.
        if (line.includes(' 001 ') || line.includes(' ROOMSTATE ')) {
          handlers.onStatus({ kind: 'connected' });
        }
        const parsed = parsePrivmsg(line);
        if (parsed) {
          handlers.onMessage({
            ...parsed,
            id: `${Date.now()}-${nextId++}`,
            timestamp: Date.now(),
          });
        }
      }
    };

    ws.onclose = () => {
      if (cancelled) return;
      handlers.onStatus({ kind: 'disconnected' });
      // Backoff reconnect — Twitch may rate limit on flapping.
      reconnectTimer = window.setTimeout(() => connect(), 5000);
    };
    ws.onerror = () => {
      // onclose will fire after; nothing to do here.
    };
  };

  connect();

  return () => {
    cancelled = true;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    if (ws) {
      try { ws.close(); } catch { /* ignore */ }
    }
  };
}

interface ParsedPrivmsg {
  user: string;
  displayName: string;
  color: string | null;
  text: string;
}

function parsePrivmsg(line: string): ParsedPrivmsg | null {
  // IRCv3 with tags: "@key=val;key=val :nick!nick@nick.tmi.twitch.tv PRIVMSG #channel :message"
  if (!line.includes(' PRIVMSG ')) return null;
  let tags: Record<string, string> = {};
  let rest = line;
  if (line.startsWith('@')) {
    const sep = line.indexOf(' ');
    if (sep === -1) return null;
    tags = parseTags(line.slice(1, sep));
    rest = line.slice(sep + 1);
  }
  // ":nick!user@host PRIVMSG #channel :message"
  const m = rest.match(/^:([^!]+)![^ ]+ PRIVMSG #[^ ]+ :(.*)$/);
  if (!m) return null;
  const login = m[1];
  const text = m[2];
  const displayName = tags['display-name'] || login;
  const color = tags['color'] || null;
  return {
    user: login,
    displayName,
    color: color && /^#[0-9a-f]{6}$/i.test(color) ? color : colorForUser(login),
    text,
  };
}

function parseTags(s: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const pair of s.split(';')) {
    const eq = pair.indexOf('=');
    if (eq === -1) continue;
    out[pair.slice(0, eq)] = pair.slice(eq + 1);
  }
  return out;
}

export interface TwitchChatConfig {
  channel: string;
}

export const DEFAULT_TWITCH_CONFIG: TwitchChatConfig = { channel: '' };

export function parseTwitchChatConfig(raw: unknown): TwitchChatConfig {
  if (!raw || typeof raw !== 'object') return DEFAULT_TWITCH_CONFIG;
  const c = raw as Record<string, unknown>;
  const channel = typeof c.channel === 'string' ? c.channel.trim().toLowerCase().slice(0, 32) : '';
  return { channel };
}

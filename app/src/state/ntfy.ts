/** ntfy.sh subscription. The user picks a topic; their phone publishes to the
 *  same topic via the ntfy Android/iOS app or a Tasker action. We open the
 *  topic's `/json` SSE-ish stream and surface each message in the tile.
 *
 *  No auth: ntfy.sh treats topic names as the credential. Use a long random
 *  string per user to keep notifications private. */

// The topic IS the credential, so it lives in the encrypted secret store
// (see state/secrets.ts, key "ntfy_topic"; legacy localStorage key
// "2mh.ntfy.topic" is migrated on first read). The server URL is not a
// secret and stays in plain localStorage.
const SERVER_KEY = '2mh.ntfy.server';

export interface NtfyNotification {
  id: string;
  time: number;        // unix seconds
  title: string | null;
  message: string;
  topic: string;
  /** ntfy "tags" field — typically used for emoji aliases. */
  tags: string[];
  priority: number | null;
  click: string | null;
}

export interface NtfyHandlers {
  onNotification: (n: NtfyNotification) => void;
  onStatus: (status: NtfyStatus) => void;
}

export type NtfyStatus =
  | { kind: 'connecting' }
  | { kind: 'connected' }
  | { kind: 'disconnected'; reason?: string };

export function getStoredServer(): string {
  return localStorage.getItem(SERVER_KEY) ?? 'https://ntfy.sh';
}
export function setStoredServer(s: string): void {
  const cleaned = s.trim().replace(/\/$/, '');
  if (cleaned) localStorage.setItem(SERVER_KEY, cleaned);
  else localStorage.removeItem(SERVER_KEY);
}

interface RawMessage {
  id?: string;
  time?: number;
  event?: string;
  topic?: string;
  title?: string;
  message?: string;
  tags?: string[];
  priority?: number;
  click?: string;
}

/** Open the topic's /json stream. Returns a teardown function. The /json endpoint
 *  delivers one JSON object per line (newline-delimited) and stays open until
 *  closed. We use fetch + ReadableStream rather than EventSource because ntfy's
 *  /json doesn't follow the SSE event format. */
export function subscribeNtfy(server: string, topic: string, handlers: NtfyHandlers): () => void {
  let cancelled = false;
  let abort: AbortController | null = null;
  let retryTimer: number | null = null;

  const open = async () => {
    if (cancelled) return;
    handlers.onStatus({ kind: 'connecting' });
    abort = new AbortController();
    try {
      const url = `${server.replace(/\/$/, '')}/${encodeURIComponent(topic)}/json`;
      const res = await fetch(url, { signal: abort.signal });
      if (!res.ok || !res.body) throw new Error(`ntfy HTTP ${res.status}`);
      handlers.onStatus({ kind: 'connected' });
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (!cancelled) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buffer.indexOf('\n')) !== -1) {
          const line = buffer.slice(0, nl).trim();
          buffer = buffer.slice(nl + 1);
          if (!line) continue;
          try {
            const raw = JSON.parse(line) as RawMessage;
            // ntfy sends "open"/"keepalive" event lines too — ignore those.
            if (raw.event && raw.event !== 'message') continue;
            if (typeof raw.message !== 'string') continue;
            handlers.onNotification({
              id: raw.id ?? `${Date.now()}-${Math.random()}`,
              time: typeof raw.time === 'number' ? raw.time : Math.floor(Date.now() / 1000),
              title: raw.title ?? null,
              message: raw.message,
              topic: raw.topic ?? topic,
              tags: Array.isArray(raw.tags) ? raw.tags.filter((s): s is string => typeof s === 'string') : [],
              priority: typeof raw.priority === 'number' ? raw.priority : null,
              click: raw.click ?? null,
            });
          } catch {
            // skip malformed line
          }
        }
      }
    } catch (err) {
      if (cancelled) return;
      handlers.onStatus({ kind: 'disconnected', reason: String(err) });
    } finally {
      if (!cancelled) {
        retryTimer = window.setTimeout(() => open(), 5000);
      }
    }
  };
  void open();

  return () => {
    cancelled = true;
    abort?.abort();
    if (retryTimer) clearTimeout(retryTimer);
  };
}

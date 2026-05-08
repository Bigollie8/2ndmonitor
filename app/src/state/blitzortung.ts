/** Blitzortung public lightning detection network — anonymous WebSocket feed.
 *  The protocol is undocumented officially; this implementation follows the
 *  community-reverse-engineered format used by lightningmaps.org and similar
 *  trackers:
 *
 *    1. Connect to wss://ws{N}.blitzortung.org/ where N ∈ {1,3,5,7,8}.
 *    2. Send `{"a": 111}` to subscribe to global lightning events.
 *    3. Server replies with one event per WS frame, each frame is an
 *       LZW-encoded JSON string.
 *
 *  Each decoded event is `{ time, lat, lon, alt, pol, mds, mcg, status, region, sig }`.
 *  We surface lat/lon/time and let the tile compute distance to the user. */

export interface LightningStrike {
  /** Unix epoch nanoseconds from Blitzortung; convert to ms for JS Dates. */
  timeNs: number;
  /** Same as timeNs but in millisecond resolution for display. */
  timeMs: number;
  lat: number;
  lon: number;
}

export interface BlitzortungHandlers {
  onStrike: (s: LightningStrike) => void;
  onStatus: (status: BlitzortungStatus) => void;
}

export type BlitzortungStatus =
  | { kind: 'connecting' }
  | { kind: 'connected' }
  | { kind: 'disconnected'; reason?: string };

const SERVERS = [1, 3, 5, 7, 8];

export function connectBlitzortung(handlers: BlitzortungHandlers): () => void {
  let cancelled = false;
  let ws: WebSocket | null = null;
  let reconnectTimer: number | null = null;
  let serverIdx = 0;

  const open = () => {
    if (cancelled) return;
    handlers.onStatus({ kind: 'connecting' });
    const n = SERVERS[serverIdx % SERVERS.length]!;
    serverIdx++;
    ws = new WebSocket(`wss://ws${n}.blitzortung.org/`);

    ws.onopen = () => {
      if (!ws) return;
      ws.send(JSON.stringify({ a: 111 }));
      handlers.onStatus({ kind: 'connected' });
    };

    ws.onmessage = (ev) => {
      const raw = typeof ev.data === 'string' ? ev.data : '';
      if (!raw) return;
      const decoded = decodeLZW(raw);
      try {
        const data = JSON.parse(decoded) as { time?: number; lat?: number; lon?: number };
        if (typeof data.time !== 'number' || typeof data.lat !== 'number' || typeof data.lon !== 'number') return;
        handlers.onStrike({
          timeNs: data.time,
          timeMs: Math.floor(data.time / 1_000_000),
          lat: data.lat,
          lon: data.lon,
        });
      } catch {
        // skip non-strike messages (heartbeats, errors)
      }
    };

    ws.onclose = () => {
      if (cancelled) return;
      handlers.onStatus({ kind: 'disconnected' });
      reconnectTimer = window.setTimeout(open, 5000);
    };
    ws.onerror = () => { /* close handler will fire */ };
  };

  open();
  return () => {
    cancelled = true;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    if (ws) try { ws.close(); } catch { /* ignore */ }
  };
}

/** LZW decoder reverse-engineered by the lightningmaps.org community for the
 *  Blitzortung WebSocket payload format. Operates on the raw string as a
 *  sequence of charCodes; builds a dictionary up to 256+, emits decoded UTF-16
 *  text suitable for JSON.parse. */
function decodeLZW(input: string): string {
  if (!input) return '';
  const dict: Record<number, string> = {};
  const data = input.split('');
  let curr = data[0]!;
  let last = curr;
  const out: string[] = [curr];
  let nextCode = 256;
  let dictIndex = nextCode;

  for (let i = 1; i < data.length; i++) {
    const code = data[i]!.charCodeAt(0);
    let entry: string;
    if (code < nextCode) {
      entry = data[i]!;
    } else if (dict[code]) {
      entry = dict[code]!;
    } else {
      entry = last + curr;
    }
    out.push(entry);
    curr = entry.charAt(0);
    dict[dictIndex] = last + curr;
    dictIndex++;
    last = entry;
  }
  return out.join('');
}

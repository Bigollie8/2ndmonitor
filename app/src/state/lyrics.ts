import { useEffect, useState } from 'react';

const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

export interface LrcLine { tsMs: number; text: string }

export interface LyricsState {
  trackKey: string | null;
  syncedLines: LrcLine[];
  plainLines: string[];
  instrumental: boolean;
}

const EMPTY: LyricsState = { trackKey: null, syncedLines: [], plainLines: [], instrumental: false };

interface LyricsPayload {
  track_key: string;
  synced_lrc: string | null;
  plain_lyrics: string | null;
  instrumental: boolean;
}

/** Parse LRC into [{ tsMs, text }]. Multiple [mm:ss.xx] tags on one line emit
 *  multiple entries. Tag lines like [ar:...], [ti:...], [length:...] are dropped. */
export function parseLrc(lrc: string): LrcLine[] {
  if (!lrc) return [];
  const lines = lrc.split(/\r?\n/);
  const out: LrcLine[] = [];
  // [mm:ss.xx] or [mm:ss]
  const tsRe = /\[(\d+):(\d{1,2}(?:\.\d+)?)\]/g;
  // tag line: [name:value]
  const tagRe = /^\[(?:ar|ti|al|by|length|offset|re|ve|tool|au|lr|t_time):/i;
  for (const raw of lines) {
    if (!raw) continue;
    if (tagRe.test(raw)) continue;
    // Collect all leading timestamps (handle e.g. "[00:01.50][00:30.00]chorus").
    const stamps: number[] = [];
    let lastIdx = 0;
    tsRe.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = tsRe.exec(raw)) !== null) {
      // Only count timestamps that form a contiguous prefix.
      if (m.index !== lastIdx) break;
      const mm = parseInt(m[1]!, 10);
      const ss = parseFloat(m[2]!);
      stamps.push(Math.round((mm * 60 + ss) * 1000));
      lastIdx = m.index + m[0]!.length;
    }
    if (stamps.length === 0) continue;
    const text = raw.slice(lastIdx).trim();
    for (const ts of stamps) out.push({ tsMs: ts, text });
  }
  out.sort((a, b) => a.tsMs - b.tsMs);
  return out;
}

/** Mirrors lyrics.rs `track_key()` — `artist|title|album`, trimmed — so the
 *  frontend can check WHOSE lyrics the store currently holds (0.9.7). The
 *  store only clears on `lyrics:clear` (empty title or 404), so a video
 *  session (Netflix in a browser via GSMTC) with no LRCLIB match leaves the
 *  previous song's lines cached — and without this check they replayed over
 *  the visualizer against the video's playback position. Null when there is
 *  no meaningful track to match (no title). */
export function trackKeyOf(
  t: { title?: string | null; artist?: string | null; album?: string | null } | null | undefined,
): string | null {
  const title = t?.title?.trim();
  if (!title) return null;
  return `${(t?.artist ?? '').trim()}|${title}|${(t?.album ?? '').trim()}`;
}

/** Returns the current synced-line index, or -1 if before the first line. */
export function currentLineIndex(lines: LrcLine[], positionSecs: number): number {
  if (lines.length === 0) return -1;
  const ms = positionSecs * 1000;
  let lo = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i]!.tsMs <= ms) lo = i; else break;
  }
  return lo;
}

// Module-level store. The Tauri event bus broadcasts `lyrics:update` once per
// track change with no replay, so a per-component listener that mounts late
// (e.g. when the user finally clicks the Lyrics tab) misses it. Sharing one
// listener + state across all consumers fixes that race.
let storeState: LyricsState = EMPTY;
const subscribers = new Set<() => void>();
let listenersAttached = false;
let attachInFlight: Promise<void> | null = null;

function setStoreState(next: LyricsState) {
  storeState = next;
  for (const fn of subscribers) fn();
}

function attachListenersOnce(): Promise<void> {
  if (listenersAttached) return Promise.resolve();
  if (attachInFlight) return attachInFlight;
  if (!isTauri) return Promise.resolve();
  attachInFlight = (async () => {
    const { listen } = await import('@tauri-apps/api/event');
    await listen<LyricsPayload>('lyrics:update', (e) => {
      const p = e.payload;
      setStoreState({
        trackKey: p.track_key,
        syncedLines: parseLrc(p.synced_lrc ?? ''),
        plainLines: (p.plain_lyrics ?? '').split(/\r?\n/).filter((l) => l.length > 0),
        instrumental: p.instrumental,
      });
    });
    await listen<unknown>('lyrics:clear', () => {
      setStoreState(EMPTY);
    });
    listenersAttached = true;
  })().catch((err) => {
    console.warn('lyrics listen failed:', err);
    attachInFlight = null;
  });
  return attachInFlight;
}

export function useLyrics(): LyricsState {
  const [state, setState] = useState<LyricsState>(storeState);
  useEffect(() => {
    void attachListenersOnce();
    const update = () => setState(storeState);
    subscribers.add(update);
    update();
    return () => { subscribers.delete(update); };
  }, []);
  return state;
}

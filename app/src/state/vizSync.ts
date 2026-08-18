// Musically-synced visuals (0.9.10): the frontend half of the Spotify
// beat/bar/section grid. Polls `spotify_sync_grid` while a sync-declaring
// visualizer is active; the grid changes only when the TRACK changes, so
// `version` bumps on track-id transitions (and null↔grid flips), never per
// poll — consumers repost to the sandbox frame only on version changes.
//
// The grid is honestly optional: Spotify not connected, nothing playing, or
// the analysis endpoint being unavailable (deprecated for API apps created
// after Nov 2024 — a 403 the Rust side maps to null) all yield `grid: null`,
// and sync visuals fall back to live onset envelopes.

import { useEffect, useRef, useState } from 'react';
import { isTauri } from './tauri';

export interface SyncEvent { start: number; duration: number; confidence: number }
export interface SyncSection { start: number; duration: number; loudness: number; tempo: number }
export interface VizSyncGrid {
  track_id: string;
  progress_ms: number;
  fetched_at_ms: number;
  playing: boolean;
  beats: SyncEvent[];
  bars: SyncEvent[];
  sections: SyncSection[];
}

const POLL_MS = 5_000;

export function useVizSync(active: boolean): { grid: VizSyncGrid | null; version: number } {
  const [state, setState] = useState<{ grid: VizSyncGrid | null; version: number }>({ grid: null, version: 0 });
  const lastTrackRef = useRef<string | null>(null);

  useEffect(() => {
    if (!active || !isTauri) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        const grid = await invoke<VizSyncGrid | null>('spotify_sync_grid');
        if (cancelled) return;
        const trackId = grid?.track_id ?? null;
        if (trackId !== lastTrackRef.current) {
          lastTrackRef.current = trackId;
          setState((s) => ({ grid, version: s.version + 1 }));
        }
      } catch { /* command unavailable — stay null */ }
    };
    void poll();
    const id = setInterval(() => void poll(), POLL_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, [active]);

  return state;
}

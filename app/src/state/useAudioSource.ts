// Drives the Settings source picker: the apps currently available to pick
// from, and the live status of whatever the visualizer is actually
// listening to. Mirrors the invoke-then-listen shape of useDiscordRpc /
// useSpotify in tauri.ts.
import { useCallback, useEffect, useState } from 'react';
import { isTauri } from './tauri';
import type { AudioSource } from './audioSource';

export interface SourceOption {
  /** Lowercased executable basename — the stable identity of a source. */
  exe: string;
  name: string;
  icon: string | null;
}

/** Mirrors Rust's `AudioSourceState` (audio.rs) exactly — note the
 *  snake_case `active_exe`, which crosses the wire as serde emits it. */
export interface AudioSourceState {
  requested: AudioSource;
  active: 'mix' | 'process';
  active_exe: string | null;
  supported: boolean;
  reason: string | null;
}

export function useAudioSource(): {
  options: SourceOption[];
  status: AudioSourceState | null;
  refresh: () => void;
} {
  const [options, setOptions] = useState<SourceOption[]>([]);
  const [status, setStatus] = useState<AudioSourceState | null>(null);

  const refresh = useCallback(() => {
    if (!isTauri) return;
    void (async () => {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        setOptions(await invoke<SourceOption[]>('audio_sources_list'));
      } catch (err) {
        console.error('audio_sources_list failed', err);
      }
    })();
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Status: `audio_get_source` for the value at mount, then `audio:source`
  // for updates. The backend emits `audio:source` once at startup, which
  // almost certainly fires before this listener registers — `audio_get_source`
  // exists specifically to close that race (see LAST_STATE in audio.rs).
  useEffect(() => {
    if (!isTauri) return;
    let cancelled = false;
    let cleanup: (() => void) | null = null;
    (async () => {
      const { listen } = await import('@tauri-apps/api/event');
      const { invoke } = await import('@tauri-apps/api/core');
      try {
        const initial = await invoke<AudioSourceState>('audio_get_source');
        if (!cancelled) setStatus(initial);
      } catch { /* ignore */ }
      const unlisten = await listen<AudioSourceState>('audio:source', (e) => {
        if (cancelled) return;
        setStatus(e.payload);
      });
      if (cancelled) { unlisten(); return; }
      cleanup = unlisten;
    })().catch((err) => console.error('audio:source listen failed', err));
    return () => { cancelled = true; cleanup?.(); };
  }, []);

  return { options, status, refresh };
}

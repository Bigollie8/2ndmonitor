import { useEffect, useRef, type MutableRefObject } from 'react';
import { WAVEFORM_LEN } from './waveform-levels';

// ─────────────────────────────────────────────────────────────────────────────
// Raw waveform — wraps `audio:waveform` events from the Rust audio thread.
// Emission is opt-in on the Rust side (set_waveform_enabled), so this hook
// turns it on for the lifetime of the consuming component and off again on
// unmount. Only the MilkDrop viz consumes it today.
// ─────────────────────────────────────────────────────────────────────────────

export interface WaveformState {
  /** Newest 1024 mono time-domain bytes, 0–255 centered at 128. */
  mono: Uint8Array;
  /** True once at least one live frame has arrived. */
  live: boolean;
}

export function useWaveformRef(): MutableRefObject<WaveformState> {
  const ref = useRef<WaveformState>({
    mono: (() => { const a = new Uint8Array(WAVEFORM_LEN); a.fill(128); return a; })(),
    live: false,
  });
  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    import('@tauri-apps/api/core')
      .then(({ invoke }) => invoke('set_waveform_enabled', { enabled: true }))
      .catch(() => {});
    import('@tauri-apps/api/event')
      .then(({ listen }) =>
        listen<number[]>('audio:waveform', (e) => {
          if (cancelled) return;
          const n = Math.min(e.payload.length, WAVEFORM_LEN);
          for (let i = 0; i < n; i++) ref.current.mono[i] = e.payload[i];
          ref.current.live = true;
        }),
      )
      .then((un) => { if (cancelled) un?.(); else unlisten = un; })
      .catch(() => {});
    return () => {
      cancelled = true;
      unlisten?.();
      import('@tauri-apps/api/core')
        .then(({ invoke }) => invoke('set_waveform_enabled', { enabled: false }))
        .catch(() => {});
    };
  }, []);
  return ref;
}

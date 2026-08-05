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
  /** The same window per channel (0.8.4). A mono source — including any
   *  per-app capture, which is mixed before it reaches the ring — has
   *  left === right, so a vectorscope drawn from these correctly shows a
   *  vertical line rather than pretending to a stereo image it never had. */
  left: Uint8Array;
  right: Uint8Array;
  /** True once at least one live STEREO frame has arrived. Separate from
   *  `live` so a consumer can tell "no audio yet" from "this backend never
   *  sends stereo". */
  stereoLive: boolean;
  /** True once at least one live frame has arrived. */
  live: boolean;
}

export function useWaveformRef(): MutableRefObject<WaveformState> {
  const ref = useRef<WaveformState>({
    mono: (() => { const a = new Uint8Array(WAVEFORM_LEN); a.fill(128); return a; })(),
    left: (() => { const a = new Uint8Array(WAVEFORM_LEN); a.fill(128); return a; })(),
    right: (() => { const a = new Uint8Array(WAVEFORM_LEN); a.fill(128); return a; })(),
    stereoLive: false,
    live: false,
  });
  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    let unlistenStereo: (() => void) | undefined;
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
    // Stereo rides the same opt-in flag enabled above, so it needs no second
    // enable call — only its own listener.
    import('@tauri-apps/api/event')
      .then(({ listen }) =>
        listen<{ left: number[]; right: number[] }>('audio:waveform_stereo', (e) => {
          if (cancelled) return;
          const { left, right } = e.payload;
          const n = Math.min(left.length, right.length, WAVEFORM_LEN);
          for (let i = 0; i < n; i++) {
            ref.current.left[i] = left[i]!;
            ref.current.right[i] = right[i]!;
          }
          ref.current.stereoLive = true;
        }),
      )
      .then((un) => { if (cancelled) un?.(); else unlistenStereo = un; })
      .catch(() => {});
    return () => {
      cancelled = true;
      unlisten?.();
      unlistenStereo?.();
      import('@tauri-apps/api/core')
        .then(({ invoke }) => invoke('set_waveform_enabled', { enabled: false }))
        .catch(() => {});
    };
  }, []);
  return ref;
}

import { useEffect, useRef, type MutableRefObject } from 'react';
import { WAVEFORM_LEN } from './waveform-levels';

// ─────────────────────────────────────────────────────────────────────────────
// Raw waveform — wraps `audio:waveform` / `audio:waveform_stereo` events from
// the Rust audio thread. Emission is opt-in on the Rust side, and STEREO is
// opted into separately (0.8.7): the stereo payload is ~8 KB of JSON per frame
// at 30 Hz, and only bundles whose manifest declares `"stereo": true` (the
// vectorscope and the loudness console) ever read it — every other consumer
// used to pay that IPC for nothing.
//
// REFCOUNTED, one shared state (0.8.7) — the previous per-hook enable/disable
// had a latent bug: every SandboxVizSurface instance called
// set_waveform_enabled(false) on unmount, so closing one gallery card shut the
// waveform off for the hero surface still on screen. Same fix shape as the
// 0.7.3 shared sysmon subscription.
// ─────────────────────────────────────────────────────────────────────────────

export interface WaveformState {
  /** Newest 1024 mono time-domain bytes, 0–255 centered at 128. */
  mono: Uint8Array;
  /** The same window per channel. A genuinely mono source has left === right;
   *  since 0.9.3 per-app capture carries true stereo like the default mix. */
  left: Uint8Array;
  right: Uint8Array;
  /** True once at least one live STEREO frame has arrived. Consumers use this
   *  to decide whether left/right carry real data or their initial silence. */
  stereoLive: boolean;
  /** True once at least one live frame has arrived. */
  live: boolean;
}

const filled = () => { const a = new Uint8Array(WAVEFORM_LEN); a.fill(128); return a; };

const shared: WaveformState = {
  mono: filled(), left: filled(), right: filled(),
  stereoLive: false, live: false,
};
const sharedRef: MutableRefObject<WaveformState> = { current: shared };

let monoCount = 0;
let stereoCount = 0;
let monoUnlisten: (() => void) | undefined;
let stereoUnlisten: (() => void) | undefined;

function setEnabled(command: 'set_waveform_enabled' | 'set_stereo_waveform_enabled', enabled: boolean): void {
  void import('@tauri-apps/api/core')
    .then(({ invoke }) => invoke(command, { enabled }))
    .catch(() => { /* browser dev — no tauri */ });
}

function acquireMono(): void {
  monoCount += 1;
  if (monoCount > 1) return;
  setEnabled('set_waveform_enabled', true);
  void import('@tauri-apps/api/event')
    .then(({ listen }) => listen<number[]>('audio:waveform', (e) => {
      const n = Math.min(e.payload.length, WAVEFORM_LEN);
      for (let i = 0; i < n; i++) shared.mono[i] = e.payload[i]!;
      shared.live = true;
    }))
    .then((un) => {
      if (monoCount === 0) un();
      else monoUnlisten = un;
    })
    .catch(() => {});
}

function releaseMono(): void {
  monoCount = Math.max(0, monoCount - 1);
  if (monoCount > 0) return;
  setEnabled('set_waveform_enabled', false);
  monoUnlisten?.();
  monoUnlisten = undefined;
  shared.live = false;
}

function acquireStereo(): void {
  stereoCount += 1;
  if (stereoCount > 1) return;
  setEnabled('set_stereo_waveform_enabled', true);
  void import('@tauri-apps/api/event')
    .then(({ listen }) => listen<{ left: number[]; right: number[] }>('audio:waveform_stereo', (e) => {
      const { left, right } = e.payload;
      const n = Math.min(left.length, right.length, WAVEFORM_LEN);
      for (let i = 0; i < n; i++) {
        shared.left[i] = left[i]!;
        shared.right[i] = right[i]!;
      }
      shared.stereoLive = true;
    }))
    .then((un) => {
      if (stereoCount === 0) un();
      else stereoUnlisten = un;
    })
    .catch(() => {});
}

function releaseStereo(): void {
  stereoCount = Math.max(0, stereoCount - 1);
  if (stereoCount > 0) return;
  setEnabled('set_stereo_waveform_enabled', false);
  stereoUnlisten?.();
  stereoUnlisten = undefined;
  shared.stereoLive = false;
}

export function useWaveformRef(opts?: { stereo?: boolean }): MutableRefObject<WaveformState> {
  const stereo = opts?.stereo === true;
  // Track what THIS instance holds so a stereo flag flip mid-mount releases
  // exactly what it acquired, never a neighbour's count.
  const holdsStereo = useRef(false);
  useEffect(() => {
    acquireMono();
    return () => releaseMono();
  }, []);
  useEffect(() => {
    if (stereo && !holdsStereo.current) {
      holdsStereo.current = true;
      acquireStereo();
    } else if (!stereo && holdsStereo.current) {
      holdsStereo.current = false;
      releaseStereo();
    }
    return () => {
      if (holdsStereo.current) {
        holdsStereo.current = false;
        releaseStereo();
      }
    };
  }, [stereo]);
  return sharedRef;
}

// Pure assembly of the per-frame payload. Extracted from the React frame pump
// in viz-scripted.tsx so the contract is testable without a DOM or an iframe.
import type {
  FrameMessage, VizPlayback, VizSize, VizTheme, VizTrackInfo,
} from './manifest';
import { MSG_FRAME } from './manifest';
import type { Playback } from '../state/tauri';

export interface FrameInput {
  spectrum: Float32Array;
  waveform: Uint8Array;
  /** Per-channel time domain (0.8.4). Equal for a mono source. */
  waveformL: Uint8Array;
  waveformR: Uint8Array;
  bands: { bass: number; mid: number; treble: number };
  onset: { kick: number; snare: number; hat: number };
  level: number;
  /** Milliseconds since the previous frame. */
  dtMs: number;
  size: VizSize;
  theme: VizTheme;
  track: VizTrackInfo | null;
  playback: VizPlayback | null;
}

/** Seconds since the previous frame, capped at 250ms. A tab that was hidden or
 *  a GC pause would otherwise hand a physics-driven style a huge dt and blow
 *  its integration apart on the first frame back. */
export function clampDt(ms: number): number {
  if (!Number.isFinite(ms) || ms <= 0) return 0;
  return Math.min(0.25, ms / 1000);
}

/** Project the host's sync-stamped playback into a plain {playing, position,
 *  duration} at `nowMs`. Type-only import, so this module stays node-testable. */
export function toVizPlayback(pb: Playback | null | undefined, nowMs: number): VizPlayback | null {
  if (!pb) return null;
  if (!pb.playing) {
    return { playing: false, position: pb.positionAtSync, duration: pb.duration };
  }
  const projected = pb.positionAtSync + (nowMs - pb.syncedAt) / 1000;
  return {
    playing: true,
    position: pb.duration > 0 ? Math.min(pb.duration, projected) : projected,
    duration: pb.duration,
  };
}

export function buildFrameMessage(input: FrameInput): FrameMessage {
  return {
    type: MSG_FRAME,
    spectrum: input.spectrum,
    waveform: input.waveform,
    waveformL: input.waveformL,
    waveformR: input.waveformR,
    bands: input.bands,
    onset: input.onset,
    level: input.level,
    dt: clampDt(input.dtMs),
    size: input.size,
    theme: input.theme,
    track: input.track,
    playback: input.playback ?? null,
  };
}

/** Butterchurn's AudioProcessor.updateAudio expects three Uint8Array(1024)
 *  buffers (Web Audio getByteTimeDomainData convention, 128 = silence).
 *  We capture mono, so L/R are duplicates. Output objects are allocated once
 *  and mutated in place — this runs every rAF tick.
 *
 *  Kept free of `@tauri-apps` imports so it stays node-testable. */
export const WAVEFORM_LEN = 1024;

export function makeButterchurnLevels() {
  const timeByteArray = new Uint8Array(WAVEFORM_LEN);
  const timeByteArrayL = new Uint8Array(WAVEFORM_LEN);
  const timeByteArrayR = new Uint8Array(WAVEFORM_LEN);
  timeByteArray.fill(128); timeByteArrayL.fill(128); timeByteArrayR.fill(128);
  const levels = { timeByteArray, timeByteArrayL, timeByteArrayR };
  return {
    levels,
    update(mono: Uint8Array) {
      const src = mono.length > WAVEFORM_LEN ? mono.subarray(0, WAVEFORM_LEN) : mono;
      timeByteArray.set(src);
      timeByteArrayL.set(src);
      timeByteArrayR.set(src);
    },
  };
}

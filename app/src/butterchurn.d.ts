/** Hand-written shims — butterchurn ships no TypeScript types.
 *  Shapes verified against butterchurn@2.6.7 source:
 *  - createVisualizer(ctx, canvas, opts) → Visualizer
 *  - render({ audioLevels }) routes to AudioProcessor.updateAudio(mono, L, R),
 *    each a Uint8Array(1024), 0–255 centered at 128 — bypassing Web Audio. */
declare module 'butterchurn' {
  export interface AudioLevels {
    timeByteArray: Uint8Array;
    timeByteArrayL: Uint8Array;
    timeByteArrayR: Uint8Array;
  }
  export interface BCVisualizer {
    loadPreset(preset: object, blendTime?: number): void;
    setRendererSize(width: number, height: number): void;
    render(opts?: { audioLevels?: AudioLevels }): void;
  }
  const butterchurn: {
    createVisualizer(
      ctx: AudioContext | null,
      canvas: HTMLCanvasElement,
      opts: { width: number; height: number; pixelRatio?: number },
    ): BCVisualizer;
  };
  export default butterchurn;
}

declare module 'butterchurn-presets' {
  const presets: { getPresets(): Record<string, object> };
  export default presets;
}

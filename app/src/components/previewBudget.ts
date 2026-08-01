// ─────────────────────────────────────────────────────────────────────────────
// Global concurrency cap for live sandboxed visualizer previews (spec: task 7
// of the previews plan). Rendering a preview means mounting a real iframe
// sandbox that pumps postMessage frames at ~30fps — cheap for one, but a long
// catalog grid can have dozens of visualizer cards, and Chromium has real
// limits on how many WebGL/animation contexts stay smooth at once. The cap is
// the part that can melt a laptop, so it's a `Set`-backed counter extracted to
// a pure module and tested directly, rather than a ref threaded through
// `LivePreview` instances that no test could reach — same shape as
// `previewCache.ts`'s `loadPreview`: a tested pure decision, with a real
// effect (mounting/unmounting a sandbox) layered on top by the component.
//
// `createPreviewBudget()` is the tested factory (each test gets an isolated
// budget). The app itself consumes the single `previewBudget` instance below
// so every `LivePreview` on screen shares one real cap of `PREVIEW_CONCURRENCY`.
// ─────────────────────────────────────────────────────────────────────────────

export const PREVIEW_CONCURRENCY = 6;

export interface PreviewBudget {
  /** Claims a slot for `key`. Returns `true` if the caller now holds one —
   *  either a fresh grant, or because `key` already held one (re-acquiring
   *  your own key is always a no-op success, never a second slot; this is
   *  what makes the call safe to make again from an effect that re-runs
   *  without an intervening `release`). Returns `false` when the cap is
   *  already full — the caller must render its fallback instead. */
  acquire(key: string): boolean;
  /** Frees `key`'s slot, if it holds one. A `key` that never acquired (or
   *  already released) is a no-op — callers don't need to track whether they
   *  actually hold a slot before calling this. */
  release(key: string): void;
  /** Current number of held slots, for tests and diagnostics. */
  active(): number;
}

export function createPreviewBudget(): PreviewBudget {
  const held = new Set<string>();
  return {
    acquire(key: string): boolean {
      if (held.has(key)) return true;
      if (held.size >= PREVIEW_CONCURRENCY) return false;
      held.add(key);
      return true;
    },
    release(key: string): void {
      held.delete(key);
    },
    active(): number {
      return held.size;
    },
  };
}

/** The one budget the whole catalog grid shares — every `LivePreview`
 *  instance acquires/releases against this same object, which is what makes
 *  `PREVIEW_CONCURRENCY` a real cross-card cap rather than a per-card limit. */
export const previewBudget: PreviewBudget = createPreviewBudget();

import { useCallback, useEffect, useId, useRef, useState, type MutableRefObject, type ReactNode } from 'react';
import type { SpectrumState } from '../state/tauri';
import { SandboxVizSurface, type ScriptError } from './viz-sandbox-surface';
import { previewBudget } from './previewBudget';

// ─────────────────────────────────────────────────────────────────────────────
// A catalog card's `live` preview treatment (spec C §6, task 7): the real
// sandbox surface (`viz-sandbox-surface.tsx`), mounted at card size, reacting
// to whatever is actually playing. This is the most visible feature in the
// previews plan and also the one that can melt a laptop, so every mount is
// gated by three independent things, any one of which renders `fallback`
// instead:
//
//   1. Viewport intersection (`IntersectionObserver`) — a long catalog grid
//      can list dozens of visualizers; only the ones actually on screen mount
//      a sandbox.
//   2. The shared `previewBudget` (`previewBudget.ts`) — a hard cap of
//      `PREVIEW_CONCURRENCY` sandboxes across the WHOLE catalog grid, not per
//      card, so scrolling through the list never leaves more than that many
//      iframes alive at once.
//   3. `erroredRef` — a bundle that throws every frame must not spin. One
//      error and this card never tries again, even if it scrolls out and
//      back in.
//
// `hub://window-visibility` is Tauri's tray-hide signal (wry never flips
// `document.visibilityState` on a Win32 parent-window hide — see
// `state/framePace.ts`'s `isWindowHidden` for the main hero surface's version
// of this). Rather than duplicating that module-level flag (which would
// throttle the MAIN surface too — it's a single shared flag), this component
// listens for the same event directly and flips `SandboxVizSurface`'s own
// `paused` prop, which already stops the frame feed without tearing the
// sandbox down — exactly mirroring what the hero surface's `useAnimateGate`
// does with its `paused` param.
// ─────────────────────────────────────────────────────────────────────────────

/** Frame-rate ceiling for a card preview — well below the main surface's cap,
 *  since up to `PREVIEW_CONCURRENCY` of these can be animating at once. Passed
 *  as `SandboxVizSurface`'s new `maxFps` prop, which paces on top of (not
 *  instead of) the existing global cap, so this never speeds anything up. */
const PREVIEW_MAX_FPS = 30;

export function LivePreview({
  bundleId, accent, accent2, spectrumRef, fallback,
}: {
  bundleId: string;
  accent: string;
  accent2: string;
  spectrumRef?: MutableRefObject<SpectrumState>;
  /** What renders instead of the sandbox: off-screen, budget exhausted, or
   *  errored. Passed in by `CatalogCard`, which already computes this glyph/
   *  letter block for the other three preview treatments. */
  fallback: ReactNode;
}) {
  // Stable per-mount identity for the budget map's key. `useId` (not a random
  // UUID) because it's guaranteed stable across a component instance's whole
  // lifetime, including React 18 StrictMode's double-invoked effects — so an
  // effect that re-runs without an intervening unmount re-acquires the SAME
  // key, which `previewBudget.acquire` treats as a no-op success rather than
  // a second slot (see its test 3).
  const key = useId();
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [intersecting, setIntersecting] = useState(false);
  const [hasSlot, setHasSlot] = useState(false);
  const [errored, setErrored] = useState(false);
  const [hidden, setHidden] = useState(false);
  const erroredRef = useRef(false);
  const heldRef = useRef(false);

  // Viewport gating. Unobserve (not just disconnect) on unmount, per the
  // brief — a per-card observer that outlives its element is exactly the
  // kind of leak this task's constraints call out by name.
  useEffect(() => {
    const el = hostRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(
      (entries) => setIntersecting(entries[entries.length - 1]?.isIntersecting ?? false),
      { threshold: 0.01 },
    );
    io.observe(el);
    return () => {
      io.unobserve(el);
      io.disconnect();
    };
  }, []);

  // Budget: acquire on entering the viewport, release on leaving it. Errored
  // cards never ask again — `erroredRef` short-circuits before `acquire`.
  useEffect(() => {
    if (erroredRef.current) return;
    if (!intersecting) {
      if (heldRef.current) {
        previewBudget.release(key);
        heldRef.current = false;
        setHasSlot(false);
      }
      return;
    }
    const got = previewBudget.acquire(key);
    heldRef.current = got;
    setHasSlot(got);
  }, [intersecting, key]);

  // Release on every teardown path this effect doesn't already cover —
  // unmount while still intersecting (e.g. the whole grid unmounts, so the
  // "scrolled out" branch above never runs).
  useEffect(() => () => {
    if (heldRef.current) {
      previewBudget.release(key);
      heldRef.current = false;
    }
  }, [key]);

  // hub://window-visibility — pauses the frame feed (not the mount) while
  // the window is hidden to tray, same as the main hero surface.
  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    (async () => {
      try {
        const { listen } = await import('@tauri-apps/api/event');
        const un = await listen<boolean>('hub://window-visibility', (e) => {
          if (!cancelled) setHidden(!e.payload);
        });
        if (cancelled) un();
        else unlisten = un;
      } catch {
        /* browser dev — no tauri */
      }
    })();
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  const onError = useCallback((error: ScriptError) => {
    // SandboxVizSurface also calls this with `null` on every mount/reload to
    // clear a stale banner — only a real error trips the never-retry gate.
    if (!error || erroredRef.current) return;
    erroredRef.current = true;
    setErrored(true);
    if (heldRef.current) {
      previewBudget.release(key);
      heldRef.current = false;
      setHasSlot(false);
    }
  }, [key]);

  const showLive = intersecting && hasSlot && !errored;

  return (
    <div ref={hostRef} style={{ position: 'relative', width: '100%', height: '100%' }}>
      {showLive ? (
        <SandboxVizSurface
          bundleId={bundleId}
          accent={accent}
          accent2={accent2}
          spectrumRef={spectrumRef}
          paused={hidden}
          maxFps={PREVIEW_MAX_FPS}
          suppressErrorBanner
          onError={onError}
        />
      ) : fallback}
    </div>
  );
}

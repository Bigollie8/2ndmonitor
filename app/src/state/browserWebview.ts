import { useEffect, useRef, useState } from 'react';
import { Webview } from '@tauri-apps/api/webview';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { isTauri } from './tauri';
import { LogicalPosition, LogicalSize } from '@tauri-apps/api/dpi';

interface UseBrowserWebviewArgs {
  /** True iff a webview should currently exist (videoEnabled && currentUrl !== null && !suppress). */
  enabled: boolean;
  /** URL to load. URL changes destroy + recreate the webview (no JS eval available
   *  in Tauri 2.1 — see plan Task 3 amendment). */
  url: string | null;
  /** Viewport-pixel rect from the placeholder div. The hook reads it at create time
   *  via a ref so changes in rect VALUE don't thrash the create effect. The Task 4
   *  reposition effect handles value changes. */
  bounds: DOMRect | null;
}

export interface UseBrowserWebviewResult {
  /** Last create error, if any. UI uses this to show "Browser unavailable". */
  error: string | null;
}

const WEBVIEW_LABEL = 'browser-tile';

/** Logs `close()` failures unless they're the benign "already closed" path. */
function logCloseError(e: unknown) {
  const msg = String(e);
  // Tauri 2 surfaces "not found" / "label not found" when the webview is
  // already gone — that's the idempotent-close case we expect.
  if (msg.includes('not found')) return;
  console.warn('[browserWebview] close failed:', msg);
}

/** Manages the lifecycle of a single Tauri child webview pinned to the viz tile.
 *
 *  Lifecycle:
 *  - When `enabled && url && bounds !== null` and no existing webview → create.
 *  - When `enabled` flips off, `url` changes, or bounds becomes null → destroy
 *    any existing webview. The next render will recreate if conditions are met.
 *  - Bounds VALUE changes do NOT trigger this effect — only null↔non-null
 *    transitions do (via `boundsAvailable`). Reposition is handled in Task 4.
 *
 *  The destroy + recreate strategy substitutes for the eval-based navigate that
 *  Tauri 2.1's JS Webview does not support. */
export function useBrowserWebview(args: UseBrowserWebviewArgs): UseBrowserWebviewResult {
  const { enabled, url, bounds } = args;
  const webviewRef = useRef<Webview | null>(null);
  const boundsRef = useRef<DOMRect | null>(bounds);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Keep boundsRef pointing at the latest measurement. The create effect reads
  // it but doesn't take `bounds` as a dep (which would thrash on every
  // ResizeObserver callback — DOMRect compares by reference).
  useEffect(() => { boundsRef.current = bounds; }, [bounds]);

  // Boolean derived from bounds — flips on null↔non-null transitions only,
  // not on rect-value changes. The create effect uses this so it re-fires
  // when bounds becomes available (initial mount) but not on subsequent
  // measurements with the same null-ness.
  const boundsAvailable = bounds !== null;

  useEffect(() => {
    // Browser-dev mode (vite without Tauri host) — getCurrentWebviewWindow()
    // throws. Bail before that to keep dev iteration clean.
    if (!isTauri) return;

    let cancelled = false;

    // Tear down any existing webview at the top of every effect run. This
    // handles both URL changes (destroy + recreate) and the destroy-only paths.
    const existing = webviewRef.current;
    if (existing) {
      webviewRef.current = null;
      setReady(false);
    }

    if (!existing && (!enabled || !url || !boundsAvailable)) return;

    (async () => {
      try {
        // AWAIT the close before creating anything (0.8.2). Every webview uses
        // the same constant label, so firing close() and immediately
        // constructing a new Webview with that label races the teardown: the
        // old native webview can be orphaned rather than destroyed, and it
        // keeps its page — a whole Netflix tab — resident. Switching sources
        // repeatedly then stacked those orphans in memory. Serialising the two
        // costs a few ms on a source switch and nothing at all otherwise.
        if (existing) {
          try { await existing.close(); } catch (e) { logCloseError(e); }
        }
        if (cancelled || !enabled || !url || !boundsAvailable) return;

        const initial = boundsRef.current;
        if (!initial) return;  // race: bounds went null between dep eval and async tick

        const win = getCurrentWebviewWindow();
        const wv = new Webview(win, WEBVIEW_LABEL, {
          url,
          x: Math.round(initial.left),
          y: Math.round(initial.top),
          width: Math.round(initial.width),
          height: Math.round(initial.height),
        });

        // wv.once() returns Promise<UnlistenFn> that resolves on REGISTRATION,
        // not on event fire. Wrap in an explicit Promise so the outer await
        // actually waits for the native handle to be ready before declaring
        // setReady — Task 4's reposition effect needs this guarantee.
        await new Promise<void>((resolve) => {
          wv.once('tauri://created', () => resolve());
        });

        if (cancelled) {
          await wv.close().catch(logCloseError);
          return;
        }
        webviewRef.current = wv;
        setReady(true);
        setError(null);
      } catch (e: unknown) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();

    return () => {
      cancelled = true;
      const wv = webviewRef.current;
      webviewRef.current = null;
      setReady(false);
      if (wv) wv.close().catch(logCloseError);
    };
  }, [enabled, url, boundsAvailable]);

  // Reposition / resize whenever bounds change. rAF-debounced so dragging the
  // tile in edit mode or a rapid window resize doesn't queue dozens of IPC
  // calls. We only fire when both a webview exists (`ready` is set after the
  // native handle is real — see Task 3) and bounds is non-null.
  useEffect(() => {
    if (!ready || !bounds) return;
    const wv = webviewRef.current;
    if (!wv) return;
    const raf = requestAnimationFrame(() => {
      const x = Math.round(bounds.left);
      const y = Math.round(bounds.top);
      const w = Math.round(bounds.width);
      const h = Math.round(bounds.height);
      // wv was captured at effect-run time and may have been closed before
      // this rAF fires (e.g., enabled flipped to false). setPosition/setSize
      // will reject with "not found" in that case — handled below.
      // Fire-and-forget: a failed reposition is recoverable on the next bounds
      // change. setPosition / setSize errors during teardown are expected
      // (webview may have just closed) so silent swallow is appropriate here —
      // unlike close() where a failure can leave a zombie webview.
      Promise.all([
        wv.setPosition(new LogicalPosition(x, y)),
        wv.setSize(new LogicalSize(w, h)),
      ]).catch((e: unknown) => {
        const msg = String(e);
        if (!msg.includes('not found')) {
          console.warn('[browserWebview] reposition failed:', msg);
        }
      });
    });
    return () => cancelAnimationFrame(raf);
  }, [bounds, ready]);

  return { error };
}

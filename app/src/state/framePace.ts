/** Fixed-timestep frame acceptance for FPS-capped rAF loops. The naive
 *  `now - last >= minDelta` gate beats against vsync when the cap is close
 *  to but below the display rate (144Hz vs 120 cap → alternating 7/14ms
 *  gaps). Tracking an absolute deadline and advancing it by exactly
 *  minDelta spreads skips evenly. Pure — exported for unit tests. */
export interface PaceState { nextDue: number }

export function paceFrame(now: number, state: PaceState, minDelta: number): boolean {
  if (now < state.nextDue) return false;
  // More than one interval late (stall, tab hidden): re-anchor to now so we
  // don't accept a burst of frames to "catch up".
  state.nextDue = now - state.nextDue > minDelta ? now + minDelta : state.nextDue + minDelta;
  return true;
}

/** True while the OS-level parent window is hidden (minimized to tray). wry
 *  never flips `document.visibilityState` on a Win32 hide — SetIsVisible(false)
 *  is only called on tab-switch/minimize in browsers, not on a parent-window
 *  hide — so the Rust side emits `hub://window-visibility` explicitly and
 *  App.tsx mirrors it here for the rAF viz gate to read. */
let windowHidden = false;
const visibilityListeners = new Set<() => void>();

export function setWindowHidden(hidden: boolean): void {
  if (windowHidden === hidden) return;
  windowHidden = hidden;
  for (const listener of visibilityListeners) listener();
}

export function isWindowHidden(): boolean {
  return windowHidden;
}

/** WebView document visibility alone misses native hide-to-tray. */
export function isAppHidden(): boolean {
  return windowHidden || (typeof document !== 'undefined' && document.hidden);
}

export function subscribeVisibility(listener: () => void): () => void {
  visibilityListeners.add(listener);
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', listener);
  return () => {
    visibilityListeners.delete(listener);
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', listener);
  };
}

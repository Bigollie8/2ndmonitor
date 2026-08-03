/** Whether this build is running on macOS. Drives UI copy/paths that
 *  genuinely differ by OS (preset/visualizer folder hints, a few Settings
 *  strings) — never user-agent sniffing, and never a second platform
 *  mechanism: this reads the same build-time signal Task 3's
 *  `__SANDBOX_ORIGIN__` uses (see vite.config.ts's `define` block).
 *
 *  The `typeof __IS_MAC__ !== 'undefined'` guard + `process.platform`
 *  fallback mirrors sandbox-html.ts's `SANDBOX_ORIGIN` exactly, and for the
 *  same reason: `tsx` (which runs `npm test` and `gen:sandbox`) does not
 *  evaluate Vite's `define`, so a bare `__IS_MAC__` reference would throw
 *  `ReferenceError` there. Centralizing the guard here means every call site
 *  imports one resolved boolean instead of repeating the `typeof` dance. */
export const IS_MAC: boolean =
  typeof __IS_MAC__ !== 'undefined'
    ? __IS_MAC__
    : (globalThis as { process?: { platform?: string } }).process?.platform === 'darwin';

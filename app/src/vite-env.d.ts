/// <reference types="vite/client" />

// Injected by vite.config.ts's `define`. See sandbox-html.ts for what this
// resolves to on each platform.
declare const __SANDBOX_ORIGIN__: string;

// Injected by vite.config.ts's `define`. See state/platform.ts for the one
// place that resolves this safely under `tsx` too (which does not evaluate
// Vite's `define`).
declare const __IS_MAC__: boolean;
/** App version from package.json, injected at build time (0.8.3). */
declare const __APP_VERSION__: string;

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// This project has no @types/node (tsconfig.node.json's "include" is just
// this file, no "types": ["node"]), so `process` is not an ambiently typed
// global here even though it's a real Node global at config-eval time. A
// minimal ambient declaration avoids adding a devDependency just for one
// field read. `tsc -b` (part of `npm run build`) type-checks this file even
// though `npx tsc --noEmit` at the repo root does not (its tsconfig.json
// only includes "src").
declare const process: { platform?: string } | undefined;

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: { ignored: ['**/src-tauri/**'] },
  },
  envPrefix: ['VITE_', 'TAURI_ENV_*'],
  build: {
    target: 'chrome105',
    minify: 'esbuild',
  },
  define: {
    // Which form wry gives the custom scheme. Windows/WebView2 cannot register
    // a non-standard scheme, so wry rewrites it to http://<scheme>.localhost;
    // macOS/WKWebView uses the real scheme. Build-time because every call site
    // is synchronous and an async platform lookup would force a refactor.
    __SANDBOX_ORIGIN__: JSON.stringify(
      process?.platform === 'darwin' ? 'vizsandbox://localhost' : 'http://vizsandbox.localhost',
    ),
  },
});

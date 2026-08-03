// ─────────────────────────────────────────────────────────────────────────────
// Sandbox iframe document for scripted visualizers.
//
// Isolation model (phase-3 marketplace tiles reuse this exact runtime):
//   - iframe attribute `sandbox="allow-scripts"` — no allow-same-origin, so
//     the frame runs in an opaque origin: no cookies, no storage, no Tauri
//     bridge, and window.parent property access throws.
//   - CSP `default-src 'none'` — even if user code builds a URL, fetch/XHR/
//     <img>/<script src> all die at the policy layer. Only inline script and
//     style (the shim itself + user code via new Function) are allowed.
//   - The ONLY channel in or out is postMessage (see manifest.ts protocol).
//
// DELIVERY: this document is served by a Rust custom-URI-scheme protocol
// (see src-tauri/src/sandbox.rs) and loaded via the iframe's `src`, NOT via
// `srcdoc`. That is load-bearing, not cosmetic:
//
//   `about:srcdoc` (like about:blank, blob: and data:) is a *local scheme*:
//   per CSP spec its policy container is INHERITED from the embedder, and
//   multiple policies combine by intersection. In a packaged build Tauri
//   injects `script-src 'self'` on the app document, so inside a srcdoc
//   frame the effective policy became 'self' ∩ ('unsafe-inline'
//   'unsafe-eval') = nothing, and the inline runtime shim below never
//   executed at all. `tauri dev` hid this completely (Tauri injects no CSP
//   against a Vite-served document), so every scripted visualizer was dead
//   in every packaged build the project ever produced and alive in dev.
//
//   A document fetched from a real URL does not inherit the embedder's
//   policy container — it gets exactly the `Content-Security-Policy` header
//   its own response carries. Hence the protocol handler, which serves this
//   HTML with SANDBOX_CSP as a real header. The iframe keeps
//   sandbox="allow-scripts" (no allow-same-origin), so it is still an
//   opaque origin: a real `src` does not change that.
// ─────────────────────────────────────────────────────────────────────────────

import { BINS_SHIM_SRC, CLAMP_SHIM_SRC } from './bins';

export const SANDBOX_ATTR = 'allow-scripts';

/** Custom URI scheme registered in Rust (src-tauri/src/sandbox.rs). Must stay
 *  a single valid hostname label: on Windows/Android wry cannot register a
 *  non-standard scheme with WebView2 at all, so it rewrites custom protocols
 *  to `http://<scheme>.localhost/...` and intercepts them with a
 *  WebResourceRequested filter (wry-0.54.4 src/custom_protocol_workaround.rs
 *  + src/webview2/mod.rs::attach_custom_protocol_handler). */
export const SANDBOX_SCHEME = 'vizsandbox';

/** The frame's real origin, as the platform webview sees it. This value must
 *  also appear in the `frame-src` list in src-tauri/tauri.conf.json — the
 *  app's own CSP otherwise blocks the frame from loading. A test below pins
 *  the two together.
 *
 *  Resolved at build time (see `__SANDBOX_ORIGIN__` in vite.config.ts), since
 *  every call site here is synchronous: Windows/WebView2 cannot register a
 *  non-standard scheme, so wry rewrites it to `http://${SANDBOX_SCHEME}.localhost`;
 *  macOS/WKWebView uses the real scheme, `${SANDBOX_SCHEME}://localhost`.
 *  Each release leg builds its own bundle on its own runner, so a single
 *  static per-build value is enough — no runtime platform branch needed.
 *  tauri.conf.json's CSP lists both forms so one static string satisfies
 *  every platform's build.
 *
 *  The fallback below only matters outside a Vite build: `npm run
 *  gen:sandbox` and `npm test` both load this module directly under `tsx`,
 *  which does not evaluate Vite's `define`, so `__SANDBOX_ORIGIN__` is an
 *  undeclared global there. In that case fall back to the same check
 *  vite.config.ts does, so there is exactly one platform rule, expressed
 *  twice for two different toolchains rather than duplicated by accident. */
export const SANDBOX_ORIGIN: string =
  typeof __SANDBOX_ORIGIN__ !== 'undefined'
    ? __SANDBOX_ORIGIN__
    : (globalThis as { process?: { platform?: string } }).process?.platform === 'darwin'
      ? 'vizsandbox://localhost'
      : `http://${SANDBOX_SCHEME}.localhost`;

/** What the iframe's `src` points at. Any path works — the protocol handler
 *  serves the same static document for every path — but a stable one keeps
 *  the WebView2 cache and any devtools inspection predictable. */
export const SANDBOX_SRC = `${SANDBOX_ORIGIN}/index.html`;
// 'unsafe-eval' is required for the `new Function(msg.code)()` call below that
// runs the bundle's own top-level code — see the isolation-model comment
// above, which already documented "user code via new Function" as the
// intended mechanism. Without it, Chromium/WebView2 throws an EvalError on
// EVERY `new Function`/`eval` call, so no scripted visualizer (marketplace
// bundle OR the Scripted authoring surface) ever actually draws anything —
// found 2026-07-30 verifying task 7 (live catalog-card previews): a fresh
// mount silently sat on the canvas's plain `#000` CSS background forever,
// indistinguishable from "drawing something very dark" until the sandbox's
// own error banner was inspected. `allow-scripts` (no `allow-same-origin`)
// already gives the frame an opaque origin — no cookies, storage, or Tauri
// bridge — so this does not widen that isolation boundary; it only lets the
// already-documented, already-intended in-sandbox eval actually run.
//
// This is the BASE policy. The Rust handler appends `frame-ancestors` naming
// the embedder (src-tauri/src/sandbox.rs::csp_with_ancestors) — it can't live
// here because the embedder's origin differs between `tauri dev` and a
// packaged build, and because `frame-ancestors` is ignored in a <meta> tag
// anyway. Without it anything may frame the sandbox, including an arbitrary
// remote page mounted as a webtile child webview.
export const SANDBOX_CSP = "default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval'; style-src 'unsafe-inline'";

/** The runtime shim. Kept as a plain string (not a bundled module) so the
 *  served document is fully self-contained and inspectable. See manifest.ts
 *  for the message shapes. */
const RUNTIME = String.raw`
'use strict';
// Proof that this document came from the Rust protocol handler. The handler
// substitutes a per-process random value for the placeholder below on every
// response, and the host refuses to init a frame whose 'ready' does not echo
// the value it fetched over IPC (sandbox_token).
//
// The threat is not theoretical. wry can only intercept a SUB-FRAME request
// for a custom protocol when ICoreWebView2_22 is available; without it
// (wry-0.54.4 src/webview2/mod.rs:941-950) it falls back to
// AddWebResourceRequestedFilter, which defaults to the DOCUMENT source kind
// and never sees this iframe's request. That fails OPEN, not closed:
// Chromium resolves any *.localhost name to loopback, so the frame issues a
// real GET to 127.0.0.1 on port 80 and whatever is listening there answers.
// Such a document passes both host-side checks - it is the real
// iframe.contentWindow, and it is still opaque-origin ("null") because the
// sandbox attribute belongs to the iframe, not the document - while carrying
// no default-src 'none'. Without this token it would get an installed
// bundle's source code posted to it and could write arbitrary
// scripted.settings.<id> keys. A local server cannot know this value.
//
// Captured into a local before any bundle code runs. Bundle code sharing the
// frame can read it, which is fine: it is already inside the frame the token
// identifies, so it gains nothing.
var __sbToken = '__SANDBOX_TOKEN__';
// Cosmetic tidy-up, NOT a boundary - do not read it as one.
//
// WebView2 has no per-frame option for AddScriptToExecuteOnDocumentCreated
// (wry-0.54.4 src/webview2/mod.rs), so Tauri's initialization scripts run in
// EVERY frame regardless of the for_main_frame_only flag it sets. This frame
// therefore starts with window.__TAURI_INTERNALS__, window.isTauri and
// window.chrome.webview defined; chrome.webview is the transport
// __TAURI_INTERNALS__.invoke posts through, and it is the only one of the
// three that is configurable.
//
// It is bypassed in five lines, and NOT across an origin boundary: a nested
// about:srcdoc frame performs no fetch, so frame-src (<- default-src 'none')
// never applies to it; it inherits this document's script-src
// 'unsafe-inline', receives its own fresh chrome.webview from the same wry
// injection, can issue the IPC call itself and relay the result back here by
// postMessage. So this deletes a convenience, not a capability.
//
// What actually holds the line today is that
// ICoreWebView2::WebMessageReceived fires only for the main frame, so a
// sub-frame's IPC never reaches Rust at all (verified in the packaged build:
// secret_set from here left the store untouched while the same call from the
// main frame wrote it) - plus the opaque origin and the empty
// BROKER_COMMANDS. If that WebView2 behaviour ever changed, Tauri's
// is_local_url (tauri-2.10.3 src/webview/mod.rs) would classify this frame's
// custom-scheme URL as Origin::Local and hand it the main window's full
// command surface; this line would not stop that. Fixing it properly is
// upstream.
try { if (window.chrome) { delete window.chrome.webview; } } catch (e) { /* already gone */ }
` + BINS_SHIM_SRC + CLAMP_SHIM_SRC + String.raw`
var frameCbs = [];
var dataCbs = [];
var settingsCache = {};
var lastErrorAt = 0;
var canvas = document.getElementById('c');
var root = document.getElementById('root');
var ctx2d = null;
var userGotContext = false;
var lastSpectrum = null;
var binCache = {};

// Broker RPC: requests go up as {type:'rpc', rpcId, rpc, ...}; the host
// consults the installed manifest's permissions and answers with
// {type:'rpc:result', rpcId, ok, value|error}. Undeclared capabilities are
// denied host-side — nothing here grants anything.
var rpcSeq = 0;
var rpcPending = {};
function rpc(payload) {
  return new Promise(function (resolve, reject) {
    var rpcId = ++rpcSeq;
    rpcPending[rpcId] = { resolve: resolve, reject: reject };
    payload.type = 'rpc';
    payload.rpcId = rpcId;
    parent.postMessage(payload, '*');
  });
}

// The API surface user code sees. Frozen so scripts can't confuse each other
// across hot reloads by monkey-patching.
var viz = Object.freeze({
  canvas: canvas,
  root: root,
  bins: function (n) {
    var count = __clampBinCount(n);
    if (!binCache[count]) binCache[count] = new Float32Array(count);
    return __resample(lastSpectrum, count, binCache[count]);
  },
  on: function (name, cb) {
    if (name === 'frame' && typeof cb === 'function') frameCbs.push(cb);
    if (name === 'data' && typeof cb === 'function') dataCbs.push(cb);
  },
  // First-party payload channel to the embedder. Marketplace bundles can call
  // this too, but the host only listens when a surface passed an onData
  // callback - and only the builtin milkdrop surface does - so for bundles it
  // is a no-op, not a capability.
  post: function (payload) { parent.postMessage({ type: 'data', payload: payload }, '*'); },
  settings: Object.freeze({
    get: function (key) { return settingsCache[key]; },
    set: function (key, value) {
      settingsCache[key] = value;
      parent.postMessage({ type: 'settings:set', key: key, value: value }, '*');
    },
  }),
  net: Object.freeze({
    fetch: function (url) { return rpc({ rpc: 'net.fetch', url: String(url) }); },
  }),
  tauri: Object.freeze({
    invoke: function (command, args) {
      return rpc({ rpc: 'tauri.invoke', command: String(command), args: args });
    },
  }),
});
// Expose for user code (new Function scope sees globals only).
window.viz = viz;

function reportError(e) {
  var now = Date.now();
  if (now - lastErrorAt < 1000) return; // throttle per-frame error spam
  lastErrorAt = now;
  var line = null;
  if (e && e.stack) {
    var m = /<anonymous>:(\d+):/.exec(e.stack);
    if (m) line = Math.max(1, parseInt(m[1], 10) - 2); // new Function wraps in 2 header lines
  }
  parent.postMessage({ type: 'error', message: String(e && e.message ? e.message : e), line: line }, '*');
}

window.addEventListener('error', function (ev) { reportError(ev.error || ev.message); });

function applySize(size) {
  if (!size) return;
  if (canvas.width !== size.width) canvas.width = size.width;
  if (canvas.height !== size.height) canvas.height = size.height;
}

window.addEventListener('message', function (ev) {
  // Only the embedder drives this runtime. Deliberately a SOURCE check, not
  // an origin check: this document is sandboxed without allow-same-origin,
  // so nothing that does not already hold a handle to it can reach it, and
  // the host origin differs between dev (the Vite dev server) and a packaged
  // build (the tauri asset origin) - a static document cannot hardcode it.
  // parent is exactly one window and is not forgeable from script elsewhere.
  //
  // The parent === window arm is not redundant: at top level parent IS
  // window, so the source check alone would be degenerate and a self-post
  // (window.postMessage from anything running in this document) would satisfy
  // it. This document is only ever meant to run framed.
  if (parent === window || ev.source !== parent) return;
  var msg = ev.data || {};
  if (msg.type === 'rpc:result') {
    var pending = rpcPending[msg.rpcId];
    if (pending) {
      delete rpcPending[msg.rpcId];
      if (msg.ok) pending.resolve(msg.value);
      else pending.reject(new Error(msg.error || 'rpc denied'));
    }
  } else if (msg.type === 'init') {
    stopReadyPings();
    frameCbs = [];
    dataCbs = [];
    settingsCache = msg.settings || {};
    applySize(msg.size);
    // Surface selection (I11): the host sends msg.surface (Task 3). Absent
    // means 'canvas', so every existing bundle is unaffected. Clearing root
    // stops a hot reload from stacking two renders on top of each other; it
    // does NOT fix the wider realm-contamination issue (deferred-findings.md
    // item 10) — stray timers/rAFs from the previous load still survive.
    var useDom = msg.surface === 'dom';
    canvas.hidden = useDom;
    root.hidden = !useDom;
    root.textContent = '';
    try {
      new Function(msg.code)();
    } catch (e) {
      reportError(e);
    }
  } else if (msg.type === 'frame') {
    applySize(msg.size);
    if (!frameCbs.length) return;
    // Lazily grab a 2D context unless user code already took webgl/webgl2.
    if (!ctx2d && !userGotContext) {
      try { ctx2d = canvas.getContext('2d'); } catch (e) { /* user took webgl */ }
      userGotContext = true;
    }
    lastSpectrum = msg.spectrum;
    var payload = {
      ctx: ctx2d,
      spectrum: msg.spectrum,
      waveform: msg.waveform,
      bands: msg.bands,
      onset: msg.onset,
      level: msg.level,
      dt: msg.dt,
      size: msg.size,
      theme: msg.theme,
      track: msg.track,
      playback: msg.playback || null,
    };
    for (var i = 0; i < frameCbs.length; i++) {
      try { frameCbs[i](payload); } catch (e) { reportError(e); }
    }
  } else if (msg.type === 'data') {
    for (var i = 0; i < dataCbs.length; i++) {
      try { dataCbs[i](msg.payload); } catch (e) { reportError(e); }
    }
  }
});

// Announce readiness LEVEL-triggered, not edge-triggered: keep re-posting
// until the host answers with an 'init'.
//
// A single 'ready' has to be caught by exactly one listener attached at
// exactly the right moment. It is not: React StrictMode double-invokes
// effects, the host's listener is torn down and re-attached across renders,
// and the host also needs an async round trip (invoke('sandbox_token'), and
// invoke('visualizers_read') for the code itself) before it can act on
// 'ready' at all - so the message can perfectly well arrive before the host
// is able to use it. Re-posting makes the handshake immune to that ordering
// instead of relying on it, which is the whole reason a scripted visualizer
// never came up under 'tauri dev'.
//
// The host ignores repeats (its 'ready' branch is idempotent), and the pings
// stop on the first 'init'. The attempt cap only stops a frame that the host
// has abandoned - e.g. its code load failed - from pinging forever; by then
// the host has long since recorded readiness, so a later reload still works.
var readyTimer = 0;
var readyTries = 0;
function postReady() { parent.postMessage({ type: 'ready', token: __sbToken }, '*'); }
function stopReadyPings() {
  if (readyTimer) { clearInterval(readyTimer); readyTimer = 0; }
}
postReady();
readyTimer = setInterval(function () {
  postReady();
  if (++readyTries >= 60) stopReadyPings();
}, 250);
`;

/** The sandbox document. Fully static — the bundle's code arrives later over
 *  postMessage `init`, never baked in — so the Rust protocol handler can serve
 *  one fixed byte string for every instance and every visualizer.
 *
 *  This is the single source of truth. `npm run gen:sandbox` (run
 *  automatically by `predev`/`prebuild`) writes the result to
 *  src-tauri/sandbox.html, which sandbox.rs `include_str!`s; the generated
 *  file is committed and a test below fails if it drifts from this function.
 *
 *  The `<meta>` CSP is kept alongside the response header: the header is what
 *  actually matters now (meta in a srcdoc frame was the thing that never
 *  worked), but two identical policies intersect to the same policy, so it
 *  costs nothing and keeps the document self-describing if it is ever read
 *  outside the protocol handler. It carries only the base policy — the
 *  header's `frame-ancestors` has no effect in a `<meta>` tag by spec.
 *
 *  `__SANDBOX_TOKEN__` is a placeholder the Rust handler substitutes per
 *  response; the committed artifact keeps it verbatim. */
export function buildSandboxHtml(): string {
  return [
    '<!doctype html>',
    '<html><head>',
    `<meta http-equiv="Content-Security-Policy" content="${SANDBOX_CSP}">`,
    '<style>html,body{margin:0;padding:0;background:#000;overflow:hidden;width:100%;height:100%}\ncanvas,#root{display:block;width:100%;height:100%}\n#root{position:absolute;inset:0}\ncanvas[hidden],#root[hidden]{display:none}</style>',
    '</head><body>',
    '<canvas id="c"></canvas>',
    '<div id="root"></div>',
    `<script>${RUNTIME}</script>`,
    '</body></html>',
  ].join('\n');
}

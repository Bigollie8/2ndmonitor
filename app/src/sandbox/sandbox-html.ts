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

/** The frame's real origin, as WebView2 sees it. This exact string must also
 *  appear as the `frame-src` value in src-tauri/tauri.conf.json — the app's
 *  own CSP otherwise blocks the frame from loading. A test below pins the two
 *  together.
 *
 *  Windows form. macOS/Linux would be `vizsandbox://localhost`; the bundle
 *  targets only `nsis`, and tauri.conf.json's CSP is a static string that can
 *  encode exactly one form, so this is deliberately the Windows one. A future
 *  macOS build will see the frame blocked by frame-src — loudly, in the
 *  console — rather than silently misbehave. */
export const SANDBOX_ORIGIN = `http://${SANDBOX_SCHEME}.localhost`;

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
export const SANDBOX_CSP = "default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval'; style-src 'unsafe-inline'";

/** The runtime shim. Kept as a plain string (not a bundled module) so the
 *  served document is fully self-contained and inspectable. See manifest.ts
 *  for the message shapes. */
const RUNTIME = String.raw`
'use strict';
// Drop the WebView2 host-message transport before any bundle code can see it.
//
// WebView2 has no per-frame option for AddScriptToExecuteOnDocumentCreated
// (wry-0.54.4 src/webview2/mod.rs), so Tauri's initialization scripts run in
// EVERY frame regardless of the for_main_frame_only flag it sets. This frame
// therefore starts with window.__TAURI_INTERNALS__, window.isTauri and
// window.chrome.webview defined. Those are all non-configurable except
// chrome.webview, which is the one that actually matters: it is the transport
// __TAURI_INTERNALS__.invoke posts through. Deleting it makes invoke throw.
//
// This is defence in depth, not the boundary. Two facts, both verified in the
// packaged build (task-7b): (1) ICoreWebView2::WebMessageReceived fires only
// for the main frame, so a sub-frame's postMessage never reaches Rust at all
// - a secret_set invoked from here left the store untouched while the same
// call from the main frame wrote it; (2) if that ever changed, Tauri's
// is_local_url (tauri-2.10.3 src/webview/mod.rs) classifies ANY registered
// custom-scheme URL as Origin::Local on Windows, including this frame's - so
// the ACL would grant it the main window's full command surface. (1) is an
// implementation detail of the current WebView2; this delete is what stops
// (2) from becoming reachable if (1) ever stops holding. It is not airtight:
// a nested about:blank iframe would get a fresh chrome.webview, so treat the
// opaque origin and the empty BROKER_COMMANDS as the real boundary.
try { if (window.chrome) { delete window.chrome.webview; } } catch (e) { /* already gone */ }
` + BINS_SHIM_SRC + CLAMP_SHIM_SRC + String.raw`
var frameCbs = [];
var settingsCache = {};
var lastErrorAt = 0;
var canvas = document.getElementById('c');
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
  bins: function (n) {
    var count = __clampBinCount(n);
    if (!binCache[count]) binCache[count] = new Float32Array(count);
    return __resample(lastSpectrum, count, binCache[count]);
  },
  on: function (name, cb) {
    if (name === 'frame' && typeof cb === 'function') frameCbs.push(cb);
  },
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
  if (ev.source !== parent) return;
  var msg = ev.data || {};
  if (msg.type === 'rpc:result') {
    var pending = rpcPending[msg.rpcId];
    if (pending) {
      delete rpcPending[msg.rpcId];
      if (msg.ok) pending.resolve(msg.value);
      else pending.reject(new Error(msg.error || 'rpc denied'));
    }
  } else if (msg.type === 'init') {
    frameCbs = [];
    settingsCache = msg.settings || {};
    applySize(msg.size);
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
  }
});

parent.postMessage({ type: 'ready' }, '*');
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
 *  outside the protocol handler. */
export function buildSandboxHtml(): string {
  return [
    '<!doctype html>',
    '<html><head>',
    `<meta http-equiv="Content-Security-Policy" content="${SANDBOX_CSP}">`,
    '<style>html,body{margin:0;padding:0;background:#000;overflow:hidden;width:100%;height:100%}canvas{display:block;width:100%;height:100%}</style>',
    '</head><body>',
    '<canvas id="c"></canvas>',
    `<script>${RUNTIME}</script>`,
    '</body></html>',
  ].join('\n');
}

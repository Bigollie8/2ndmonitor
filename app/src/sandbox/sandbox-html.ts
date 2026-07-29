// ─────────────────────────────────────────────────────────────────────────────
// Sandbox iframe srcdoc for scripted visualizers.
//
// Isolation model (phase-3 marketplace tiles reuse this exact runtime):
//   - iframe attribute `sandbox="allow-scripts"` — no allow-same-origin, so
//     the frame runs in an opaque origin: no cookies, no storage, no Tauri
//     bridge, and window.parent property access throws.
//   - CSP `default-src 'none'` — even if user code builds a URL, fetch/XHR/
//     <img>/<script src> all die at the policy layer. Only inline script and
//     style (the shim itself + user code via new Function) are allowed.
//   - The ONLY channel in or out is postMessage (see manifest.ts protocol).
// ─────────────────────────────────────────────────────────────────────────────

export const SANDBOX_ATTR = 'allow-scripts';
export const SANDBOX_CSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'";

/** The runtime shim. Kept as a plain string (not a bundled module) so the
 *  srcdoc is fully self-contained and inspectable. See manifest.ts for the
 *  message shapes. */
const RUNTIME = String.raw`
'use strict';
var frameCbs = [];
var settingsCache = {};
var lastErrorAt = 0;
var canvas = document.getElementById('c');
var ctx2d = null;
var userGotContext = false;

// The API surface user code sees. Frozen so scripts can't confuse each other
// across hot reloads by monkey-patching.
var viz = Object.freeze({
  canvas: canvas,
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
  var msg = ev.data || {};
  if (msg.type === 'init') {
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
    };
    for (var i = 0; i < frameCbs.length; i++) {
      try { frameCbs[i](payload); } catch (e) { reportError(e); }
    }
  }
});

parent.postMessage({ type: 'ready' }, '*');
`;

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

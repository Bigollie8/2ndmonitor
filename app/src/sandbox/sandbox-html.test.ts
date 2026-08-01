import test from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  buildSandboxHtml, SANDBOX_ATTR, SANDBOX_CSP,
  SANDBOX_ORIGIN, SANDBOX_SCHEME, SANDBOX_SRC,
} from './sandbox-html';

const repoApp = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const readApp = (...p: string[]) => readFileSync(join(repoApp, ...p), 'utf8');
// The generator writes LF; git may hand it back CRLF on a Windows checkout.
const lf = (s: string) => s.replace(/\r\n/g, '\n');

test('sandbox attribute grants scripts only', () => {
  assert.equal(SANDBOX_ATTR, 'allow-scripts');
});

test('srcdoc pins the no-capability CSP', () => {
  const html = buildSandboxHtml();
  assert.ok(html.includes(`<meta http-equiv="Content-Security-Policy" content="${SANDBOX_CSP}">`));
  assert.equal(SANDBOX_CSP, "default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval'; style-src 'unsafe-inline'");
});

// The full-string equality above already pins the exact CSP (so it already
// fails on a narrowing that would break `new Function(msg.code)()`). This
// test instead catches the opposite, more dangerous direction: `script-src`
// silently growing beyond the two documented, no-network-capability tokens —
// e.g. an accidental `'self'`, a wildcard, or a real URL — while the
// full-string equality above happens to get updated to match. `default-src
// 'none'` means script-src is the only meaningful surface here, so this is
// the one directive worth pinning against widening independently.
test('CSP script-src grants no source expressions beyond unsafe-inline/unsafe-eval', () => {
  const scriptSrc = /script-src ([^;]+);/.exec(SANDBOX_CSP)?.[1];
  assert.ok(scriptSrc, 'SANDBOX_CSP must have a script-src directive');
  const tokens = scriptSrc!.trim().split(/\s+/);
  assert.deepEqual(new Set(tokens), new Set(["'unsafe-inline'", "'unsafe-eval'"]));
});

// ── the directive that keeps the sandbox frame off the Tauri command surface ─
// This is NOT just about the frame reaching the network. Read the whole thing
// before relaxing it.
//
// The app ACL grants the sandbox frame everything. It is served from
// http://vizsandbox.localhost, which `is_local_url` (tauri-2.10.3
// src/webview/mod.rs, the Windows custom-protocol arm) classifies as
// Origin::Local, and it lives inside webview label `main` — so it satisfies
// capabilities/app-commands.json exactly. Nothing in the ACL stands between
// `new Function(userCode)()` and all 59 app commands, `secret_get` included.
//
// What actually stops it is this CSP, in this order:
//
//   1. Tauri's PRIMARY IPC transport on Windows is not chrome.webview — it is
//      a fetch: tauri-2.10.3/scripts/ipc-protocol.js sets
//      `canUseCustomProtocol = osName !== 'android'` and does
//      `fetch('http://ipc.localhost/<cmd>')`. wry registers that filter with
//      SOURCE_KINDS_ALL when ICoreWebView2_22 is present
//      (wry-0.54.4 src/webview2/mod.rs:941-947) — which it is, or this frame
//      could not load from a custom scheme at all. Sub-frame IPC requests are
//      therefore intercepted and WOULD reach Rust.
//   2. They do not, because `default-src 'none'` with no `connect-src` kills
//      the fetch at the policy layer before it is ever issued.
//   3. Only then does the shim fall back to window.ipc.postMessage, and only
//      then does WebView2's main-frame-only WebMessageReceived act as backstop.
//
// So adding `connect-src` here — e.g. a reasonable-sounding "let bundles fetch
// their own assets" feature — does not merely widen the frame's network reach.
// It re-enables step 1 and hands an untrusted `new Function` realm the app's
// entire command surface. If bundles need network, that is what the broker
// (`viz.net.fetch` → host-side `brokerDecide` → `broker_fetch`) is for.
test('SANDBOX_CSP grants no connect-src, which is what keeps the frame off the IPC path', () => {
  assert.ok(SANDBOX_CSP.startsWith("default-src 'none'"),
    "default-src 'none' is the fallback every fetch-capable directive inherits");
  assert.ok(!/connect-src/.test(SANDBOX_CSP),
    'a connect-src here would re-enable Tauri\'s fetch-based IPC transport from inside the sandbox frame, which the ACL already grants — see the comment above this test');
  // default-src is the fallback for connect-src, so it must not itself name a
  // source: `default-src https:` would be the same hole by another route.
  const defaultSrc = /default-src ([^;]+)/.exec(SANDBOX_CSP)?.[1].trim();
  assert.equal(defaultSrc, "'none'");
  // The Rust copy is byte-pinned to this one above, so both move together.
});

test('sandbox document references no external origins', () => {
  const html = buildSandboxHtml();
  assert.ok(!/https?:\/\//.test(html), 'sandbox document must not reference http(s) URLs');
});

// ── delivery: served from its own CSP context, not srcdoc ───────────────────
// `about:srcdoc` inherits the embedder's CSP policy container and policies
// combine by intersection, so in a packaged build (Tauri injects script-src
// 'self') the sandbox's 'unsafe-inline'/'unsafe-eval' were cancelled out and
// the runtime shim never executed. These tests pin the three places that must
// agree for the replacement to work: the TS constants, the committed document
// the Rust handler include_str!s, and the app CSP's frame-src.

test('committed src-tauri/sandbox.html matches buildSandboxHtml()', () => {
  // sandbox.rs include_str!s this file at compile time; if it drifts from the
  // source of truth, the packaged app silently ships a stale runtime. Run
  // `npm run gen:sandbox` (predev/prebuild do it automatically).
  const onDisk = lf(readApp('src-tauri', 'sandbox.html'));
  assert.equal(onDisk, lf(buildSandboxHtml()),
    'src-tauri/sandbox.html is stale — run `npm run gen:sandbox`');
});

test('the Rust handler serves the same CSP the TS module declares', () => {
  const rs = readApp('src-tauri', 'src', 'sandbox.rs');
  assert.ok(rs.includes(`"${SANDBOX_CSP}"`),
    'sandbox.rs SANDBOX_CSP must be byte-identical to the TS SANDBOX_CSP');
  assert.ok(rs.includes(`pub const SCHEME: &str = "${SANDBOX_SCHEME}"`),
    'sandbox.rs SCHEME must match SANDBOX_SCHEME');
  assert.ok(rs.includes('.header("Content-Security-Policy", csp_with_ancestors(dev_origin))'),
    'the policy must be delivered as a real response header, not only <meta>');
});

// `frame-ancestors` does not fall back to `default-src`, so omitting it leaves
// the sandbox framable by ANY document — including an arbitrary remote page
// mounted as a webtile child webview, which gets this scheme registered on it
// by the same prepare_pending_webview path while the app's own `frame-src`
// does not constrain it at all. Such a page could frame the sandbox WITHOUT
// the sandbox attribute and drive the runtime as its parent.
test('the served policy restricts who may frame the sandbox', () => {
  const rs = readApp('src-tauri', 'src', 'sandbox.rs');
  assert.ok(/frame-ancestors \{EMBEDDER_ORIGIN\}/.test(rs),
    'the response CSP must carry a frame-ancestors directive');
  assert.ok(rs.includes('const EMBEDDER_ORIGIN: &str = "http://tauri.localhost"'),
    'the packaged embedder origin must be named explicitly, not \'self\' (which names the sandbox scheme) and not a wildcard');
  // The dev-server origin is allowed only in a debug build.
  assert.ok(/fn dev_origin[\s\S]*?if !cfg!\(debug_assertions\) \{\s*return None;/.test(rs),
    'the dev origin must be gated on debug_assertions');
  // The <meta> copy must stay the base policy: frame-ancestors is ignored in
  // a meta tag by spec, so putting it there would be misleading.
  assert.ok(!buildSandboxHtml().includes('frame-ancestors'),
    'frame-ancestors is meaningless in <meta>; it belongs on the response header');
});

// ── the frame must prove it came from the protocol handler ──────────────────
// wry only intercepts sub-frame custom-protocol requests when ICoreWebView2_22
// is available; without it the request escapes to the network, *.localhost
// resolves to loopback, and any local server can answer with a document that
// passes the contentWindow identity check AND the opaque-origin check while
// carrying none of the sandbox CSP.

test('the served document carries a token placeholder the host can check', () => {
  const html = buildSandboxHtml();
  const matches = html.match(/__SANDBOX_TOKEN__/g) ?? [];
  assert.equal(matches.length, 1, 'exactly one placeholder for the Rust handler to substitute');
  assert.ok(html.includes("type: 'ready', token: __sbToken"),
    'ready must echo the token the handler stamped in');
  assert.ok(html.indexOf('__sbToken') < html.indexOf('new Function(msg.code)'),
    'the token must be captured before any bundle code can run');
  const rs = readApp('src-tauri', 'src', 'sandbox.rs');
  assert.ok(rs.includes('const TOKEN_PLACEHOLDER: &str = "__SANDBOX_TOKEN__"'),
    'the Rust placeholder must match the one in the document');
  assert.ok(rs.includes('SANDBOX_HTML.replace(TOKEN_PLACEHOLDER, token())'),
    'the handler must substitute the live token into every response');
  assert.ok(rs.includes('webview.label() != "main"'),
    'sandbox_token must be readable only by the main webview — the inner gate, below the app ACL manifest that scopes every app command to the main webview');
});

test('the host refuses to init a frame that cannot echo the token', () => {
  const tsx = readApp('src', 'components', 'viz-sandbox-surface.tsx');
  assert.ok(tsx.includes("invoke<string>('sandbox_token')"), 'host fetches the token over IPC');
  assert.ok(tsx.includes('if (!sandboxToken || (msg as { token?: unknown }).token !== sandboxToken) {'),
    'a ready without the right token must not set readyRef');
  // Ordering matters: the check has to precede readyRef/sendInit, not follow it.
  assert.ok(tsx.indexOf('.token !== sandboxToken') < tsx.indexOf('readyRef.current = true'),
    'the token check must gate readyRef, not run after it');
});

// The regression this replaces: the token check sat INSIDE the `ready` branch,
// which sat BELOW the `rpc` and `settings:set` branches — so a frame that could
// not echo the token still reached the broker (net.fetch to manifest-allowlisted
// hosts) and still wrote localStorage['scripted.settings.<bundleId>'], which is
// later fed back to the real bundle as `init.settings`.
test('the token gates every message type, not just ready', () => {
  const tsx = readApp('src', 'components', 'viz-sandbox-surface.tsx');
  const tokenCheck = tsx.indexOf('if (!sandboxToken || (msg as { token?: unknown }).token !== sandboxToken) {');
  const proven = tsx.indexOf('if (!readyRef.current) return;');
  const rpc = tsx.indexOf("if (msg?.type === 'rpc') {");
  const settings = tsx.indexOf("} else if (msg?.type === 'settings:set' && bundleId) {");
  assert.ok(tokenCheck > 0 && proven > 0 && rpc > 0 && settings > 0,
    'all four landmarks must still exist — a rename here silently voids this test');
  assert.ok(tokenCheck < proven, 'the token check must come first');
  assert.ok(proven < rpc, 'rpc must be below the proven-frame sentinel');
  assert.ok(proven < settings, 'settings:set must be below the proven-frame sentinel');
  // ...and the sentinel must be an unconditional bail, not a branch that some
  // other message type can slip past.
  assert.ok(/if \(!readyRef\.current\) return;\s*\n\s*\n?\s*if \(msg\?\.type === 'rpc'\) \{/.test(lf(tsx)),
    'nothing may be dispatched between the sentinel and the first message branch');
});

test('a token that never arrives surfaces a banner instead of a black frame', () => {
  const tsx = readApp('src', 'components', 'viz-sandbox-surface.tsx');
  // Retry: the frame's own ready pings re-drive the invoke, because
  // loadSandboxToken clears its memo on failure.
  assert.ok(tsx.includes('if (!sandboxToken) void loadSandboxToken();'),
    'a token-less ready must retry the invoke, not just return');
  assert.ok(tsx.includes('sandboxTokenLoad = null;'), 'the memo must clear on failure or the retry is a no-op');
  // Give-up banner, inside the frame's own 60-ping budget.
  assert.ok(/const READY_TOKEN_GRACE_PINGS = (\d+);/.test(tsx));
  const grace = Number(/const READY_TOKEN_GRACE_PINGS = (\d+);/.exec(tsx)![1]);
  assert.ok(grace > 0 && grace < 60,
    `grace must land inside the frame's 60-ping budget, got ${grace}`);
  assert.ok(tsx.includes('++unprovenReadyRef.current === READY_TOKEN_GRACE_PINGS'),
    'the banner must fire exactly once, on the counter reaching the grace');
  assert.ok(tsx.includes('unprovenReadyRef.current = 0;'), 'the counter must reset on a fresh load');
  // ...and a token that lands late must take the banner back down, or the
  // visualizer animates behind a stale "handshake failed" forever: the only
  // other clear is in the [bundleId, reloadKey] effect, which has already run.
  assert.ok(tsx.includes('if (unprovenReadyRef.current >= READY_TOKEN_GRACE_PINGS) setScriptError(null);'),
    'a late-arriving token must clear the handshake banner');
  assert.ok(
    tsx.indexOf('if (unprovenReadyRef.current >= READY_TOKEN_GRACE_PINGS) setScriptError(null);')
      > tsx.indexOf('readyRef.current = true;'),
    'the clear belongs on the success path, alongside readyRef');
});

// The handshake must not depend on one edge being caught by a listener that
// React tears down and re-attaches, and that cannot act until two async IPC
// round trips have landed. This is what left `tauri dev` unable to run a
// scripted visualizer — the same dev/packaged divergence that let the CSP bug
// reach production in the first place.
test('the runtime re-posts ready until it is initialised', () => {
  const html = buildSandboxHtml();
  assert.ok(/readyTimer = setInterval\(/.test(html), 'ready must be level-triggered, not a single post');
  assert.ok(html.includes('stopReadyPings();'), 'the pings must stop once init arrives');
  assert.ok(html.indexOf('stopReadyPings();') < html.indexOf('new Function(msg.code)'),
    "the 'init' branch must stop the pings");
});

test('app CSP frame-src allows exactly the sandbox origin', () => {
  const conf = JSON.parse(readApp('src-tauri', 'tauri.conf.json'));
  const frameSrc: string = conf.app.security.csp['frame-src'];
  // Exactly the sandbox origin — not 'self', not a wildcard. Anything wider
  // would let the app frame arbitrary content it has no reason to frame.
  assert.equal(frameSrc, SANDBOX_ORIGIN);
  assert.ok(SANDBOX_SRC.startsWith(SANDBOX_ORIGIN + '/'));
  // The app document's own script-src must stay 'self': widening it to
  // satisfy the child frame would hand the whole app the exact capability the
  // sandbox exists to contain.
  assert.equal(conf.app.security.csp['script-src'], "'self'");
});

test('the sandbox iframe uses src, not srcDoc, and keeps allow-scripts only', () => {
  const tsx = readApp('src', 'components', 'viz-sandbox-surface.tsx');
  assert.ok(tsx.includes('src={SANDBOX_SRC}'), 'iframe must load from the custom scheme');
  assert.ok(!/srcDoc=/.test(tsx), 'srcDoc would reintroduce CSP inheritance');
  assert.ok(tsx.includes('sandbox={SANDBOX_ATTR}'), 'the sandbox attribute must come from the pinned constant');
  // Opaque origin must survive the move to a real URL: a frame loaded from a
  // custom scheme is still opaque as long as allow-same-origin is absent.
  assert.ok(!SANDBOX_ATTR.includes('same-origin'), 'opaque origin must survive');
  // Host-side message validation must not have been relaxed along the way.
  assert.ok(tsx.includes('e.source !== iframeRef.current?.contentWindow'));
  assert.ok(tsx.includes("e.origin !== 'null'"),
    'host must still require the opaque-origin "null" sender');
  // The iframe ref must be a stable callback. An inline arrow is a fresh
  // identity every render, so React re-invokes it on every re-render and each
  // call clears readyRef — which freezes the frame pump and makes `reloadKey`
  // (manual reload + `visualizers:changed` hot reload) permanently no-op,
  // because bumping it re-renders before the effect can call sendInit.
  assert.ok(tsx.includes('ref={attachIframe}'),
    'iframe ref must be the stable attachIframe callback');
  assert.ok(/const attachIframe = useCallback\(/.test(tsx),
    'attachIframe must be memoised with an empty dep list');
});

test('the runtime accepts messages only from its embedder', () => {
  const html = buildSandboxHtml();
  // The `parent === window` arm is not redundant: at top level `parent` IS
  // `window`, so the source check alone is degenerate and a self-post would
  // satisfy it. This document is only ever meant to run framed.
  assert.ok(html.includes('if (parent === window || ev.source !== parent) return;'),
    'the sandbox must ignore messages from any window other than its embedder, and must not accept self-posts when unframed');
});

// NOT a security property — deliberately named so it cannot be mistaken for
// one. A nested about:srcdoc frame performs no fetch (so frame-src <-
// default-src 'none' never applies to it), inherits this document's script-src
// 'unsafe-inline', gets its own fresh chrome.webview from the same wry
// injection and relays results back by postMessage. Five lines. What actually
// holds the line is that WebMessageReceived fires only for the main frame,
// plus the opaque origin and the empty BROKER_COMMANDS.
test('the chrome.webview tidy-up is ordered before user code (cosmetic, trivially bypassed)', () => {
  const html = buildSandboxHtml();
  const del = html.indexOf('delete window.chrome.webview');
  assert.ok(del > 0, 'chrome.webview is removed inside the frame');
  assert.ok(del < html.indexOf('new Function(msg.code)'),
    'if it is there at all it must run before any bundle code');
  assert.ok(/Cosmetic tidy-up, NOT a boundary/.test(html),
    'the comment must not read as pinning a security property');
});

test('srcdoc defines the viz API surface and message wiring', () => {
  const html = buildSandboxHtml();
  for (const needle of ["addEventListener('message'", 'viz', "'ready'", "'error'", "'frame'", "'init'", 'settings']) {
    assert.ok(html.includes(needle), `srcdoc should contain ${needle}`);
  }
});

test('srcdoc runtime script is syntactically valid JS', () => {
  const html = buildSandboxHtml();
  const m = html.match(/<script>([\s\S]*)<\/script>/);
  assert.ok(m, 'srcdoc has an inline script');
  // Throws SyntaxError if the shim doesn't parse.
  new Function(m![1]);
});

// ── DOM surface (I11): a mount point beside the canvas ──────────────────────
// Grants no new capability — bundle code already runs inside this document via
// `new Function`, so document.body/createElement were always reachable. This
// only advertises a sized, stable mount point and makes the frame honour the
// manifest's declared `surface`.

test('the sandbox document has both a canvas and a DOM root', () => {
  const html = buildSandboxHtml();
  assert.match(html, /<canvas id="c">/);
  assert.match(html, /<div id="root">/);
});

test('the runtime exposes root alongside canvas', () => {
  assert.match(buildSandboxHtml(), /root:\s*root/);
});

test('CSP is unchanged by the DOM surface — no connect-src, no img-src', () => {
  assert.equal(/connect-src/.test(SANDBOX_CSP), false);
  assert.equal(/img-src/.test(SANDBOX_CSP), false);
  assert.equal(SANDBOX_CSP.match(/default-src ([^;]+)/)?.[1], "'none'");
});

test("runtime: 'data' channel — registration, dispatch, post, and init reset", () => {
  const html = buildSandboxHtml();
  // frame→host sender available to bundle code
  assert.ok(html.includes("post: function (payload) { parent.postMessage({ type: 'data', payload: payload }, '*'); }"),
    'viz.post must exist and post a data message to the embedder');
  // host→frame dispatch, error-guarded like frame callbacks
  assert.ok(html.includes("else if (msg.type === 'data')"), 'runtime must dispatch data messages');
  assert.ok(html.includes('dataCbs[i](msg.payload)'), 'payload (not the envelope) reaches callbacks');
  // registration piggybacks on viz.on
  assert.ok(html.includes("if (name === 'data' && typeof cb === 'function') dataCbs.push(cb);"),
    "viz.on('data') must register");
  // a hot reload must not stack handlers from the previous bundle
  const initIdx = html.indexOf("msg.type === 'init'");
  const resetIdx = html.indexOf('dataCbs = [];', initIdx);
  assert.ok(resetIdx > initIdx && resetIdx < html.indexOf('new Function(msg.code)'),
    "the 'init' branch must clear dataCbs before running new bundle code");
});

test('surface: localSource runs first-party code with no broker and no bundle read', () => {
  const tsx = readApp('src', 'components', 'viz-sandbox-surface.tsx');
  assert.ok(tsx.includes('localSource?: { code: string'), 'localSource prop must exist');
  // The local path must never consult the installed-bundle store...
  const effect = tsx.slice(tsx.indexOf('localSourceRef.current'), tsx.indexOf('sendInit();'));
  assert.ok(effect.includes('brokerRef.current = null'),
    'first-party code gets no broker — permissions stay a marketplace-only concept');
  // ...and the async visualizers_read arm must be skipped entirely.
  assert.ok(/if \(local\) \{/.test(tsx), 'localSource takes a synchronous early path');
});

test("surface: 'data' dispatch sits below the ready/token gate", () => {
  const tsx = readApp('src', 'components', 'viz-sandbox-surface.tsx');
  const gate = tsx.indexOf('if (!readyRef.current) return;');
  const dataBranch = tsx.indexOf("msg?.type === 'data'");
  assert.ok(gate > 0 && dataBranch > gate,
    'an unproven frame must not reach the onData callback');
});

test('surface: data sender refuses to post to an unready frame', () => {
  const tsx = readApp('src', 'components', 'viz-sandbox-surface.tsx');
  const sender = tsx.slice(tsx.indexOf('dataSenderRef.current = ('), tsx.indexOf('return true;'));
  assert.ok(sender.includes('if (!win || !readyRef.current) return false;'),
    'sender must gate on readyRef, mirroring sendInit and the frame pump');
});

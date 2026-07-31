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
  assert.ok(rs.includes('.header("Content-Security-Policy", SANDBOX_CSP)'),
    'the policy must be delivered as a real response header, not only <meta>');
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
  assert.ok(html.includes('if (ev.source !== parent) return;'),
    'the sandbox must ignore messages from any window other than its embedder');
});

test('the runtime drops the WebView2 host-message transport before user code', () => {
  const html = buildSandboxHtml();
  const del = html.indexOf('delete window.chrome.webview');
  assert.ok(del > 0, 'chrome.webview must be removed inside the frame');
  // Must happen before anything that could run bundle code.
  assert.ok(del < html.indexOf('new Function(msg.code)'),
    'the transport must be gone before any bundle code can execute');
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

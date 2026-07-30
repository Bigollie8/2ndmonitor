import test from 'node:test';
import assert from 'node:assert';
import { buildSandboxHtml, SANDBOX_ATTR, SANDBOX_CSP } from './sandbox-html';

test('sandbox attribute grants scripts only', () => {
  assert.equal(SANDBOX_ATTR, 'allow-scripts');
});

test('srcdoc pins the no-capability CSP', () => {
  const html = buildSandboxHtml();
  assert.ok(html.includes(`<meta http-equiv="Content-Security-Policy" content="${SANDBOX_CSP}">`));
  assert.equal(SANDBOX_CSP, "default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval'; style-src 'unsafe-inline'");
});

// The runtime's 'init' handler runs bundle code via `new Function(msg.code)()`
// (this file's own isolation-model comment has always documented that as the
// mechanism) — without 'unsafe-eval', Chromium/WebView2 throws on every such
// call, so no scripted visualizer's code ever actually executes. Pinned
// separately from the full-string equality above so a future edit that
// narrows this back down fails loudly on its own, not just as a diff in the
// combined string.
test('CSP grants unsafe-eval — new Function(msg.code)() would be blocked otherwise', () => {
  assert.ok(SANDBOX_CSP.includes("'unsafe-eval'"), 'script-src must allow unsafe-eval for new Function()');
});

test('srcdoc references no external origins', () => {
  const html = buildSandboxHtml();
  assert.ok(!/https?:\/\//.test(html), 'srcdoc must not reference http(s) URLs');
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

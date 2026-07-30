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

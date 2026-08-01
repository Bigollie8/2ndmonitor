// Emits the sandbox iframe document that the Rust custom-scheme protocol
// handler serves (src-tauri/src/sandbox.rs `include_str!`s the output).
//
// src/sandbox/sandbox-html.ts is the single source of truth; this script only
// materialises it for `include_str!`, which needs a real file on disk at cargo
// compile time. The output is committed, and sandbox-html.test.ts fails if the
// committed file drifts from buildSandboxHtml(), so a stale artifact cannot
// ship silently.
//
// Wired to npm `predev` and `prebuild`, so both `tauri dev` (beforeDevCommand:
// npm run dev) and `tauri build` (beforeBuildCommand: npm run build)
// regenerate before cargo sees the file.

import { writeFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildSandboxHtml } from '../src/sandbox/sandbox-html';

const SANDBOX_HTML_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'src-tauri',
  'sandbox.html',
);

const html = buildSandboxHtml();
let current: string | null = null;
try {
  current = readFileSync(SANDBOX_HTML_PATH, 'utf8');
} catch {
  /* first run */
}
// Don't rewrite an identical file: touching it would invalidate cargo's cache
// and trigger a full rebuild of the crate on every `tauri dev` start.
if (current !== html) {
  writeFileSync(SANDBOX_HTML_PATH, html, 'utf8');
  console.log(`[gen-sandbox-html] wrote ${SANDBOX_HTML_PATH} (${html.length} bytes)`);
} else {
  console.log('[gen-sandbox-html] up to date');
}

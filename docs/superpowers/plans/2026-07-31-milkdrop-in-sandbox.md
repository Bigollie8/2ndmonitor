# MilkDrop-in-Sandbox Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make MilkDrop presets work in packaged builds by moving Butterchurn's eval-dependent rendering into the existing eval-capable viz sandbox iframe, leaving the main window's pinned CSP (`script-src 'self'`) untouched.

**Architecture:** Butterchurn 2.6.7 compiles preset equations with `new Function`, which the packaged app's CSP blocks in the main window (`tauri dev` injects no CSP, which is why this was invisible until a packaged build). The fix: the sandbox protocol gains a generic bidirectional `data` message; `SandboxVizSurface` gains a `localSource` mode that runs a first-party code string instead of an installed bundle; a new frame-side "milkdrop bundle" (butterchurn UMD + preset-pack UMD + glue, shipped as raw text via Vite `?raw` imports) renders inside the frame; `viz-milkdrop.tsx` keeps all its chrome (picker, toasts, auto-advance) host-side and drives the frame over `data` messages. User preset files are still read host-side over IPC and posted in as parsed JSON. Internet-downloaded presets therefore eval inside an opaque-origin frame with `default-src 'none'`, not in the privileged main window.

**Tech Stack:** React + TypeScript (Vite), node:test via `tsx --test`, Tauri 2 (Rust custom-protocol sandbox already exists — no Rust changes in this plan).

## Global Constraints

- **`tauri.conf.json` is NOT modified.** The pinned test `sandbox-html.test.ts` "app CSP frame-src allows exactly the sandbox origin" (asserts `script-src === "'self'"`) must stay green and unchanged.
- **`SANDBOX_CSP` is unchanged** (`default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval'; style-src 'unsafe-inline'`). Its pinning tests must stay green.
- `SANDBOX_ATTR` stays `'allow-scripts'`; `BROKER_COMMANDS` stays `{}`; the `localSource` path grants **no broker permissions** (`brokerRef` stays null).
- The manifest `api` version stays `1` — the `data` message is additive; existing bundles that never call `viz.on('data', …)` or `viz.post(…)` are unaffected.
- After ANY edit to `RUNTIME` in `src/sandbox/sandbox-html.ts`, run `cd app && npm run gen:sandbox` and commit the regenerated `src-tauri/sandbox.html` in the same commit (a test fails if it drifts).
- Frontend tests: `cd app && npm test` (`tsx --test src/**/*.test.ts`, node:test + node:assert/strict, pure modules only — **never** import a module containing `?raw` imports from a test; source-scan such files with `readFile` instead). Typecheck: `cd app && npx tsc -b` (NOT `--noEmit`).
- Record the passing test total before Task 1 and state the new total at each task's end.
- All work happens in the `C:\Users\bigol\Documents\Projects\2ndmonitor-milkdrop` worktree (branch `feat/milkdrop-visualizer`). Never commit to the main checkout — another session uses it.
- Commit style: `feat(sandbox): …` / `fix(viz): …` / `docs: …`, lowercase, imperative.

## File Structure

- Modify `app/src/sandbox/manifest.ts` — `data` message constant + types (protocol doc comment too).
- Modify `app/src/sandbox/sandbox-html.ts` — runtime: `dataCbs`, `viz.on('data')`, `viz.post`, `data` dispatch.
- Regenerate `app/src-tauri/sandbox.html` (committed artifact).
- Modify `app/src/components/viz-sandbox-surface.tsx` — `localSource`, `onData`, `dataSenderRef` props.
- Modify `app/src/state/milkdrop-presets.ts` — names-based merge, `resolveLoadSource`, milkdrop `data`-payload types.
- Create `app/src/sandbox/milkdrop-glue.ts` — the frame-side glue as a plain string (pure, node-testable).
- Create `app/src/components/milkdrop-code.ts` — `?raw` imports + concatenation (never imported by tests).
- Create `app/src/raw-imports.d.ts` — `declare module '*?raw'`.
- Rewrite `app/src/components/viz-milkdrop.tsx` — host chrome over `SandboxVizSurface`.
- Modify tests alongside each: `manifest.test.ts`, `sandbox-html.test.ts`, `milkdrop-presets.test.ts`; create `milkdrop-glue.test.ts`.
- Modify `CHANGELOG.md` (repo root — verify location with `ls`; if only `app/CHANGELOG.md` exists, use that) and `docs/scripted-visualizers.md`.

---

### Task 0: Record the baseline

- [ ] **Step 1: Run the suite and typecheck**

Run: `cd app && npm test` then `npx tsc -b`
Expected: all tests pass. Write down the total (spec-F-era baseline was 458; the worktree has moved since — trust the run, not the doc).

No commit.

---

### Task 1: Protocol — the `data` message

**Files:**
- Modify: `app/src/sandbox/manifest.ts`
- Test: `app/src/sandbox/manifest.test.ts`

**Interfaces:**
- Produces: `MSG_DATA = 'data'`, `interface DataMessage { type: typeof MSG_DATA; payload: unknown }`, and `SandboxToHost` extended with `DataMessage`. Both directions use the same shape.

- [ ] **Step 1: Write the failing test**

Append to `app/src/sandbox/manifest.test.ts`:

```ts
test('data message: additive host<->frame channel for first-party surfaces', () => {
  assert.equal(MSG_DATA, 'data');
  const msg: DataMessage = { type: MSG_DATA, payload: { kind: 'milkdrop:load' } };
  // Must be a member of SandboxToHost so the host dispatch can narrow on it.
  const narrowed: SandboxToHost = msg;
  assert.equal(narrowed.type, 'data');
});
```

Add `MSG_DATA`, `DataMessage`, `SandboxToHost` to the existing import from `./manifest`.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npm test 2>&1 | tail -20`
Expected: FAIL — `MSG_DATA` has no exported member.

- [ ] **Step 3: Implement**

In `app/src/sandbox/manifest.ts`, extend the protocol doc comment (the `// ── postMessage protocol` block) with:

```
//   { type: 'data', payload }   (both directions; first-party surfaces only —
//                                delivered to viz.on('data') / posted by viz.post)
```

Below `MSG_SETTINGS_SET` add:

```ts
export const MSG_DATA = 'data';
```

Below `SettingsSetMessage` add:

```ts
/** Generic first-party payload channel, both directions. Additive to api 1:
 *  bundles that never register viz.on('data') or call viz.post are unaffected.
 *  The host only acts on it when a surface passes an `onData` callback —
 *  installed marketplace bundles get no callback, so their `data` posts go
 *  nowhere. */
export interface DataMessage { type: typeof MSG_DATA; payload: unknown }
```

Change the union:

```ts
export type SandboxToHost = ReadyMessage | ErrorMessage | SettingsSetMessage | DataMessage;
```

- [ ] **Step 4: Run tests + typecheck**

Run: `cd app && npm test 2>&1 | tail -5 && npx tsc -b`
Expected: PASS, total +1.

- [ ] **Step 5: Commit**

```bash
git add app/src/sandbox/manifest.ts app/src/sandbox/manifest.test.ts
git commit -m "feat(sandbox): additive 'data' message in the host<->frame protocol"
```

---

### Task 2: Runtime — `viz.on('data')` and `viz.post`

**Files:**
- Modify: `app/src/sandbox/sandbox-html.ts` (the `RUNTIME` string)
- Regenerate: `app/src-tauri/sandbox.html` (`npm run gen:sandbox`)
- Test: `app/src/sandbox/sandbox-html.test.ts`

**Interfaces:**
- Consumes: `MSG_DATA` (conceptually — the runtime is a plain string, keep the literal `'data'`).
- Produces (inside the frame): `viz.on('data', cb)` registers a payload callback; `viz.post(payload)` sends `{ type: 'data', payload }` to the host; host→frame `{ type: 'data', payload }` fans out to registered callbacks; `dataCbs` resets on every `init` (like `frameCbs`) so hot reloads don't stack handlers.

- [ ] **Step 1: Write the failing tests**

Append to `app/src/sandbox/sandbox-html.test.ts` (uses the existing `buildSandboxHtml` import):

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npm test 2>&1 | tail -20`
Expected: FAIL on the first assertion.

- [ ] **Step 3: Implement in `RUNTIME`**

In `app/src/sandbox/sandbox-html.ts`:

1. Next to `var frameCbs = [];` add:

```js
var dataCbs = [];
```

2. In the `viz` freeze, extend `on` and add `post` (keep `on`'s existing frame line):

```js
  on: function (name, cb) {
    if (name === 'frame' && typeof cb === 'function') frameCbs.push(cb);
    if (name === 'data' && typeof cb === 'function') dataCbs.push(cb);
  },
  // First-party payload channel to the embedder. Marketplace bundles can call
  // this too, but the host only listens when a surface passed an onData
  // callback - and only the builtin milkdrop surface does - so for bundles it
  // is a no-op, not a capability.
  post: function (payload) { parent.postMessage({ type: 'data', payload: payload }, '*'); },
```

3. In the `'init'` branch, next to `frameCbs = [];` add:

```js
    dataCbs = [];
```

4. In the message handler, after the `'frame'` branch add:

```js
  } else if (msg.type === 'data') {
    for (var i = 0; i < dataCbs.length; i++) {
      try { dataCbs[i](msg.payload); } catch (e) { reportError(e); }
    }
  }
```

(Adjust the closing brace chain so the existing `'frame'` branch flows into this `else if`.)

- [ ] **Step 4: Regenerate the committed artifact**

Run: `cd app && npm run gen:sandbox`
Expected: `src-tauri/sandbox.html` changes.

- [ ] **Step 5: Run tests + typecheck**

Run: `cd app && npm test 2>&1 | tail -5 && npx tsc -b`
Expected: PASS (including the drift test), total +1.

- [ ] **Step 6: Commit**

```bash
git add app/src/sandbox/sandbox-html.ts app/src/sandbox/sandbox-html.test.ts app/src-tauri/sandbox.html
git commit -m "feat(sandbox): viz.on('data') + viz.post first-party payload channel"
```

---

### Task 3: Surface — `localSource`, `onData`, `dataSenderRef`

**Files:**
- Modify: `app/src/components/viz-sandbox-surface.tsx`
- Test: `app/src/sandbox/sandbox-html.test.ts` (source-scan style, like the existing surface tests there)

**Interfaces:**
- Produces, on `SandboxVizSurface`'s props:

```ts
/** First-party code to run instead of an installed bundle. When set, the
 *  surface skips visualizers_read and manifest validation entirely and grants
 *  NO broker permissions. MUST be a module-scope constant (stable identity). */
localSource?: { code: string; surface?: 'canvas' | 'dom' };
/** Payloads the frame sends via viz.post. Only honoured after the frame has
 *  proven itself (readyRef) — same gate as every other message. */
onData?: (payload: unknown) => void;
/** Receives a stable sender for host→frame data payloads. Returns false while
 *  the frame is not ready. Cleared to null on unmount. */
dataSenderRef?: React.MutableRefObject<((payload: unknown) => boolean) | null>;
```

- [ ] **Step 1: Write the failing tests**

Append to `app/src/sandbox/sandbox-html.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npm test 2>&1 | tail -20`
Expected: FAIL — `localSource` not found.

- [ ] **Step 3: Implement**

In `app/src/components/viz-sandbox-surface.tsx`:

1. Add the three props to the component signature (destructure `localSource`, `onData`, `dataSenderRef`) with the doc comments from the Interfaces block above.

2. Ref-stabilise the callbacks near `onErrorRef`:

```ts
  const onDataRef = useRef(onData);
  onDataRef.current = onData;
  // Read via ref inside the [bundleId, reloadKey] effect: localSource is
  // documented as a module-scope constant, so it never *changes* — the ref
  // only dodges an exhaustive-deps entry that would re-init on every render
  // if a caller ignored the stability requirement.
  const localSourceRef = useRef(localSource);
  localSourceRef.current = localSource;
```

3. In the `[bundleId, reloadKey]` effect, after the existing `surfaceRef.current = 'canvas';` line, replace the `(async () => { … })()` IIFE invocation site with a local branch ahead of it:

```ts
    const local = localSourceRef.current;
    if (local) {
      // First-party code shipped inside the app bundle: nothing to read over
      // IPC, nothing to validate, and — deliberately — nothing brokered.
      brokerRef.current = null;
      surfaceRef.current = local.surface ?? 'canvas';
      codeRef.current = local.code;
      sendInit();
      return () => { cancelled = true; };
    }
```

(The existing async `visualizers_read` path stays verbatim for the bundle case; `sendInit` here handles the frame-already-ready case, and the frame's `ready` pings handle the not-yet-ready case exactly as for bundles.)

4. In `onMessage`, after the `settings:set` branch (i.e. below the `if (!readyRef.current) return;` gate — do NOT move it above):

```ts
      } else if (msg?.type === 'data') {
        onDataRef.current?.((msg as { payload?: unknown }).payload);
      }
```

5. Add the sender effect after the `sendInit` definition:

```ts
  // Host→frame payload channel for first-party surfaces (see localSource).
  useEffect(() => {
    if (!dataSenderRef) return;
    const ref = dataSenderRef;
    ref.current = (payload: unknown) => {
      const win = iframeRef.current?.contentWindow;
      if (!win || !readyRef.current) return false;
      win.postMessage({ type: 'data', payload }, '*');
      return true;
    };
    return () => { ref.current = null; };
  }, [dataSenderRef]);
```

- [ ] **Step 4: Run tests + typecheck**

Run: `cd app && npm test 2>&1 | tail -5 && npx tsc -b`
Expected: PASS, total +3.

- [ ] **Step 5: Commit**

```bash
git add app/src/components/viz-sandbox-surface.tsx app/src/sandbox/sandbox-html.test.ts
git commit -m "feat(sandbox): localSource + data-channel props on SandboxVizSurface"
```

---

### Task 4: Preset logic — names-based library + load sources

**Files:**
- Modify: `app/src/state/milkdrop-presets.ts`
- Test: `app/src/state/milkdrop-presets.test.ts`

**Interfaces:**
- Produces:

```ts
export interface PresetEntry { key: string; label: string; source: 'bundled' | 'user'; file?: string; ext?: string }
export function mergePresetLibrary(bundledNames: string[], user: { name: string; file: string; ext: string }[]): PresetEntry[];
export type MilkdropLoadSource = { bundled: string } | { preset: object };
export function resolveLoadSource(entry: PresetEntry, readUserFile: (file: string) => Promise<string>): Promise<MilkdropLoadSource>;
export type MilkdropHostToFrame = { kind: 'milkdrop:load'; seq: number; source: MilkdropLoadSource; blend: number };
export type MilkdropFrameToHost =
  | { kind: 'milkdrop:names'; names: string[] }
  | { kind: 'milkdrop:load:result'; seq: number; ok: boolean; error?: string };
```

- Consumed by: Task 5's glue (shapes only — glue is plain JS) and Task 6's host component.
- **Breaking change handled here:** `mergePresetLibrary`'s first param becomes `string[]` (the frame owns the preset objects now); `resolvePreset` is replaced by `resolveLoadSource` (bundled entries no longer read anything — the frame resolves them by name).

- [ ] **Step 1: Update the tests (existing + new)**

In `app/src/state/milkdrop-presets.test.ts`: change every `mergePresetLibrary({ Alpha: {}, beta: {} }, …)`-style call to `mergePresetLibrary(['Alpha', 'beta'], …)` (same expectations: case-insensitive sort, `b:`/`u:` key namespacing, user order preserved). Replace `resolvePreset` tests with:

```ts
test('resolveLoadSource: bundled entries resolve to a by-name reference, no read', async () => {
  let reads = 0;
  const src = await resolveLoadSource(
    { key: 'b:Alpha', label: 'Alpha', source: 'bundled' },
    async () => { reads++; return ''; },
  );
  assert.deepEqual(src, { bundled: 'Alpha' });
  assert.equal(reads, 0, 'the frame owns bundled presets; the host must not read anything');
});

test('resolveLoadSource: user json parses to an inline preset object', async () => {
  const src = await resolveLoadSource(
    { key: 'u:a.json', label: 'a', source: 'user', file: 'a.json', ext: 'json' },
    async () => '{"baseVals":{}}',
  );
  assert.deepEqual(src, { preset: { baseVals: {} } });
});

test('resolveLoadSource: user json that is not an object is a readable error', async () => {
  await assert.rejects(
    resolveLoadSource(
      { key: 'u:a.json', label: 'a', source: 'user', file: 'a.json', ext: 'json' },
      async () => '[1,2]',
    ),
    /not valid Butterchurn preset JSON/,
  );
});

test('resolveLoadSource: .milk still reports the conversion gap', async () => {
  await assert.rejects(
    resolveLoadSource(
      { key: 'u:a.milk', label: 'a', source: 'user', file: 'a.milk', ext: 'milk' },
      async () => 'per_frame_1=',
    ),
    /\.milk conversion unavailable/,
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npm test 2>&1 | tail -20`
Expected: FAIL — signature mismatch / `resolveLoadSource` missing.

- [ ] **Step 3: Implement**

In `app/src/state/milkdrop-presets.ts`: change `mergePresetLibrary` to take `bundledNames: string[]` (body: `bundledNames.slice().sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase())).map(...)` — same mapping as today). Delete `PresetDeps` and `resolvePreset`; add:

```ts
/** What the host actually sends the frame for one load. Bundled presets live
 *  inside the frame (the pack ships in its code string), so they go by name;
 *  user files are read host-side over IPC and travel as parsed JSON — always
 *  structured-cloneable. */
export type MilkdropLoadSource = { bundled: string } | { preset: object };

export async function resolveLoadSource(
  entry: PresetEntry,
  readUserFile: (file: string) => Promise<string>,
): Promise<MilkdropLoadSource> {
  if (entry.source === 'bundled') return { bundled: entry.label };
  const text = await readUserFile(entry.file!);
  if (entry.ext === 'json') {
    try {
      const parsed: unknown = JSON.parse(text);
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('not an object');
      return { preset: parsed as object };
    } catch {
      throw new Error('not valid Butterchurn preset JSON');
    }
  }
  throw new Error(
    '.milk conversion unavailable — convert to Butterchurn JSON (e.g. butterchurn.app) and drop the .json here',
  );
}

/** Host→frame / frame→host payloads carried over the sandbox 'data' channel. */
export type MilkdropHostToFrame = { kind: 'milkdrop:load'; seq: number; source: MilkdropLoadSource; blend: number };
export type MilkdropFrameToHost =
  | { kind: 'milkdrop:names'; names: string[] }
  | { kind: 'milkdrop:load:result'; seq: number; ok: boolean; error?: string };
```

Update the module header comment: pure logic, the frame owns bundled preset objects, the host owns user files + ordering.

- [ ] **Step 4: Run tests + typecheck**

Run: `cd app && npm test 2>&1 | tail -5 && npx tsc -b`
Expected: milkdrop-presets tests PASS. `tsc -b` will FAIL in `viz-milkdrop.tsx` (still on the old API) — that is expected until Task 6; note it and move on. If anything ELSE fails, stop and fix.

- [ ] **Step 5: Commit**

```bash
git add app/src/state/milkdrop-presets.ts app/src/state/milkdrop-presets.test.ts
git commit -m "feat(viz): preset library by name + load-source resolution for the sandboxed milkdrop"
```

(Committing with the known viz-milkdrop type break is acceptable inside the task sequence; Task 6 restores `tsc -b` green. If the project's hooks run tsc on commit and reject, squash Tasks 4–6 review-wise by deferring this commit to Task 6's — but still keep the test-first order.)

---

### Task 5: The frame-side milkdrop bundle

**Files:**
- Create: `app/src/sandbox/milkdrop-glue.ts` (pure string module)
- Create: `app/src/components/milkdrop-code.ts` (`?raw` imports — NEVER import from a test)
- Create: `app/src/raw-imports.d.ts`
- Test: `app/src/sandbox/milkdrop-glue.test.ts`

**Interfaces:**
- Consumes: the frame runtime's `viz` API (`viz.canvas`, `viz.on('frame'|'data')`, `viz.post`) and the payload shapes from Task 4.
- Produces: `MILKDROP_GLUE: string` (glue only) and `MILKDROP_FRAME_CODE: string` (butterchurn UMD + preset pack UMD + glue, ready for `init.code`).

- [ ] **Step 1: Write the failing tests**

Create `app/src/sandbox/milkdrop-glue.test.ts`:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MILKDROP_GLUE } from './milkdrop-glue';

const readApp = (...p: string[]) => readFileSync(join(__dirname, '..', ...p), 'utf8');

test('glue: UMD default-interop for both libraries', () => {
  assert.ok(MILKDROP_GLUE.includes('(window.butterchurn && window.butterchurn.default) || window.butterchurn'));
  assert.ok(MILKDROP_GLUE.includes('(window.butterchurnPresets && window.butterchurnPresets.default) || window.butterchurnPresets'));
});

test('glue: audio levels follow the Web Audio byte convention (128 = silence)', () => {
  assert.ok(MILKDROP_GLUE.includes('fill(128)'), 'silence baseline');
  assert.ok(MILKDROP_GLUE.includes('timeByteArrayL'), 'butterchurn wants three buffers');
  assert.ok(/f\.waveform\.length > 1024 \? f\.waveform\.subarray\(0, 1024\) : f\.waveform/.test(MILKDROP_GLUE),
    'oversized capture buffers are truncated, not overflowed');
});

test('glue: resize goes through setRendererSize, render every frame', () => {
  assert.ok(MILKDROP_GLUE.includes('setRendererSize'));
  assert.ok(MILKDROP_GLUE.includes('visualizer.render({ audioLevels: levels })'));
});

test('glue: every load answers with a seq-matched result, success or failure', () => {
  assert.ok(MILKDROP_GLUE.includes("viz.post({ kind: 'milkdrop:load:result', seq: msg.seq, ok: true })"));
  assert.ok(MILKDROP_GLUE.includes("ok: false, error:"));
  assert.ok(MILKDROP_GLUE.includes("kind !== 'milkdrop:load'"), 'unknown data payloads are ignored');
});

test('glue: announces its preset names on every init', () => {
  assert.ok(MILKDROP_GLUE.includes("viz.post({ kind: 'milkdrop:names', names: Object.keys(presets) })"));
});

test('milkdrop-code assembles butterchurn + pack + glue via ?raw (source scan — module not importable under node)', () => {
  const src = readApp('components', 'milkdrop-code.ts');
  assert.ok(src.includes("butterchurn/lib/butterchurn.min.js?raw"));
  assert.ok(src.includes("butterchurn-presets/lib/butterchurnPresets.min.js?raw"));
  assert.ok(src.includes('MILKDROP_GLUE'));
  assert.ok(src.includes("join('\\n;\\n')"), 'minified UMDs may lack trailing semicolons/newlines');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npm test 2>&1 | tail -20`
Expected: FAIL — cannot find `./milkdrop-glue`.

- [ ] **Step 3: Implement `milkdrop-glue.ts`**

```ts
// ─────────────────────────────────────────────────────────────────────────────
// Frame-side glue for the builtin MilkDrop visualizer. Runs INSIDE the viz
// sandbox iframe (opaque origin, default-src 'none', eval allowed) after the
// butterchurn + preset-pack UMDs — see components/milkdrop-code.ts for the
// assembly. Kept as a plain string in a pure module so node tests can scan it
// without touching Vite's `?raw` resolver.
//
// Protocol (over the sandbox 'data' channel — types in state/milkdrop-presets):
//   host → frame  { kind: 'milkdrop:load', seq, source, blend }
//   frame → host  { kind: 'milkdrop:names', names }          (once per init)
//   frame → host  { kind: 'milkdrop:load:result', seq, ok, error? }
// ─────────────────────────────────────────────────────────────────────────────

export const MILKDROP_GLUE = String.raw`
(function () {
  'use strict';
  var BC = (window.butterchurn && window.butterchurn.default) || window.butterchurn;
  var PACK = (window.butterchurnPresets && window.butterchurnPresets.default) || window.butterchurnPresets;
  if (!BC || !PACK) throw new Error('butterchurn libraries failed to load in the sandbox');
  var presets = PACK.getPresets();

  // AudioProcessor.updateAudio wants three Uint8Array(1024) time-domain
  // buffers (getByteTimeDomainData convention, 128 = silence). Mono capture,
  // so L/R duplicate. Allocated once, mutated per frame.
  var W = 1024;
  var levels = {
    timeByteArray: new Uint8Array(W),
    timeByteArrayL: new Uint8Array(W),
    timeByteArrayR: new Uint8Array(W),
  };
  levels.timeByteArray.fill(128); levels.timeByteArrayL.fill(128); levels.timeByteArrayR.fill(128);

  // The runtime's applySize has already stamped the init size onto the canvas.
  var canvas = viz.canvas;
  var lastW = Math.max(2, canvas.width);
  var lastH = Math.max(2, canvas.height);
  var visualizer = BC.createVisualizer(null, canvas, { width: lastW, height: lastH });

  viz.on('data', function (msg) {
    if (!msg || msg.kind !== 'milkdrop:load') return;
    try {
      var preset = msg.source.bundled !== undefined ? presets[msg.source.bundled] : msg.source.preset;
      if (!preset) throw new Error('bundled preset missing: ' + msg.source.bundled);
      visualizer.loadPreset(preset, msg.blend);
      viz.post({ kind: 'milkdrop:load:result', seq: msg.seq, ok: true });
    } catch (e) {
      viz.post({ kind: 'milkdrop:load:result', seq: msg.seq, ok: false, error: String(e && e.message ? e.message : e) });
    }
  });

  viz.on('frame', function (f) {
    if (canvas.width !== lastW || canvas.height !== lastH) {
      lastW = Math.max(2, canvas.width);
      lastH = Math.max(2, canvas.height);
      visualizer.setRendererSize(lastW, lastH);
    }
    if (f.waveform) {
      var src = f.waveform.length > 1024 ? f.waveform.subarray(0, 1024) : f.waveform;
      levels.timeByteArray.set(src);
      levels.timeByteArrayL.set(src);
      levels.timeByteArrayR.set(src);
    }
    visualizer.render({ audioLevels: levels });
  });

  // Level-triggered like the runtime's own ready pings: this fires on EVERY
  // init (including hot reloads), and the host rebuilds its library + reloads
  // the current preset each time it hears it.
  viz.post({ kind: 'milkdrop:names', names: Object.keys(presets) });
})();
`;
```

- [ ] **Step 4: Implement `raw-imports.d.ts` and `milkdrop-code.ts`**

`app/src/raw-imports.d.ts`:

```ts
/** Vite `?raw` imports resolve to the file's text. Declared manually — this
 *  project has no vite-env.d.ts / vite/client reference. */
declare module '*?raw' {
  const src: string;
  export default src;
}
```

`app/src/components/milkdrop-code.ts`:

```ts
// The builtin MilkDrop visualizer's frame code: butterchurn + its preset pack
// as raw UMD text, then the glue. Evaluated inside the viz sandbox iframe via
// the standard init `new Function(code)` path — the ONLY place these
// libraries may run: butterchurn compiles preset equations with new Function,
// which the main window's pinned CSP (script-src 'self') forbids in packaged
// builds. Do not import butterchurn as a module anywhere in the app document.
//
// NOT node-importable (`?raw` is a Vite resolver feature) — tests source-scan
// this file instead (see sandbox/milkdrop-glue.test.ts).
import butterchurnSrc from 'butterchurn/lib/butterchurn.min.js?raw';
import presetPackSrc from 'butterchurn-presets/lib/butterchurnPresets.min.js?raw';
import { MILKDROP_GLUE } from '../sandbox/milkdrop-glue';

export const MILKDROP_FRAME_CODE = [butterchurnSrc, presetPackSrc, MILKDROP_GLUE].join('\n;\n');
```

- [ ] **Step 5: Run tests**

Run: `cd app && npm test 2>&1 | tail -5`
Expected: PASS, total +6. (`tsc -b` still red only in `viz-milkdrop.tsx` — Task 6 clears it.)

- [ ] **Step 6: Commit**

```bash
git add app/src/sandbox/milkdrop-glue.ts app/src/sandbox/milkdrop-glue.test.ts app/src/components/milkdrop-code.ts app/src/raw-imports.d.ts
git commit -m "feat(viz): frame-side milkdrop bundle — butterchurn UMDs + glue over the data channel"
```

---

### Task 6: Host — rewrite `viz-milkdrop.tsx` onto the sandbox surface

**Files:**
- Modify: `app/src/components/viz-milkdrop.tsx`
- Test: `app/src/state/milkdrop-presets.test.ts` (host-source scan appended there — the component itself is not node-importable)

**Interfaces:**
- Consumes: `SandboxVizSurface` props from Task 3, `MILKDROP_FRAME_CODE` from Task 5, `mergePresetLibrary` / `resolveLoadSource` / payload types from Task 4.
- Produces: unchanged export `VizMilkdrop(props: VizProps)`; preview mode unchanged.
- **Removals:** the direct `import('butterchurn')` / `import('butterchurn-presets')`, the canvas/ResizeObserver/rAF effect, `makeButterchurnLevels` usage, the `fatal` state (the surface's own error banner covers frame failures now).
- **Kept host-side, behavior-identical:** preset picker + grouping, failures map with ⚠ badges, toast, auto-advance (30s, pause-aware, localStorage `milkdrop.autoAdvance`), last-preset restore (localStorage `milkdrop.preset`), prev/random/next/☰ chips, preview card.

- [ ] **Step 1: Write the failing source-scan tests**

Append to `app/src/state/milkdrop-presets.test.ts`:

```ts
const readComponent = () =>
  readFileSync(join(__dirname, '..', 'components', 'viz-milkdrop.tsx'), 'utf8');

test('milkdrop host: renders through the sandbox surface, not a direct butterchurn import', () => {
  const tsx = readComponent();
  assert.ok(!tsx.includes("import('butterchurn')"), 'butterchurn must not load in the app document (CSP)');
  assert.ok(tsx.includes('<SandboxVizSurface'), 'rendering goes through the sandbox surface');
  assert.ok(tsx.includes('localSource={MILKDROP_LOCAL_SOURCE}'), 'frame code passed as a stable module constant');
  assert.ok(/const MILKDROP_LOCAL_SOURCE = \{ code: MILKDROP_FRAME_CODE \}/.test(tsx),
    'localSource identity must be module-scope stable or the surface re-inits every render');
});

test('milkdrop host: every pending load resolves — result, timeout, or not-ready', () => {
  const tsx = readComponent();
  assert.ok(tsx.includes("kind: 'milkdrop:load'"), 'loads travel the data channel');
  assert.ok(tsx.includes('no response from visualizer frame'), 'a dead frame times out instead of hanging the walk-forward');
  assert.ok(tsx.includes('visualizer not ready'), 'posting before ready fails fast');
  assert.ok(tsx.includes("kind === 'milkdrop:load:result'"), 'results resolve by seq');
});

test('milkdrop host: names arrival rebuilds the library and restores the saved preset', () => {
  const tsx = readComponent();
  assert.ok(tsx.includes("kind === 'milkdrop:names'"));
  assert.ok(tsx.includes('mergePresetLibrary('));
  assert.ok(tsx.includes('LS_PRESET'), 'saved-preset restore survives the rewrite');
});

test('milkdrop host: hover chrome works over an iframe (pointer shield)', () => {
  const tsx = readComponent();
  // Mouse events over an iframe go to ITS document, never the parent's —
  // without a shield above the frame, onMouseEnter never fires and the chips
  // are unreachable. The visualizer needs no pointer input, so a full-cover
  // div above the iframe costs nothing.
  assert.ok(tsx.includes('data-pointer-shield'), 'a full-cover div must sit above the iframe');
});
```

Add `readFileSync`/`join` imports at the top of the test file if not already present.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npm test 2>&1 | tail -20`
Expected: FAIL — component still imports butterchurn.

- [ ] **Step 3: Rewrite `MilkdropSurface`**

Replace the body of `viz-milkdrop.tsx` keeping `VizMilkdrop`, `MilkdropPreviewCard`, `PresetPicker` (unchanged), the `AUTO_ADVANCE_MS`/`BLEND_SECONDS`/`LS_PRESET`/`LS_AUTO` constants, and the chip styling. New imports:

```tsx
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { type VizProps } from './viz';
import { SandboxVizSurface } from './viz-sandbox-surface';
import { MILKDROP_FRAME_CODE } from './milkdrop-code';
import {
  mergePresetLibrary, resolveLoadSource,
  type PresetEntry, type MilkdropLoadSource, type MilkdropHostToFrame, type MilkdropFrameToHost,
} from '../state/milkdrop-presets';

/** Stable identity is load-bearing: SandboxVizSurface documents localSource
 *  as a module-scope constant; an inline literal would re-init per render. */
const MILKDROP_LOCAL_SOURCE = { code: MILKDROP_FRAME_CODE };
/** Distinct from any installable marketplace id ('builtin-' prefix) so the
 *  settings key and perf-HUD bucket can never collide with a shop bundle. */
const MILKDROP_BUNDLE_ID = 'builtin-milkdrop';
const LOAD_TIMEOUT_MS = 5000;
```

`MilkdropSurface` core (the chrome JSX — label, chips, toast, picker — is carried over verbatim from the current file, except the `fatal` banner block, which is deleted):

```tsx
function MilkdropSurface({ accent, accent2, spectrumRef, paused }: Pick<VizProps, 'accent' | 'accent2' | 'spectrumRef' | 'paused'>) {
  const libraryRef = useRef<PresetEntry[]>([]);
  const indexRef = useRef(0);
  const failuresRef = useRef(new Map<string, string>());
  const userRef = useRef<{ name: string; file: string; ext: string }[] | null>(null);

  const seqRef = useRef(0);
  const pendingRef = useRef(new Map<number, (r: { ok: boolean; error?: string }) => void>());
  const dataSenderRef = useRef<((payload: unknown) => boolean) | null>(null);

  const [presetLabel, setPresetLabel] = useState('');
  const [toast, setToast] = useState('');
  const [hovered, setHovered] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [libraryVersion, setLibraryVersion] = useState(0);
  const [autoAdvance, setAutoAdvance] = useState(() => localStorage.getItem(LS_AUTO) !== 'off');

  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showToast = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 4000);
  }, []);
  useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current); }, []);

  const readUserFile = useCallback(async (file: string) => {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke<string>('presets_read', { file });
  }, []);

  /** Post one load into the frame; resolves on the frame's seq-matched
   *  result, a timeout (dead frame), or immediately when the frame is not
   *  ready — never hangs the caller's walk-forward loop. */
  const sendLoad = useCallback((source: MilkdropLoadSource, blend: number) => {
    return new Promise<{ ok: boolean; error?: string }>((resolve) => {
      const seq = ++seqRef.current;
      const timer = setTimeout(() => {
        pendingRef.current.delete(seq);
        resolve({ ok: false, error: 'no response from visualizer frame' });
      }, LOAD_TIMEOUT_MS);
      pendingRef.current.set(seq, (r) => { clearTimeout(timer); resolve(r); });
      const msg: MilkdropHostToFrame = { kind: 'milkdrop:load', seq, source, blend };
      if (!dataSenderRef.current?.(msg)) {
        clearTimeout(timer);
        pendingRef.current.delete(seq);
        resolve({ ok: false, error: 'visualizer not ready' });
      }
    });
  }, []);

  /** Load library[index]; on failure, record it, toast, and walk forward
   *  until something loads (at most one full lap). Unchanged shape from the
   *  in-document era — only the resolve/load seam moved to the frame. */
  const loadAt = useCallback(async (index: number, blend: number) => {
    const lib = libraryRef.current;
    if (!lib.length) return;
    for (let attempt = 0; attempt < lib.length; attempt++) {
      const i = (index + attempt + lib.length) % lib.length;
      const entry = lib[i];
      try {
        const source = await resolveLoadSource(entry, readUserFile);
        const res = await sendLoad(source, blend);
        if (!res.ok) throw new Error(res.error ?? 'load failed');
        indexRef.current = i;
        setPresetLabel(entry.label);
        localStorage.setItem(LS_PRESET, entry.key);
        return;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        failuresRef.current.set(entry.key, msg);
        setLibraryVersion((v) => v + 1);
        showToast(`${entry.label}: ${msg}`);
      }
    }
  }, [readUserFile, sendLoad, showToast]);

  const advance = useCallback((how: 'next' | 'prev' | 'random', blend = BLEND_SECONDS) => {
    const lib = libraryRef.current;
    if (!lib.length) return;
    let target = indexRef.current;
    if (how === 'next') target = indexRef.current + 1;
    else if (how === 'prev') target = indexRef.current - 1;
    else if (lib.length > 1) {
      do { target = Math.floor(Math.random() * lib.length); } while (target === indexRef.current);
    }
    void loadAt(target, blend);
  }, [loadAt]);

  /** Fires on every 'milkdrop:names' — first init AND hot re-inits. Rebuilds
   *  the library (frame names + user files) and restores the saved preset;
   *  after a re-init the frame has a blank visualizer, so always reload. */
  const onNames = useCallback(async (names: string[]) => {
    if (userRef.current === null) {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        userRef.current = await invoke<{ name: string; file: string; ext: string }[]>('presets_list');
      } catch {
        userRef.current = []; // preset folder unreadable — bundled pack still works
      }
    }
    libraryRef.current = mergePresetLibrary(names, userRef.current);
    setLibraryVersion((v) => v + 1);
    const lib = libraryRef.current;
    const savedKey = localStorage.getItem(LS_PRESET);
    const savedIndex = savedKey ? lib.findIndex((e) => e.key === savedKey) : -1;
    void loadAt(savedIndex >= 0 ? savedIndex : Math.floor(Math.random() * lib.length), 0);
  }, [loadAt]);

  const handleData = useCallback((payload: unknown) => {
    const msg = payload as MilkdropFrameToHost;
    if (msg?.kind === 'milkdrop:load:result') {
      const pending = pendingRef.current.get(msg.seq);
      if (pending) { pendingRef.current.delete(msg.seq); pending({ ok: msg.ok, error: msg.error }); }
    } else if (msg?.kind === 'milkdrop:names') {
      void onNames(msg.names);
    }
  }, [onNames]);

  useEffect(() => {
    if (!autoAdvance || paused) return;
    const id = setInterval(() => advance('random'), AUTO_ADVANCE_MS);
    return () => clearInterval(id);
  }, [autoAdvance, paused, advance]);

  const toggleAuto = () => {
    setAutoAdvance((prev) => {
      localStorage.setItem(LS_AUTO, prev ? 'off' : 'on');
      return !prev;
    });
  };

  // chip style object: unchanged from the current file

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{ position: 'absolute', inset: 0, background: '#000', overflow: 'hidden' }}
    >
      <SandboxVizSurface
        bundleId={MILKDROP_BUNDLE_ID}
        localSource={MILKDROP_LOCAL_SOURCE}
        onData={handleData}
        accent={accent}
        accent2={accent2}
        spectrumRef={spectrumRef}
        paused={paused}
      />
      {/* Mouse events over an iframe are dispatched to ITS document, never the
          parent's — without this shield the wrapper's onMouseEnter never fires
          and every chip is unreachable. MilkDrop takes no pointer input, so
          covering the frame costs nothing. Chrome renders above the shield. */}
      <div data-pointer-shield style={{ position: 'absolute', inset: 0, zIndex: 1 }} />

      {/* presetLabel badge, chips row, toast, PresetPicker — carried over
          verbatim from the current file, each with zIndex: 2 added to its
          existing style object (the picker overlay already has zIndex: 5). */}
    </div>
  );
}
```

Also: `VizMilkdrop` passes `accent2` through to `MilkdropSurface` now (the surface needs it for the frame theme); preview branch unchanged.

Delete the now-unused `import { useWaveformRef }`, `makeButterchurnLevels`, `useAnimateGate`, `getVizDpr`, and `BCVisualizer` references. Keep `app/src/butterchurn.d.ts` — `milkdrop-code.ts`'s `?raw` imports don't use the module declarations, but delete only the `declare module 'butterchurn'`/`'butterchurn-presets'` blocks if `tsc -b` reports them unused (it won't; leaving the file is fine and documents the API the glue calls).

- [ ] **Step 4: Run tests + typecheck**

Run: `cd app && npm test 2>&1 | tail -5 && npx tsc -b`
Expected: BOTH green now (Task 4's deliberate break is resolved). Total +4.

- [ ] **Step 5: Smoke-run in dev**

Run: `cd app && npx tauri dev` (or `npm run dev` + existing app process per project habit), open the MilkDrop tile.
Expected: presets render inside the iframe; prev/next/random/picker/auto-advance all work; hover shows chips (shield working); a user `.json` preset in `%APPDATA%\com.secondmonitor.hub\presets` loads; a garbage `.json` shows the ⚠ badge + toast and walks forward. Dev proves wiring only — NOT the CSP fix (dev has no CSP). Task 8 proves the fix.

- [ ] **Step 6: Commit**

```bash
git add app/src/components/viz-milkdrop.tsx app/src/state/milkdrop-presets.test.ts
git commit -m "fix(viz): run milkdrop inside the viz sandbox — packaged CSP blocked butterchurn's eval"
```

---

### Task 7: Docs + changelog

**Files:**
- Modify: `CHANGELOG.md` (verify location: `ls CHANGELOG.md app/CHANGELOG.md` — use whichever exists; if both, the one release tagging reads, per repo convention the root one)
- Modify: `docs/scripted-visualizers.md`

- [ ] **Step 1: CHANGELOG entry**

Under the Unreleased section's `### Fixed` (create the subsection if absent):

```markdown
- MilkDrop presets now load in packaged builds. Butterchurn compiles preset
  equations with `new Function`, which the app CSP (`script-src 'self'`)
  rightly blocks in the main window; the visualizer now runs inside the
  eval-capable viz sandbox iframe, so downloaded presets also stop executing
  with app privileges. (`tauri dev` injects no CSP, which is why this never
  reproduced in development.)
```

- [ ] **Step 2: docs/scripted-visualizers.md**

Add a short section (placement: after the runtime/protocol description):

```markdown
## First-party surfaces on the sandbox runtime

The builtin MilkDrop visualizer renders through the same sandbox iframe as
marketplace bundles, via `SandboxVizSurface`'s `localSource` prop: its code
(butterchurn + preset pack UMDs + glue, see `src/components/milkdrop-code.ts`)
ships inside the app and is passed to the standard `init` path — no
`visualizers_read`, no manifest, and no broker permissions. It talks to its
host chrome over the generic `data` message (`viz.on('data')` / `viz.post`).

Why: butterchurn compiles preset equations with `new Function`. The main
window's CSP pins `script-src 'self'` (a test enforces it), so the only place
that eval may run is the sandbox — which also means a preset `.json`
downloaded from the internet executes in an opaque-origin frame with
`default-src 'none'`, not in the privileged app document.
```

Also update the plan-doc contradiction: in `docs/superpowers/plans/2026-07-31-visualizer-migration.md` line 15, amend the constraint to read that `milkdrop` stays first-party and out of the *marketplace bundle* migration, but renders on the sandbox runtime via `localSource` (one-line edit, cite this plan's filename).

- [ ] **Step 3: Commit**

```bash
git add CHANGELOG.md docs/scripted-visualizers.md docs/superpowers/plans/2026-07-31-visualizer-migration.md
git commit -m "docs: milkdrop-in-sandbox rationale + changelog entry"
```

---

### Task 8: Packaged-build verification (the real path)

The bug only exists under the packaged CSP; dev cannot prove the fix. Do not claim success without this task.

- [ ] **Step 1: Build**

Run: `cd app && npm run tauri build` (expect `gen:sandbox` via `prebuild`, then `tsc -b && vite build`, then the Rust build; NSIS target).

- [ ] **Step 2: Run the packaged app**

Run the built exe from `app/src-tauri/target/release/` (the bundle installer is not needed for verification; the release binary serves the packaged `frontendDist` with the real CSP).

- [ ] **Step 3: Verify**

- MilkDrop tile renders animating presets (not black, no CSP error).
- Open devtools if available and confirm the console has **no** `unsafe-eval` violations.
- Preset prev/next/random + picker + auto-advance work; the preset label updates.
- Drop a known-good Butterchurn `.json` into `%APPDATA%\com.secondmonitor.hub\presets`, reopen the picker (or restart), select it — it renders.
- Drop a garbage `.json` — ⚠ badge + toast, playback walks forward to the next preset instead of dying.
- Sanity: one existing marketplace/scripted bundle style still renders (the runtime edit is shared).

- [ ] **Step 4: Record the result**

Append a dated verification note to this plan file (what was run, what was seen). If anything failed, STOP — return to systematic debugging, do not patch forward blindly.

---

## Self-Review

**Spec coverage:** CSP conflict resolved without touching `tauri.conf.json` (Tasks 2–6); pinned security tests untouched and still meaningful; user presets contained (Task 4/5 split of bundled-by-name vs user-by-value); host chrome preserved (Task 6); dev/packaged divergence addressed by mandatory packaged verification (Task 8).

**Known risks:**
- The preset pack UMD resolves `this`-rooted (`self`/`this`), butterchurn's wrapper is `window`-rooted; inside `new Function` (non-strict, global `this`) both land on `window` — verified against both files' headers. If a future package update changes the wrapper, the glue's interop line and its test catch it.
- Frame canvas runs at CSS-pixel resolution (the sandbox `applySize` convention), where the old in-document canvas was DPR-scaled — a deliberate quality/perf tradeoff, matching every other sandboxed style. If it looks soft on hi-DPI, a follow-up can add a `dpr` field to the frame message rather than special-casing milkdrop.
- `PresetPicker`'s "user" group hint text still names the presets folder — unchanged behavior, but confirm the picker overlay's z-index stays above the pointer shield.

**Type consistency check:** `MilkdropLoadSource` produced in Task 4, consumed by glue (plain JS mirror, `msg.source.bundled !== undefined`) and host `sendLoad`; `dataSenderRef` returns `boolean` in Task 3 and is null-checked via `?.()` in Task 6; `mergePresetLibrary(names: string[], user)` matches the Task 6 call `mergePresetLibrary(names, userRef.current)`. `MILKDROP_FRAME_CODE` name identical in Tasks 5 and 6.

---

## Task 8 verification record — 2026-07-31

Packaged build `npm exec tauri build` (release, NSIS) from feat/milkdrop-in-sandbox @ 50ac9ac+docs.
Ran `src-tauri/target/release/second-monitor-hub.exe` (old 2ndmonitor-milkdrop build stopped first — single-instance refocus).
Verified by screen capture:
- MilkDrop style active, live preset rendering (not black, no CSP violation, no error banner). First preset: `$$$ Royal - Mashup (431)`, restored via LS_PRESET.
- After the 30s auto-advance interval, a second, different preset rendered with the label updated — repeated `milkdrop:load` over the data channel works. The preset that landed was `_Aderrasi - Wanderer in Curved Space - mash0000 - ...` — the exact preset that threw the CSP eval error in the bug report screenshot.
NOT manually exercised (covered by unit tests only): picker click-through, user `.json` drop, garbage-json walk-forward, other bundle styles (require pointer interaction a WebView2 window doesn't expose to automation).

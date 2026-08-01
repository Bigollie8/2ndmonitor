# DOM Sandbox Implementation Plan (spec E)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a visualizer bundle render with DOM elements and CSS instead of a canvas, so the ten CSS-transform styles in `viz-extra.tsx` can become marketplace bundles.

**Architecture:** The sandbox frame already gives bundle code a full `document` — `new Function(code)()` runs inside it, so `createElement` and `document.body` have always been reachable. What's missing is an *advertised, sized, stable* mount point and a way for a bundle to say which surface it wants. So this is a surface declaration, not a new sandbox: the frame gains a `<div id="root">` beside the existing `<canvas id="c">`, the manifest gains `surface: 'canvas' | 'dom'` (defaulting to `'canvas'` for every bundle published so far), and the frame shows whichever the manifest asks for.

**Security note, and the reason this plan is short:** exposing `viz.root` grants a bundle **nothing it did not already have**. It could always build DOM in its own document. `default-src 'none'` still blocks every network egress, the origin is still opaque, `BROKER_COMMANDS` is still `{}`, and the CSP is unchanged. No task here may widen any of those — in particular, a DOM bundle must not gain `img-src` or `connect-src` to load its own assets. See `docs/deferred-findings.md` item 2a for why `connect-src` specifically would be catastrophic.

**Tech Stack:** TypeScript (pure sandbox modules), React 18, Rust + Tauri 2, `node:test` via `tsx --test`.

## Global Constraints

- `SANDBOX_CSP` is unchanged. No `connect-src`, no `img-src`, `default-src` stays exactly `'none'`. A test already pins this and must keep passing.
- `SANDBOX_ATTR` stays `'allow-scripts'` with no `allow-same-origin`. `BROKER_COMMANDS` stays `{}`.
- `app/src/sandbox/sandbox-html.ts` has a byte-identity test against the Rust copy — both must be updated together, and `.gitattributes` keeps line endings stable.
- Manifest schema stays **api 1**; `surface` is an additive optional field. An older app reading a newer manifest ignores it; a newer app reading an older manifest defaults to `'canvas'`. Every one of the 12 published visualizers omits it and must keep working untouched.
- Frontend tests: `npm test` (`tsx --test src/**/*.test.ts`), `node:test` + `node:assert/strict`, pure modules only. Typecheck with `npx tsc -b` (NOT `--noEmit`).
- Baselines: **445 frontend, 76 app-cargo, 62 server**. Each task states its new total.
- **Verification for any task touching the frame must include a packaged build** (`npm run tauri build`), not just `tauri dev`. Tauri injects no CSP against a Vite-served document, which is exactly how a completely broken sandbox shipped undetected on this branch.

---

### Task 1: `surface` in the manifest

**Files:**
- Modify: `app/src/sandbox/manifest.ts`
- Test: `app/src/sandbox/manifest.test.ts`
- Modify: `server/src/manifest.rs` (the server validates manifests on submission and must not reject the new field)

**Interfaces:**
- Produces: `VizManifest.surface?: 'canvas' | 'dom'`, defaulted by `validateManifest`.

- [ ] **Step 1: Write the failing test**

```ts
test('validateManifest: surface defaults to canvas when absent', () => {
  const r = validateManifest({ id: 'x', name: 'X', version: '1.0.0', api: 1, permissions: [] });
  assert.equal(r.ok, true);
  assert.equal(r.ok && r.manifest.surface, 'canvas');
});

test('validateManifest: surface accepts dom', () => {
  const r = validateManifest({ id: 'x', name: 'X', version: '1.0.0', api: 1, permissions: [], surface: 'dom' });
  assert.equal(r.ok && r.manifest.surface, 'dom');
});

test('validateManifest: an unknown surface is rejected, not silently defaulted', () => {
  const r = validateManifest({ id: 'x', name: 'X', version: '1.0.0', api: 1, permissions: [], surface: 'webgl' });
  assert.equal(r.ok, false);
});

test('validateManifest: surface must be a string', () => {
  assert.equal(validateManifest({ id: 'x', name: 'X', version: '1.0.0', api: 1, permissions: [], surface: 1 }).ok, false);
});
```

Rejecting an unknown value rather than defaulting is deliberate: a typo'd `surface` should fail at submission, not render a blank frame the author cannot diagnose.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx tsx --test src/sandbox/manifest.test.ts`
Expected: FAIL — `surface` is `undefined`.

- [ ] **Step 3: Implement in `manifest.ts`**

Add `surface?: 'canvas' | 'dom'` to `VizManifest`. In `validateManifest`, after the `api` check:

```ts
let surface: 'canvas' | 'dom' = 'canvas';
if (m.surface !== undefined) {
  if (m.surface !== 'canvas' && m.surface !== 'dom') {
    return { ok: false, error: 'surface must be "canvas" or "dom"' };
  }
  surface = m.surface;
}
```

and include `surface` in the returned manifest.

- [ ] **Step 4: Mirror in the server's validator**

`server/src/manifest.rs` validates submitted manifests. Add the same rule — accept absent, accept `"canvas"`/`"dom"`, reject anything else — with a Rust test. The two validators are a documented pair; a divergence means a bundle the server accepts and the app refuses.

- [ ] **Step 5: Run the tests**

Run: `cd app && npm test && npx tsc -b` then `cd ../server && cargo test`
Expected: PASS. Frontend 449 (445 + 4); server 63 (62 + 1).

- [ ] **Step 6: Commit**

```bash
git add app/src/sandbox/manifest.ts app/src/sandbox/manifest.test.ts server/src/manifest.rs
git commit -m "feat(sandbox): declare a bundle's render surface in the manifest"
```

---

### Task 2: A DOM root in the frame

**Files:**
- Modify: `app/src/sandbox/sandbox-html.ts`
- Modify: `app/src-tauri/src/sandbox.rs` (the byte-identical served copy)
- Test: `app/src/sandbox/sandbox-html.test.ts`

- [ ] **Step 1: Add the root element and its CSS**

The document becomes:

```html
<style>html,body{margin:0;padding:0;background:#000;overflow:hidden;width:100%;height:100%}
canvas,#root{display:block;width:100%;height:100%}
#root{position:absolute;inset:0}
canvas[hidden],#root[hidden]{display:none}</style>
<canvas id="c"></canvas>
<div id="root"></div>
```

- [ ] **Step 2: Expose it and honour the declared surface**

In the runtime, alongside `canvas: canvas`, expose `root: root`. On `init`, read `msg.surface` (the host sends it — Task 3) and hide the unused element:

```js
var useDom = msg.surface === 'dom';
canvas.hidden = useDom;
root.hidden = !useDom;
```

Default to canvas when `surface` is absent, so every published bundle is unaffected.

Clear `root` on re-init (`root.textContent = ''`) so a hot reload does not stack two renders. Note this does **not** fix the wider realm-contamination issue in `docs/deferred-findings.md` item 10 — stray timers from the previous load still survive.

- [ ] **Step 3: Keep the two copies byte-identical**

`sandbox.rs` embeds the same HTML and there is a test asserting they match. Update both. Do not "fix" the test's line-ending normalisation here — that is deferred-findings item 14.

- [ ] **Step 4: Write tests**

```ts
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
```

That third test is the important one. A DOM bundle will want to load an image or a font, and granting it is the single change that would hand untrusted code the whole app-command surface — see `docs/deferred-findings.md` item 2a.

- [ ] **Step 5: Run the tests**

Run: `cd app && npm test && npx tsc -b`
Expected: PASS. New total: 452 (449 + 3).

- [ ] **Step 6: Commit**

```bash
git add app/src/sandbox/sandbox-html.ts app/src-tauri/src/sandbox.rs app/src/sandbox/sandbox-html.test.ts
git commit -m "feat(sandbox): add a DOM root beside the canvas, selected by the manifest"
```

---

### Task 3: Send the surface, and render DOM bundles in the app

**Files:**
- Modify: `app/src/components/viz-sandbox-surface.tsx`
- Modify: `app/src/sandbox/manifest.ts` (the `init` message type)
- Test: `app/src/sandbox/manifest.test.ts`

- [ ] **Step 1: Carry `surface` on the init message**

Add `surface: 'canvas' | 'dom'` to `InitMessage`. The host reads the installed bundle's validated manifest and sends it with `init`. A bundle whose manifest failed validation never loads at all, so there is no untrusted path here.

- [ ] **Step 2: Verify in a packaged build**

Author a throwaway DOM bundle by hand under `%APPDATA%/com.secondmonitor.hub/visualizers/dom-probe/` with `surface: "dom"` and a `main.js` that appends a `<div>` whose width tracks `f.level`. Then:

Run: `cd app && npm run tauri build`, launch the release exe, select it, and confirm it renders and reacts to audio.

Then confirm a **canvas** bundle still renders unchanged — the twelve published ones all omit `surface`, and a regression there would break every existing visualizer.

Remove the probe bundle afterwards.

- [ ] **Step 3: Run the tests**

Run: `cd app && npm test && npx tsc -b`
Expected: PASS. New total: 453 (452 + 1).

- [ ] **Step 4: Commit**

```bash
git add app/src/components/viz-sandbox-surface.tsx app/src/sandbox/manifest.ts app/src/sandbox/manifest.test.ts
git commit -m "feat(sandbox): host sends the declared surface with init"
```

---

### Task 4: Port one DOM style end to end as proof

**Files:**
- Create: `bundles/neonbars/manifest.json`, `bundles/neonbars/main.js`, `bundles/neonbars/README.md`

`viz-extra.tsx`'s `VizNeonBars` is the simplest of the ten: 56 divs, `scaleY` per bar from a 56-bin spectrum reader, a two-stop gradient and a box-shadow glow. It is the right proof that the surface works before F ports the rest.

- [ ] **Step 1: Port it**

`surface: "dom"`, `api: 1`, no permissions. Build 56 divs once in `viz.on('frame')`'s first call (or at init), then per frame set `el.style.transform = 'scaleY(' + v + ')'` from `viz.bins(56)`.

Read `viz-extra.tsx:5-40` for the original. Match its look: `background: linear-gradient(0deg, accent2, accent)`, `boxShadow: 0 0 16px accent, 0 0 32px accent2 + '55'`, `borderRadius: 2`, `gap: 0.4%`, container `92%` wide and `70%` tall, centred.

Theme colours arrive on every frame as `f.theme.accent` / `f.theme.accent2` — do not hardcode them.

- [ ] **Step 2: Validate and verify**

Run: `cd app && npm run bundles:build` and confirm it validates and zips with only `manifest.json` + `main.js`.

Then install it locally and compare against the built-in `neonbars` side by side in a packaged build. Note any visual delta rather than asserting they match — `docs/deferred-findings.md` records that the earlier canvas ports had known, accepted deltas.

- [ ] **Step 3: Commit**

```bash
git add bundles/neonbars
git commit -m "feat(bundles): port neonbars as the first DOM-surface visualizer"
```

---

## Self-Review

**Coverage:** manifest field → Task 1 (both validators); frame surface → Task 2; host wiring → Task 3; proof → Task 4.

**Deliberately out of scope:** porting the other nine DOM styles (that is F); realm contamination on hot reload (deferred item 10); any CSP widening for bundle-loaded assets — a DOM bundle that wants an image must inline it as a data URI, and even that needs `img-src data:` which this plan does **not** grant.

**Type consistency:** `surface`, `VizManifest.surface`, `InitMessage.surface`, `buildSandboxHtml`, `SANDBOX_CSP` — each defined once and used identically after.

**Test totals:** frontend 445 → 453; server 62 → 63; app-cargo unchanged at 76.

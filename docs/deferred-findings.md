# Deferred findings

Things reviews surfaced that were deliberately **not** fixed at the time, with enough context to act on later without re-deriving them. Ordered by severity, not by when they were found.

Sources: the SDD ledgers under `.superpowers/sdd/` (gitignored — this file is the durable copy).

---

## Security

### 1. App-defined Tauri commands are not ACL-gated — **CRITICAL** *(fix in progress)*

Any page loaded in the browser tile can invoke every app command, including `secret_get`, and receive DPAPI-decrypted plaintext credentials.

- `tauri-2.10.3/src/webview/mod.rs:1801-1831` — the reject block runs only when the command is a `plugin:` command **or** the app ships an ACL manifest.
- `tauri-utils-2.8.3/src/acl/mod.rs:347-350` — `has_app_manifest` is `acl.contains_key("__app-acl__")`.
- `tauri-build-2.5.6/src/acl.rs:400-413` — that key appears only via `tauri_build::Attributes::app_manifest(...)` or a `src-tauri/permissions/` directory.
- This app has neither: `build.rs` is a bare `tauri_build::build();`, no `permissions/` dir, and `gen/schemas/acl-manifests.json` has zero `__app-acl__`. `capabilities/default.json` is a *capability*, not an app ACL manifest — for app commands `resolve_access` is never consulted.
- `Origin::Remote` **is** computed (`webview/mod.rs:1769-1775`) and then never consulted for app commands. The invoke key is injected into every webview unconditionally (`manager/webview.rs:176,189,501`), external ones included, and WebView2 does not honour `for_main_frame_only`, so ad sub-frames get it too.

Reachable via `app/src/state/browserWebview.ts:88-94`. Also exposes `secret_set`/`secret_delete`, `visualizers_write` (arbitrary code the app later runs), `tweaks_save`/`tweaks_import`, `app_open_url`, `app_send_hotkey`, `broker_fetch`, `marketplace_install`.

**Fix:** add an app ACL manifest so `has_app_acl` is true, then scope app commands to `"windows": ["main"]` / `"local": true`. Verify in a **packaged** build by pointing the browser tile at a page calling `invoke('secret_get')`.

### 2. Sandbox token gates `init` but not `settings:set` or `rpc` *(fix in progress)*

`app/src/components/viz-sandbox-surface.tsx:241-269`. The `rpc` and `settings:set` branches run before the token check at `:258`. In the fail-open scenario the token exists to close (a foreign document answering at `http://vizsandbox.localhost`), that document can still write `localStorage['scripted.settings.<bundleId>']` — later fed to the real bundle as `init.settings` — and reach the broker, since `brokerRef` is populated independently of `readyRef`. `tauri.invoke` stays dead (`BROKER_COMMANDS` empty); `net.fetch` to manifest-allowlisted hosts is live. Two comments claim a protection the code does not provide.

### 2a. The sandbox iframe is granted everything by the ACL — only the CSP stops it

**This is the highest-value thing in this file to remember before touching `SANDBOX_CSP`.**

`vizsandbox.localhost` is a registered URI scheme, so `webview/mod.rs:1707-1717` classifies it `Origin::Local`, inside webview label `main` — which satisfies the new `app-commands` capability exactly. The ACL contributes **nothing** to stopping the sandbox frame.

What actually stops it, in order:
1. `SANDBOX_CSP` has no `connect-src`, and on Windows Tauri's *primary* IPC transport is `fetch('http://ipc.localhost/<cmd>')` (`tauri-2.10.3/scripts/ipc-protocol.js`, `canUseCustomProtocol = osName !== 'android'`). `wry-0.54.4/src/webview2/mod.rs:941-947` registers that filter with `SOURCE_KINDS_ALL` when `ICoreWebView2_22` is present — it is — so sub-frame requests *are* intercepted and *would* reach Rust. The fetch dies at the policy layer instead.
2. Only then the fallback `window.ipc.postMessage`, broken by the shim's `delete window.chrome.webview` (cosmetic, trivially bypassed).
3. Only then main-frame-only `add_WebMessageReceived` as backstop.

So adding `connect-src https:` to `SANDBOX_CSP` — a plausible "let bundles fetch their own assets" feature — hands untrusted bundle code all 59 app commands. A test now pins this; do not delete it without understanding the above.

*(An earlier note in this file credited only `WebMessageReceived`. That was wrong and is corrected here.)*

### 2b. The browser tile's URL is an unvalidated bookmark string

`app/src/components/browser-player.tsx:9` accepts a bookmark with no scheme check, unlike `webtiles.rs:26-30`, which validates http(s) before mounting. Nothing exploitable is served there today and the ACL now blocks app commands from that webview, but the foot-gun shape is live.

### 3. `EMBEDDER_ORIGIN` is hardcoded

`app/src-tauri/src/sandbox.rs:71`. Derived from the current config by hand rather than read from it. Enabling `useHttpsScheme` would break the sandbox — fails closed, so safe, but silently. Same for the Windows-only `http://<scheme>.localhost` form, which assumes nsis is the only target.

### 4. `is_safe_id` exists in four byte-identical copies

`marketplace.rs:86`, `seed.rs`, `tiles.rs:47`, `visualizers.rs:51`. Verified identical today. A future tightening will reach one of them. Promote one to `pub(crate)`.

### 5. Old WebView2 without `ICoreWebView2_22` is mitigated, not fixed

The token closes the exploit, but the underlying fail-open (sub-frame requests unintercepted, resolving to `127.0.0.1:80`) is untested on such a runtime — nobody has one to hand.

---

## Correctness

### 6. Offline reinstall of a removed *seeded* bundle is unreachable

`handleRestore` is index-free, but the card can't render without `mergeCatalog` producing the item, and offline a removed seeded bundle appears in no pass (pass 1 is built-ins only, pass 2's folder was deleted, pass 3 is empty with no index cache). Needs fully-offline **and** every live tombstone being a seeded bundle. Fix: cache the last good index, or synthesize a minimal catalog entry from the tombstone key so the Removed row can always name what it holds.

### 7. `seed_sync` is a synchronous command on the main thread

`seed.rs`. It is now on the boot path, where a fresh install extracts ~15 zips before the IPC returns. The frontend satisfies "never blocks the window"; the backend does not. `#[tauri::command(async)]` would make the guarantee true end to end. Consistent with a repo-wide pattern — `marketplace_fetch_index` does a blocking HTTP GET on the main thread too.

### 8. Minimize does not pause the visualizer

A minimized window still reports `is_visible() == true`, so no `hub://window-visibility` event fires and everything keeps rendering. Unhandled on `main` as well as here. Needs a `WindowEvent::Resized`/minimize check.

### 9. `needsSetup` is narrower than it looks

Wired to declared **secrets** only, not config — `bundleSecretKey(bundleId, key)` has no `instanceId` while config is per-instance, so the catalog level genuinely has an answer for one and not the other. It *also* requires `source === 'marketplace'` **and** a live index entry, so offline the "Needs setup" rail row is always empty and the `needs key` tag never appears regardless of secrets state.

### 10. Hot-reload realm contamination

`reloadKey` re-inits without remounting the frame, so the shim's `init` resets `frameCbs` and `settingsCache` but a previous edit's raw `requestAnimationFrame`/`setInterval` loops, globals and listeners survive in the same realm. Unreachable until hot reload started working; now live. Confined to reloads of the same bundle id.

### 11. `installed.json`'s `origin` field is write-only

Recorded as `"seed" | "marketplace"` but never read — `folder_source` derives only `marketplace | local` from the file's presence. The spec said the catalog would use it to label provenance. Surface it or drop it.

### 12. `bundles.mjs seed` never removes a zip for a deleted bundle

`cleanStaleSeedZips` only clears *other versions of the same id*, so a retired bundle's zip stays in resources and keeps being seeded.

---

## Test coverage

### 13. No React component test harness, and no way to test a Tauri command end to end

This is the root cause of most gaps below, and of **four** real bugs that shipped past a green suite this session: two React StrictMode races, a silently no-op'd removal for camelCase ids, and the CSP inheritance failure.

The pattern that works, now applied six times (`plan_seeds`, `resolve_zip_bytes`, `planRemoval`, `restoreDefaults`, `loadPreview`, `previewBudget`): **extract the decision into a pure function, inject the effect, test the decision.** Worth making an explicit, documented convention rather than something each task rediscovers.

Still untested as a result: `PreviewImage`/`LivePreview` teardown paths, `ContentLibrary`'s mutation handlers and mount effect, the `useTweaks` hydration gate, the boot `seed_sync` effect.

### 14. Vacuous or weak tests

- The previewCache "in-flight cleared on both outcomes" test is confounded by `__resetPreviewCacheForTest`, which wipes `inflight` itself — deleting the production cleanup would not fail it.
- The sandbox drift test normalizes line endings, so it cannot catch the drift it exists to catch; `.gitattributes -text` is the real protection.
- Host-side message-guard tests are substring matches over `.tsx` source text — they pass with an early `return` above the guard, or with the guard commented out.

### 15. Missing pins

`buildRail([])`; a top-level rail row absent at zero count; `hasPreview` surviving pass 4's removal spread; the image branch winning over live for an item that is both; `applyRemovals` for `kind: 'tile'`; `stemIdOf`/`cleanStaleSeedZips` (no harness — `scripts/` sits outside the `src/**/*.test.ts` glob).

---

## Structure

### 16. `ContentLibrary.tsx` is ~600 lines across four concerns

Data loading, the merge/rail/search pipeline, mutation handlers, and multi-branch JSX. **Deliberately not split** — a reviewer ruled that every decision with a wrong answer is already a pure tested module, so a split now would move untestable code between untestable files. Revisit when previews add a second real reason for a data layer to exist.

---

## Operational

### 17. Sibling worktrees evict each other's running app

`2ndmonitor-milkdrop` and `2ndmonitor-tron` share the app identifier and `%APPDATA%`, so a build from one replaces the other's running instance and they contend for `tweaks.json` and the installed-bundle directories. Bit a live verification run in this session.

### 18. No CI pipeline

`.github/workflows` does not exist. Relevant because the `tauri dev` resource-caching gap (new resource files aren't copied into `target/debug/resources` until `build.rs` reruns) would ship stale resources from an incremental pipeline without a `cargo clean` or a `build.rs` touch.

### 19. Non-deterministic seed zip

`aurora-1.0.0.zip` differs byte-for-byte on every rebuild from a `Compress-Archive` timestamp, so it shows as modified after any `bundles:seed` run. Pre-existing.

---

## Infrastructure

### 20. `market.basedsecurity.net` HTTPS route destroyed by an NPM ID collision — **live outage**

As of 2026-07-31 the public marketplace URL is unreachable. The server itself is healthy (`{"ok":true}` on `http://192.168.1.145:8787`); only the reverse-proxy route is gone.

Cause: a `crew.basedsecurity.net` proxy host was created in the Nginx Proxy Manager UI at 01:54, and NPM allocated it ID **18** — colliding with the hand-written `/srv/appdata/npm/data/nginx/proxy_host/18.conf` that was the marketplace's route. It overwrote the file **and** re-issued the `npm-18` Let's Encrypt certificate for `crew` only. No conf mentions `market.basedsecurity.net`, and no certificate on the box covers it.

This is the exact failure the original deploy notes warned about: NPM's sqlite db does not know about hand-written conf files, so its UI will reuse their IDs.

**To restore** (needs a human decision — both steps reach outside the repo):
1. Re-issue a cert: `sudo docker exec nginx_proxy_manager certbot certonly --webroot --webroot-path=/data/letsencrypt-acme-challenge --cert-name <new-name> -d market.basedsecurity.net`. Outward-facing — Let's Encrypt rate limits (5 duplicate certs/week) and public CT logs.
2. Write a new proxy host at a **high, collision-proof ID** (e.g. `900.conf`) rather than re-taking a low number, forwarding to `172.17.0.1:8787`, force-ssl, `client_max_body_size 32m` for bundle zips, and **not** behind Authentik (the desktop app calls it programmatically and cannot do interactive SSO). Validate with `docker exec nginx_proxy_manager nginx -t` before `nginx -s reload` — that file fronts ~17 subdomains.

Note the app's marketplace client hard-requires `https://`, so there is no LAN-URL workaround for testing.

### 21. E4's visual comparison was never done

`bundles/neonbars` (the first DOM-surface bundle) validates, zips with exactly `manifest.json` + `main.js`, and passes the bundle smoke suite — but the **side-by-side comparison against the built-in `VizNeonBars` in a packaged build was not performed**. The task was cut off by an account spend limit partway through.

The built-in is deliberately untouched, so both remain selectable and the comparison is still available. Earlier canvas ports had known, accepted deltas (see the MilkDrop project notes), so expect differences and judge them rather than assuming identity.

Everything the smoke suite proves is that the bundle *runs and builds elements* — `fakeElement` records `scaleY(NaN)` as cleanly as a real value.

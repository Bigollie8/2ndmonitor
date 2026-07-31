//! Custom URI-scheme protocol that serves the scripted-visualizer sandbox
//! document with its **own** `Content-Security-Policy` response header.
//!
//! # Why this exists
//!
//! The sandbox used to be delivered as an iframe `srcdoc`. `about:srcdoc` is a
//! *local scheme*, so per the CSP spec its policy container is inherited from
//! the embedder, and multiple policies apply by intersection. In a packaged
//! build Tauri injects the app CSP from `tauri.conf.json`, whose `script-src`
//! is `'self'`; intersected with the sandbox's own `'unsafe-inline'
//! 'unsafe-eval'` that leaves **nothing**, so the sandbox's inline runtime
//! shim never executed and no scripted visualizer has ever run in a packaged
//! build. `tauri dev` hid it entirely, because Tauri injects no CSP against a
//! Vite-served document.
//!
//! A document *fetched from a URL* does not inherit the embedder's policy
//! container - it gets exactly the policy its own response carries. So the
//! frame now loads from this protocol, which sets the header directly. The
//! iframe keeps `sandbox="allow-scripts"` with no `allow-same-origin`, so it
//! is still an opaque origin (no cookies, no storage, no Tauri IPC); a real
//! `src` does not change that.
//!
//! # Addressing
//!
//! WebView2 cannot register non-standard schemes, so wry rewrites custom
//! protocols to `http://<scheme>.localhost/...` on Windows and Android and
//! intercepts them with a `WebResourceRequested` filter
//! (`wry-0.54.4/src/custom_protocol_workaround.rs`, and
//! `attach_custom_protocol_handler` in `src/webview2/mod.rs`, which uses
//! `AddWebResourceRequestedFilterWithRequestSourceKinds(..., SOURCE_KINDS_ALL)`
//! specifically so iframes can load custom protocols). macOS/Linux would use
//! `<scheme>://localhost/...`. The frontend's `SANDBOX_ORIGIN`
//! (src/sandbox/sandbox-html.ts) and `tauri.conf.json`'s `frame-src` both
//! encode the Windows form; `nsis` is the only bundle target.
//!
//! Tauri does not touch headers on custom-scheme responses - it only injects
//! `Content-Security-Policy` for its own asset protocol
//! (`tauri-2.10.3/src/protocol/tauri.rs`, from `asset.csp_header`) - so what
//! is set below is exactly what the frame receives.

use std::sync::OnceLock;

use tauri::http::{Request, Response};
use tauri::{AppHandle, Runtime, UriSchemeContext};

/// Must match `SANDBOX_SCHEME` in `app/src/sandbox/sandbox-html.ts`.
pub const SCHEME: &str = "vizsandbox";

/// Generated from `buildSandboxHtml()` by `npm run gen:sandbox`, which
/// `predev`/`prebuild` run before cargo ever compiles this file. The generated
/// artifact is committed and a frontend test fails if it drifts from the TS
/// source, so a stale document cannot ship.
const SANDBOX_HTML: &str = include_str!("../sandbox.html");

/// Must match `SANDBOX_CSP` in `app/src/sandbox/sandbox-html.ts` (a frontend
/// test pins the two together). `default-src 'none'` kills fetch/XHR/img/
/// script-src/websocket at the policy layer even if user code builds a URL;
/// `script-src 'unsafe-inline' 'unsafe-eval'` is exactly what the runtime shim
/// and its `new Function(userCode)()` need and nothing else - no `'self'`, no
/// host source, so there is no URL the frame may load script from.
///
/// `frame-ancestors` is appended per-response by [`csp_with_ancestors`] rather
/// than baked in here, because the embedder's origin differs between a
/// packaged build and `tauri dev`.
const SANDBOX_CSP: &str =
    "default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval'; style-src 'unsafe-inline'";

/// The one document allowed to frame the sandbox in a packaged build: the app
/// itself. Tauri serves the frontend from `http://tauri.localhost` on Windows
/// (`use_https_scheme` is not set; observed live in the release exe).
const EMBEDDER_ORIGIN: &str = "http://tauri.localhost";

/// `frame-ancestors` does NOT fall back to `default-src`, so without this
/// directive *anything* may frame the sandbox - and something can: `webtiles`
/// mounts arbitrary user-configured web pages as child webviews
/// (`WebviewUrl::External`), which go through the same
/// `prepare_pending_webview` path and therefore get this scheme registered on
/// them too, while the app's own `frame-src` does not apply to them at all
/// (Tauri injects CSP only into its own asset responses; a remote page gets
/// whatever its server sends). A page in a webtile could otherwise frame this
/// document *without* the `sandbox` attribute and drive the runtime as its
/// parent - the shim's `ev.source === parent` check passes, because the
/// attacker *is* the parent - running attacker JS through `new Function` at
/// this scheme's origin, which `is_local_url()` classifies as `Origin::Local`.
///
/// `'self'` would be wrong here: it names *this* scheme's origin, not the
/// embedder's. The embedder is named explicitly instead.
fn csp_with_ancestors(dev_origin: Option<&str>) -> String {
    let mut csp = format!("{SANDBOX_CSP}; frame-ancestors {EMBEDDER_ORIGIN}");
    if let Some(origin) = dev_origin {
        csp.push(' ');
        csp.push_str(origin);
    }
    csp
}

/// The dev server's origin, and only in a debug build. `tauri dev` loads the
/// frontend from `build.devUrl`, so that document - not `tauri.localhost` - is
/// the embedder there. Gated on `debug_assertions` so a release binary can
/// never be framed by a dev server origin even though the value stays in the
/// embedded config.
fn dev_origin<R: Runtime>(app: &AppHandle<R>) -> Option<String> {
    if !cfg!(debug_assertions) {
        return None;
    }
    app.config()
        .build
        .dev_url
        .as_ref()
        .map(|u| u.origin().ascii_serialization())
}

/// Substituted with [`token()`] on the way out. See that function.
const TOKEN_PLACEHOLDER: &str = "__SANDBOX_TOKEN__";

/// A per-process random value the served document echoes back in its `ready`
/// message, so the host can tell a document *this handler served* from one
/// that merely arrived at the same URL.
///
/// That is not hypothetical. wry only intercepts sub-frame requests for custom
/// protocols when `ICoreWebView2_22` is available; without it
/// (`wry-0.54.4/src/webview2/mod.rs:941-950`) it falls back to
/// `AddWebResourceRequestedFilter`, which defaults to the DOCUMENT source kind
/// and never sees the iframe's request. The load then fails *open*, not
/// closed: Chromium resolves any `*.localhost` name to loopback, so the frame
/// issues a real `GET http://127.0.0.1:80/index.html`, and whatever is
/// listening there answers. That response would pass both host-side checks -
/// it is still the real `iframe.contentWindow`, and still opaque-origin
/// (`e.origin === "null"`) because the `sandbox` attribute is the iframe's, not
/// the document's - while carrying no `default-src 'none'`, so it would have
/// full network, could make the host post it an installed bundle's source, and
/// could write attacker-chosen keys into `scripted.settings.<id>`.
///
/// A local server cannot know this value: it is generated in-process, is never
/// written to disk, and is handed to the frontend only over IPC from the main
/// webview (see [`sandbox_token`]).
pub fn token() -> &'static str {
    static TOKEN: OnceLock<String> = OnceLock::new();
    TOKEN.get_or_init(|| hex::encode(rand::random::<[u8; 16]>()))
}

/// Hands the frontend the value it must see echoed in `ready` before it will
/// init a frame.
///
/// Restricted to the main webview. App-defined commands are not ACL-gated
/// unless the app ships an ACL manifest (`tauri-2.10.3/src/webview/mod.rs`:
/// *"we only check ACL on plugin commands or if the app defined its ACL
/// manifest"*), so without this check any remote page mounted as a webtile
/// could read the token over IPC.
#[tauri::command]
pub fn sandbox_token<R: Runtime>(webview: tauri::Webview<R>) -> Result<String, String> {
    if webview.label() != "main" {
        return Err("sandbox_token is only available to the main webview".into());
    }
    Ok(token().to_string())
}

/// The document is the same for every instance and every visualizer - the
/// bundle's code arrives afterwards over `postMessage` `init`, never baked into
/// the HTML - so every path under the scheme serves the same bytes and the
/// request is not consulted at all. Only the per-process token and the
/// embedder origin are substituted in.
pub fn handle<R: Runtime>(ctx: UriSchemeContext<'_, R>, _req: Request<Vec<u8>>) -> Response<Vec<u8>> {
    build_response(dev_origin(ctx.app_handle()).as_deref())
}

/// The entire body of [`handle`], split out only so tests can drive the real
/// response builder rather than re-asserting the constants it reads.
fn build_response(dev_origin: Option<&str>) -> Response<Vec<u8>> {
    let body = SANDBOX_HTML.replace(TOKEN_PLACEHOLDER, token());
    Response::builder()
        .status(200)
        .header("Content-Type", "text/html; charset=utf-8")
        .header("Content-Security-Policy", csp_with_ancestors(dev_origin))
        // The whole point of this module: without nosniff a response body is
        // still only interpreted per Content-Type, but pinning it costs
        // nothing and keeps the frame from ever being treated as anything
        // other than the HTML document written above.
        .header("X-Content-Type-Options", "nosniff")
        // The generated document changes only across builds, but a cached
        // copy surviving a rebuild would resurrect exactly the class of
        // "the artifact does not match the source" bug this module fixes.
        // It also keeps the token out of any on-disk cache.
        .header("Cache-Control", "no-store")
        .body(body.into_bytes())
        .expect("static sandbox response is always well-formed")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn csp_grants_no_network_and_no_script_urls() {
        assert!(SANDBOX_CSP.starts_with("default-src 'none'"));
        let script_src = SANDBOX_CSP
            .split(';')
            .map(str::trim)
            .find(|d| d.starts_with("script-src "))
            .expect("script-src directive");
        // Exactly the two documented tokens - no 'self', no scheme, no host.
        assert_eq!(script_src, "script-src 'unsafe-inline' 'unsafe-eval'");
        assert!(!SANDBOX_CSP.contains("connect-src"));
        assert!(!SANDBOX_CSP.contains("http"));
    }

    #[test]
    fn served_response_carries_the_csp_header() {
        // Drive the real builder: a header that is only asserted as a
        // constant proves nothing about what the frame actually receives.
        let res = build_response(None);
        assert_eq!(res.status(), 200);
        assert_eq!(
            res.headers()
                .get("Content-Security-Policy")
                .and_then(|v| v.to_str().ok()),
            Some(csp_with_ancestors(None).as_str()),
            "the frame's policy must arrive as a real header, not only as <meta>"
        );
        assert_eq!(
            res.headers().get("Content-Type").and_then(|v| v.to_str().ok()),
            Some("text/html; charset=utf-8")
        );
        assert!(
            std::str::from_utf8(res.body()).unwrap().contains("<canvas id=\"c\">"),
            "response body is the sandbox document"
        );
    }

    #[test]
    fn frame_ancestors_names_the_embedder_and_nothing_else() {
        // Without this directive any document may frame the sandbox, including
        // an arbitrary remote page mounted as a webtile - see the doc comment
        // on csp_with_ancestors.
        let packaged = csp_with_ancestors(None);
        assert!(packaged.starts_with(SANDBOX_CSP), "base policy must be unchanged");
        assert_eq!(
            packaged
                .split(';')
                .map(str::trim)
                .find(|d| d.starts_with("frame-ancestors")),
            Some("frame-ancestors http://tauri.localhost"),
            "a packaged build must be framable only by the app document"
        );
        assert!(!packaged.contains('*'), "no wildcard ancestor");
        assert!(!packaged.contains("'self'"), "'self' would name this scheme, not the embedder");

        // Dev appends the dev-server origin, and only that.
        let dev = csp_with_ancestors(Some("http://localhost:1420"));
        assert!(dev.ends_with("frame-ancestors http://tauri.localhost http://localhost:1420"));
    }

    #[test]
    fn served_document_carries_a_fresh_token_and_leaks_no_placeholder() {
        // The placeholder must exist exactly once in the committed artifact,
        // or the substitution silently does nothing and every `ready` is
        // rejected (fail-closed, but invisibly).
        assert_eq!(
            SANDBOX_HTML.matches(TOKEN_PLACEHOLDER).count(),
            1,
            "sandbox.html must carry exactly one token placeholder"
        );
        let body = String::from_utf8(build_response(None).body().clone()).unwrap();
        assert!(!body.contains(TOKEN_PLACEHOLDER), "placeholder must be substituted");
        assert!(body.contains(token()), "served document must carry the live token");
    }

    #[test]
    fn token_is_stable_random_hex() {
        let t = token();
        assert_eq!(t.len(), 32, "128 bits, hex");
        assert!(t.chars().all(|c| c.is_ascii_hexdigit()));
        assert_eq!(t, token(), "must be stable for the life of the process");
    }

    #[test]
    fn served_document_contains_the_runtime() {
        let html = SANDBOX_HTML;
        assert!(html.contains("addEventListener('message'"), "runtime shim present");
        assert!(html.contains("new Function(msg.code)"), "eval path present");
        assert!(
            html.contains("parent === window || ev.source !== parent"),
            "embedder-only guard present, and not degenerate at top level"
        );
        assert!(html.contains("type: 'ready', token:"), "ready echoes the token");
        // The document must not reach for anything off-origin.
        assert!(!html.contains("http://"), "no absolute http URLs in the document");
        assert!(!html.contains("https://"), "no absolute https URLs in the document");
    }

    #[test]
    fn scheme_is_a_single_hostname_label() {
        // wry maps this to http://<scheme>.localhost on Windows, so anything
        // that is not a legal DNS label silently fails to load.
        assert!(!SCHEME.is_empty());
        assert!(SCHEME
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-'));
        assert!(!SCHEME.starts_with('-') && !SCHEME.ends_with('-'));
    }
}

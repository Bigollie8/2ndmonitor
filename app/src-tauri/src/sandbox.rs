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

use tauri::http::{Request, Response};
use tauri::{Runtime, UriSchemeContext};

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
/// Deliberately no `frame-ancestors`: it does not fall back to `default-src`,
/// and `'self'` would refer to this scheme's origin, which is *not* the
/// embedder's - setting it would block the app from framing its own sandbox.
const SANDBOX_CSP: &str =
    "default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval'; style-src 'unsafe-inline'";

/// The document is static for every instance and every visualizer: the
/// bundle's code arrives afterwards over `postMessage` `init`, never baked
/// into the HTML. So every path under the scheme serves the same bytes, and
/// the request is not consulted at all.
pub fn handle<R: Runtime>(_ctx: UriSchemeContext<'_, R>, _req: Request<Vec<u8>>) -> Response<Vec<u8>> {
    build_response()
}

/// The entire body of [`handle`], split out only so tests can drive the real
/// response builder rather than re-asserting the constants it reads.
fn build_response() -> Response<Vec<u8>> {
    Response::builder()
        .status(200)
        .header("Content-Type", "text/html; charset=utf-8")
        .header("Content-Security-Policy", SANDBOX_CSP)
        // The whole point of this module: without nosniff a response body is
        // still only interpreted per Content-Type, but pinning it costs
        // nothing and keeps the frame from ever being treated as anything
        // other than the HTML document written above.
        .header("X-Content-Type-Options", "nosniff")
        // The generated document changes only across builds, but a cached
        // copy surviving a rebuild would resurrect exactly the class of
        // "the artifact does not match the source" bug this module fixes.
        .header("Cache-Control", "no-store")
        .body(SANDBOX_HTML.as_bytes().to_vec())
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
        let res = build_response();
        assert_eq!(res.status(), 200);
        assert_eq!(
            res.headers()
                .get("Content-Security-Policy")
                .and_then(|v| v.to_str().ok()),
            Some(SANDBOX_CSP),
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
    fn served_document_contains_the_runtime() {
        let html = SANDBOX_HTML;
        assert!(html.contains("addEventListener('message'"), "runtime shim present");
        assert!(html.contains("new Function(msg.code)"), "eval path present");
        assert!(html.contains("ev.source !== parent"), "embedder-only guard present");
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

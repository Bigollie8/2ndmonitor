//! Marketplace client: fetch the ed25519-signed index from the user's server,
//! verify signatures and per-bundle SHA-256, and install approved bundles into
//! the phase-1/2 content stores (presets/, visualizers/). Also `broker_fetch`,
//! the https-only, size-capped fetch the sandbox permission broker performs on
//! behalf of installed tiles.
//!
//! Trust: the app pins the server's public key (pasted once by the user). An
//! index whose signature doesn't verify, or a bundle whose hash doesn't match
//! the signed index, is refused. Zip extraction is allowlisted to known entry
//! names so a malicious archive can't write outside the target folder.

use ed25519_dalek::{Signature, Verifier, VerifyingKey};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::io::Read;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager, Runtime};

const FETCH_CAP: usize = 1_048_576; // 1 MiB
const ZIP_CAP: usize = 4_194_304; // 4 MiB per bundle

/// Mirror of the server's `keys::verify_index` — the signature covers the exact
/// serialized `bundles` array substring, verified verbatim.
pub fn verify_index(bundles_json: &str, sig_hex: &str, pubkey_hex: &str) -> bool {
    let Ok(pk_bytes) = hex::decode(pubkey_hex) else { return false };
    let Ok(pk_arr) = <[u8; 32]>::try_from(pk_bytes.as_slice()) else { return false };
    let Ok(pk) = VerifyingKey::from_bytes(&pk_arr) else { return false };
    let Ok(sig_bytes) = hex::decode(sig_hex) else { return false };
    let Ok(sig_arr) = <[u8; 64]>::try_from(sig_bytes.as_slice()) else { return false };
    pk.verify(bundles_json.as_bytes(), &Signature::from_bytes(&sig_arr)).is_ok()
}

/// Pull the raw `"bundles":[...]` array substring out of the index body so it
/// can be verified byte-for-byte against the signature.
fn extract_bundles_str(raw: &str) -> Option<&str> {
    let key = "\"bundles\":";
    let start = raw.find(key)? + key.len();
    let rest = &raw[start..];
    let end = rest.rfind(",\"pubkey\"")?;
    Some(&rest[..end])
}

fn get_capped(url: &str) -> Result<Vec<u8>, String> {
    if !url.starts_with("https://") {
        return Err("only https URLs are allowed".into());
    }
    let resp = ureq::get(url)
        .timeout(std::time::Duration::from_secs(10))
        .call()
        .map_err(|e| format!("request failed: {e}"))?;
    let mut buf = Vec::new();
    resp.into_reader()
        .take((FETCH_CAP + 1) as u64)
        .read_to_end(&mut buf)
        .map_err(|e| format!("read failed: {e}"))?;
    if buf.len() > FETCH_CAP {
        return Err("response too large".into());
    }
    Ok(buf)
}

#[tauri::command]
pub fn marketplace_fetch_index(url: String, pubkey: String) -> Result<serde_json::Value, String> {
    let base = url.trim_end_matches('/');
    let body_bytes = get_capped(&format!("{base}/index.json"))?;
    let body = String::from_utf8(body_bytes).map_err(|_| "index not UTF-8".to_string())?;
    let v: serde_json::Value = serde_json::from_str(&body).map_err(|e| format!("index not JSON: {e}"))?;
    let sig = v.get("sig").and_then(|s| s.as_str()).ok_or("index missing sig")?;
    let bundles_str = extract_bundles_str(&body).ok_or("index malformed")?;
    if !verify_index(bundles_str, sig, &pubkey) {
        return Err("index signature does not verify — wrong key or tampered index".into());
    }
    Ok(v)
}

fn content_dir<R: Runtime>(app: &AppHandle<R>, sub: &str) -> Result<std::path::PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app_data_dir: {e}"))?
        .join(sub);
    std::fs::create_dir_all(&dir).map_err(|e| format!("create {sub}: {e}"))?;
    Ok(dir)
}

fn is_safe_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 64
        && id.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
}

/// Provenance marker read by `visualizers::folder_entry` (via `folder_source`)
/// to distinguish deliberately-installed content from a hand-authored draft.
/// Written on every successful install so it survives a restart; deleted
/// along with the rest of the folder on uninstall.
fn write_installed_marker(dir: &std::path::Path, id: &str, version: &str, kind: &str) -> Result<(), String> {
    let installed_at = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let marker = serde_json::json!({
        "id": id,
        "version": version,
        "kind": kind,
        "installed_at": installed_at,
    });
    std::fs::write(dir.join("installed.json"), marker.to_string())
        .map_err(|e| format!("write installed.json: {e}"))
}

#[tauri::command]
pub fn marketplace_install<R: Runtime>(
    app: AppHandle<R>,
    url: String,
    id: String,
    version: String,
    sha256: String,
    kind: String,
) -> Result<(), String> {
    if !is_safe_id(&id) {
        return Err("invalid bundle id".into());
    }
    let base = url.trim_end_matches('/');
    let zip_bytes = get_capped(&format!("{base}/bundle/{id}/{version}"))?;
    if zip_bytes.len() > ZIP_CAP {
        return Err("bundle too large".into());
    }
    let got = hex::encode(Sha256::digest(&zip_bytes));
    if got != sha256 {
        return Err("bundle hash does not match the signed index — refusing to install".into());
    }

    let mut archive = zip::ZipArchive::new(std::io::Cursor::new(zip_bytes))
        .map_err(|e| format!("bad zip: {e}"))?;
    let mut entries: std::collections::HashMap<String, String> = std::collections::HashMap::new();
    for i in 0..archive.len() {
        let mut f = archive.by_index(i).map_err(|e| format!("zip entry: {e}"))?;
        let name = f.name().to_string();
        // Allowlist exact entry names — no paths, no traversal. Deliberately
        // excludes installed.json: that marker is written by us on install,
        // never accepted from a downloaded bundle, so a malicious archive
        // can't self-certify marketplace provenance (see folder_source in
        // visualizers.rs / tiles.rs).
        if !matches!(name.as_str(), "manifest.json" | "main.js" | "preset.json" | "view.json") {
            return Err(format!("unexpected file in bundle: {name}"));
        }
        let mut s = String::new();
        f.read_to_string(&mut s).map_err(|e| format!("read {name}: {e}"))?;
        entries.insert(name, s);
    }

    match kind.as_str() {
        "visualizer" => {
            let manifest = entries.get("manifest.json").ok_or("bundle missing manifest.json")?;
            let code = entries.get("main.js").ok_or("bundle missing main.js")?;
            let dir = content_dir(&app, "visualizers")?.join(&id);
            std::fs::create_dir_all(&dir).map_err(|e| format!("create {id}: {e}"))?;
            std::fs::write(dir.join("manifest.json"), manifest).map_err(|e| format!("write manifest: {e}"))?;
            std::fs::write(dir.join("main.js"), code).map_err(|e| format!("write main.js: {e}"))?;
            write_installed_marker(&dir, &id, &version, &kind)?;
        }
        "tile" => {
            let manifest = entries.get("manifest.json").ok_or("bundle missing manifest.json")?;
            let view = entries.get("view.json").ok_or("bundle missing view.json")?;
            let dir = content_dir(&app, "tiles")?.join(&id);
            std::fs::create_dir_all(&dir).map_err(|e| format!("create {id}: {e}"))?;
            std::fs::write(dir.join("manifest.json"), manifest).map_err(|e| format!("write manifest: {e}"))?;
            std::fs::write(dir.join("view.json"), view).map_err(|e| format!("write view.json: {e}"))?;
            write_installed_marker(&dir, &id, &version, &kind)?;
        }
        "preset" => {
            let preset = entries.get("preset.json").ok_or("bundle missing preset.json")?;
            let dir = content_dir(&app, "presets")?;
            std::fs::write(dir.join(format!("{id}.json")), preset).map_err(|e| format!("write preset: {e}"))?;
        }
        other => return Err(format!("unknown kind {other}")),
    }
    Ok(())
}

#[tauri::command]
pub fn marketplace_uninstall<R: Runtime>(app: AppHandle<R>, id: String, kind: String) -> Result<(), String> {
    if !is_safe_id(&id) {
        return Err("invalid bundle id".into());
    }
    match kind.as_str() {
        "visualizer" => {
            let dir = content_dir(&app, "visualizers")?.join(&id);
            if dir.exists() {
                std::fs::remove_dir_all(&dir).map_err(|e| format!("remove {id}: {e}"))?;
            }
        }
        "tile" => {
            let dir = content_dir(&app, "tiles")?.join(&id);
            if dir.exists() {
                std::fs::remove_dir_all(&dir).map_err(|e| format!("remove {id}: {e}"))?;
            }
        }
        "preset" => {
            let f = content_dir(&app, "presets")?.join(format!("{id}.json"));
            if f.exists() {
                std::fs::remove_file(&f).map_err(|e| format!("remove {id}: {e}"))?;
            }
        }
        other => return Err(format!("unknown kind {other}")),
    }
    Ok(())
}

#[derive(Serialize)]
pub struct BrokerResponse {
    pub status: u16,
    pub body: String,
}

const MAX_HEADERS: usize = 16;
const MAX_HEADER_VALUE_BYTES: usize = 4096;

fn is_valid_header_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 64
        && name.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-')
}

/// Non-empty, size-capped, and free of CR/LF/NUL/other ASCII control bytes
/// (`is_ascii_control` covers 0x00-0x1F and 0x7F, i.e. exactly the CRLF-
/// injection-capable range plus NUL).
fn is_valid_header_value(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= MAX_HEADER_VALUE_BYTES
        && !value.bytes().any(|b| b.is_ascii_control())
}

/// Validates a bundle-declared header map before it reaches the outgoing
/// request. These names/values are built host-side from substituted config
/// and secret values (see `tiles/request.ts`'s `buildRequest`), so unlike the
/// url check above they are NOT trusted input — a manifest author (or a
/// compromised/malicious upstream API response feeding back into a config
/// value) could otherwise smuggle a CRLF sequence into a header and inject a
/// second header or split the request. Reject rather than sanitise: a value
/// that needed stripping is a bug the tile author should see, not something
/// silently fixed up for them.
fn validate_headers(headers: &std::collections::HashMap<String, String>) -> Result<(), String> {
    if headers.len() > MAX_HEADERS {
        return Err(format!("too many headers (max {MAX_HEADERS})"));
    }
    for (name, value) in headers {
        if !is_valid_header_name(name) {
            return Err(format!(
                "invalid header name {name:?} (must be 1-64 chars of [A-Za-z0-9-])"
            ));
        }
        // Case-insensitive: a bundle setting either of these could retarget
        // the request (Host) or desync the body length (Content-Length).
        let lower = name.to_ascii_lowercase();
        if lower == "host" || lower == "content-length" {
            return Err(format!("header {name:?} may not be set by a tile"));
        }
        if !is_valid_header_value(value) {
            return Err(format!(
                "invalid value for header {name:?} (must be non-empty, <= {MAX_HEADER_VALUE_BYTES} bytes, no control characters)"
            ));
        }
    }
    Ok(())
}

/// True for any 3xx status. Pulled out as a pure function so the "reject a
/// redirect" rule is unit-testable without a network round-trip.
fn is_redirect_status(status: u16) -> bool {
    (300..400).contains(&status)
}

/// The fetch the sandbox broker performs for installed tiles. Host allowlisting
/// is enforced in the frontend broker (broker.ts) before this is called; this
/// enforces https + size caps as defense in depth. `headers` lets a tile's
/// declared request (e.g. `Authorization: Bearer <secret>`) actually reach the
/// server — see `validate_headers` for why they're strictly validated rather
/// than passed through as-is.
///
/// Redirects are never followed (`redirects(0)`). `brokerDecide` (broker.ts)
/// only checks the INITIAL url's host before this command is ever invoked; a
/// default ureq agent follows up to 5 redirects and isn't `https_only`, so an
/// allowlisted host could 302 to `http://127.0.0.1:…` or a LAN address and the
/// response would flow straight into the tile's scope — SSRF straight through
/// the permission check, with non-Authorization secret headers still attached
/// across the hop (I2). With `redirects(0)` a 3xx is just an ordinary
/// response ureq hands back without following; it's turned into a clear error
/// below instead of silently chasing the Location header.
#[tauri::command]
pub fn broker_fetch(
    url: String,
    headers: Option<std::collections::HashMap<String, String>>,
) -> Result<BrokerResponse, String> {
    if !url.starts_with("https://") {
        return Err("only https URLs are allowed".into());
    }
    if let Some(h) = &headers {
        validate_headers(h)?;
    }
    let agent = ureq::AgentBuilder::new().redirects(0).build();
    let mut req = agent.get(&url).timeout(std::time::Duration::from_secs(10));
    if let Some(h) = &headers {
        for (name, value) in h {
            req = req.set(name, value);
        }
    }
    let resp = req.call().map_err(|e| format!("request failed: {e}"))?;
    let status = resp.status();
    if is_redirect_status(status) {
        return Err(format!(
            "server responded with a redirect (HTTP {status}) — redirects are not followed"
        ));
    }
    let mut buf = Vec::new();
    resp.into_reader()
        .take((FETCH_CAP + 1) as u64)
        .read_to_end(&mut buf)
        .map_err(|e| format!("read failed: {e}"))?;
    if buf.len() > FETCH_CAP {
        return Err("response too large".into());
    }
    Ok(BrokerResponse {
        status,
        body: String::from_utf8_lossy(&buf).into_owned(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::{Signer, SigningKey};

    #[test]
    fn index_signature_round_trips() {
        let seed = [3u8; 32];
        let sk = SigningKey::from_bytes(&seed);
        let pubkey = hex::encode(sk.verifying_key().to_bytes());
        let bundles = r#"[{"id":"cool","version":"1.0.0"}]"#;
        let sig = hex::encode(sk.sign(bundles.as_bytes()).to_bytes());
        assert!(verify_index(bundles, &sig, &pubkey));
        // Tamper → fails.
        assert!(!verify_index(&bundles.replace("cool", "evil"), &sig, &pubkey));
        // Wrong key → fails.
        let other = hex::encode(SigningKey::from_bytes(&[9u8; 32]).verifying_key().to_bytes());
        assert!(!verify_index(bundles, &sig, &other));
    }

    #[test]
    fn extracts_bundles_substring() {
        let raw = r#"{"generated_at":1,"bundles":[{"id":"x"}],"pubkey":"aa","sig":"bb"}"#;
        assert_eq!(extract_bundles_str(raw), Some(r#"[{"id":"x"}]"#));
    }

    #[test]
    fn safe_id_blocks_traversal() {
        assert!(is_safe_id("cool-preset"));
        assert!(!is_safe_id("../etc"));
        assert!(!is_safe_id("Up"));
        assert!(!is_safe_id(""));
    }

    fn headers(pairs: &[(&str, &str)]) -> std::collections::HashMap<String, String> {
        pairs.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect()
    }

    #[test]
    fn validate_headers_accepts_a_valid_set() {
        let h = headers(&[("Authorization", "Bearer sk-1"), ("X-Plain", "v1")]);
        assert!(validate_headers(&h).is_ok());
    }

    #[test]
    fn validate_headers_rejects_crlf_in_a_value() {
        let h = headers(&[("Authorization", "Bearer sk-1\r\nX-Injected: evil")]);
        let err = validate_headers(&h).unwrap_err();
        assert!(err.contains("Authorization"), "{err}");
    }

    #[test]
    fn validate_headers_rejects_a_bad_name() {
        let h = headers(&[("X Bad Name", "v1")]);
        let err = validate_headers(&h).unwrap_err();
        assert!(err.contains("invalid header name"), "{err}");
    }

    #[test]
    fn validate_headers_rejects_host() {
        let h = headers(&[("Host", "evil.example.com")]);
        let err = validate_headers(&h).unwrap_err();
        assert!(err.contains("Host"), "{err}");
        // Case-insensitive.
        let h2 = headers(&[("host", "evil.example.com")]);
        assert!(validate_headers(&h2).is_err());
    }

    #[test]
    fn validate_headers_rejects_content_length() {
        let h = headers(&[("Content-Length", "0")]);
        assert!(validate_headers(&h).is_err());
    }

    #[test]
    fn redirect_status_range_matches_ureq_convention_3xx() {
        // ureq treats 300..399 as "a redirect it could have followed"; with
        // redirects(0) it hands the un-followed response back as Ok rather
        // than erroring, so broker_fetch must catch this range itself (I2).
        assert!(!is_redirect_status(299));
        assert!(is_redirect_status(300));
        assert!(is_redirect_status(301));
        assert!(is_redirect_status(302));
        assert!(is_redirect_status(399));
        assert!(!is_redirect_status(400));
        assert!(!is_redirect_status(200));
    }

    #[test]
    fn validate_headers_enforces_the_16_header_cap() {
        let pairs: Vec<(String, String)> = (0..17)
            .map(|i| (format!("X-Header-{i}"), "v".to_string()))
            .collect();
        let h: std::collections::HashMap<String, String> =
            pairs.into_iter().collect();
        let err = validate_headers(&h).unwrap_err();
        assert!(err.contains("too many headers"), "{err}");
    }

    #[test]
    fn validate_headers_rejects_empty_and_oversized_values() {
        let empty = headers(&[("X-Empty", "")]);
        assert!(validate_headers(&empty).is_err());
        let oversized = headers(&[("X-Big", &"a".repeat(MAX_HEADER_VALUE_BYTES + 1))]);
        assert!(validate_headers(&oversized).is_err());
    }
}

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
        // Allowlist exact entry names — no paths, no traversal.
        if !matches!(name.as_str(), "manifest.json" | "main.js" | "preset.json") {
            return Err(format!("unexpected file in bundle: {name}"));
        }
        let mut s = String::new();
        f.read_to_string(&mut s).map_err(|e| format!("read {name}: {e}"))?;
        entries.insert(name, s);
    }

    match kind.as_str() {
        "visualizer" | "tile" => {
            let manifest = entries.get("manifest.json").ok_or("bundle missing manifest.json")?;
            let code = entries.get("main.js").ok_or("bundle missing main.js")?;
            let dir = content_dir(&app, "visualizers")?.join(&id);
            std::fs::create_dir_all(&dir).map_err(|e| format!("create {id}: {e}"))?;
            std::fs::write(dir.join("manifest.json"), manifest).map_err(|e| format!("write manifest: {e}"))?;
            std::fs::write(dir.join("main.js"), code).map_err(|e| format!("write main.js: {e}"))?;
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
        "visualizer" | "tile" => {
            let dir = content_dir(&app, "visualizers")?.join(&id);
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

/// The fetch the sandbox broker performs for installed tiles. Host allowlisting
/// is enforced in the frontend broker (broker.ts) before this is called; this
/// enforces https + size caps as defense in depth.
#[tauri::command]
pub fn broker_fetch(url: String) -> Result<BrokerResponse, String> {
    if !url.starts_with("https://") {
        return Err("only https URLs are allowed".into());
    }
    let resp = ureq::get(&url)
        .timeout(std::time::Duration::from_secs(10))
        .call()
        .map_err(|e| format!("request failed: {e}"))?;
    let status = resp.status();
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
}

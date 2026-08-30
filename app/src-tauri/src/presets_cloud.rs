//! Cloud backup for the flat user preset store (0.9.15).
//!
//! Manual push/pull against the marketplace server's `/account/presets`
//! endpoints — see docs/CLOUD_PRESETS.md for the model (push = upload
//! new/changed, never delete; pull = download missing, local wins on
//! conflict).
//!
//! Auth rides marketplace.rs's existing plumbing unchanged: the session token
//! is resolved Rust-side from the secret store (`session_token`) and attached
//! by `get_capped_auth`/`post_capped_json` (https-only, redirects(0), capped
//! reads). The token never crosses IPC in either direction.
//!
//! Trust boundary: every filename the SERVER hands back goes through the same
//! `is_safe_name` gate as user input, plus an extension whitelist and a size
//! cap, before anything touches the presets dir. A hostile or corrupted
//! server must not be able to write outside it — that constraint is the
//! reason `plan_pull` filters names instead of trusting the manifest.

use base64::Engine;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Runtime};

use crate::marketplace::{get_capped_auth, post_capped_json, session_token};
use crate::presets::{is_safe_name, presets_dir};

/// Mirrors the server's per-file cap; also applied to pulled content so a bad
/// server cannot fill the disk.
const FILE_CAP: usize = 256 * 1024;
/// Manifest responses are small; content responses carry one base64 file.
const LIST_CAP: usize = 512 * 1024;
const CONTENT_CAP: usize = FILE_CAP * 2; // base64 overhead + JSON envelope

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CloudPreset {
    pub file: String,
    pub sha256: String,
    pub size: u64,
}

#[derive(Debug, Clone, Serialize)]
pub struct PushResult {
    pub uploaded: usize,
    pub skipped: usize,
}

#[derive(Debug, Clone, Serialize)]
pub struct PullResult {
    pub downloaded: usize,
    pub conflicts: usize,
}

/// The extension rule `presets_list` already enforces for local files,
/// re-applied to anything server-named.
fn known_ext(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    lower.ends_with(".json") || lower.ends_with(".milk")
}

fn acceptable_remote_name(name: &str) -> bool {
    is_safe_name(name) && known_ext(name) && name.len() <= 120
}

/// Local files eligible for sync: the same admission rule as `presets_list`
/// (flat files, json/milk ext) — the marketplace subfolder is a directory and
/// falls out naturally.
fn local_files(dir: &std::path::Path) -> Result<Vec<(String, Vec<u8>)>, String> {
    let mut out = Vec::new();
    let entries = std::fs::read_dir(dir).map_err(|e| format!("read presets dir: {e}"))?;
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let Some(name) = path.file_name().and_then(|n| n.to_str()).map(String::from) else {
            continue;
        };
        if !known_ext(&name) || !is_safe_name(&name) {
            continue;
        }
        let bytes = std::fs::read(&path).map_err(|e| format!("read {name}: {e}"))?;
        if bytes.is_empty() || bytes.len() > FILE_CAP {
            continue; // out of the sync protocol's domain; leave it alone
        }
        out.push((name, bytes));
    }
    Ok(out)
}

fn sha_hex(bytes: &[u8]) -> String {
    hex::encode(Sha256::digest(bytes))
}

/// Which local files need uploading: absent from the cloud, or present with
/// different content. Pure — the tested decision.
fn plan_push(local: &[(String, String)], cloud: &[CloudPreset]) -> Vec<String> {
    local
        .iter()
        .filter(|(name, sha)| {
            cloud.iter().find(|c| &c.file == name).map(|c| &c.sha256) != Some(sha)
        })
        .map(|(name, _)| name.clone())
        .collect()
}

/// Which cloud files to download (absent locally) and which are conflicts
/// (present locally with different content — local wins, never overwritten).
/// Cloud names that fail the safety gate are counted as conflicts too: they
/// are unsyncable, and silently dropping them would misreport "restored
/// everything". Pure — the tested decision.
fn plan_pull(local: &[(String, String)], cloud: &[CloudPreset]) -> (Vec<String>, usize) {
    let mut download = Vec::new();
    let mut conflicts = 0;
    for c in cloud {
        if !acceptable_remote_name(&c.file) || c.size == 0 || c.size > FILE_CAP as u64 {
            conflicts += 1;
            continue;
        }
        match local.iter().find(|(name, _)| name == &c.file) {
            None => download.push(c.file.clone()),
            Some((_, sha)) if sha != &c.sha256 => conflicts += 1,
            Some(_) => {} // identical — nothing to do
        }
    }
    (download, conflicts)
}

fn fetch_manifest(url: &str, token: &str) -> Result<Vec<CloudPreset>, String> {
    let (status, body) = get_capped_auth(&format!("{url}/account/presets"), LIST_CAP, token)?;
    if status != 200 {
        return Err(server_error("list", status, &body));
    }
    let v: serde_json::Value =
        serde_json::from_slice(&body).map_err(|e| format!("bad server response: {e}"))?;
    let list = v
        .get("presets")
        .and_then(|p| p.as_array())
        .ok_or_else(|| "bad server response: no presets field".to_string())?;
    Ok(list
        .iter()
        .filter_map(|p| {
            Some(CloudPreset {
                file: p.get("file")?.as_str()?.to_string(),
                sha256: p.get("sha256")?.as_str()?.to_string(),
                size: p.get("size")?.as_u64()?,
            })
        })
        .collect())
}

/// A 4xx body from these endpoints is a plain-text reason (quota, size,
/// validation) worth showing verbatim; anything else gets the status code.
fn server_error(what: &str, status: u16, body: &[u8]) -> String {
    let text = std::str::from_utf8(body).unwrap_or("").trim();
    if (400..500).contains(&status) && !text.is_empty() && text.len() <= 200 {
        format!("{what} failed: {text}")
    } else {
        format!("{what} failed: server returned {status}")
    }
}

#[tauri::command]
pub async fn presets_cloud_list<R: Runtime>(
    app: AppHandle<R>,
    url: String,
) -> Result<Vec<CloudPreset>, String> {
    let token = session_token(&app)?;
    tauri::async_runtime::spawn_blocking(move || fetch_manifest(&url, &token))
        .await
        .map_err(|e| format!("task failed: {e}"))?
}

#[tauri::command]
pub async fn presets_cloud_push<R: Runtime>(
    app: AppHandle<R>,
    url: String,
) -> Result<PushResult, String> {
    let token = session_token(&app)?;
    let dir = presets_dir(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        let files = local_files(&dir)?;
        let hashed: Vec<(String, String)> =
            files.iter().map(|(n, b)| (n.clone(), sha_hex(b))).collect();
        let cloud = fetch_manifest(&url, &token)?;
        let to_upload = plan_push(&hashed, &cloud);
        let mut uploaded = 0;
        for name in &to_upload {
            let Some((_, bytes)) = files.iter().find(|(n, _)| n == name) else { continue };
            let body = serde_json::json!({
                "file": name,
                "content": base64::engine::general_purpose::STANDARD.encode(bytes),
            });
            let (status, resp) = post_capped_json(
                &format!("{url}/account/presets"),
                &body,
                LIST_CAP,
                Some(&token),
            )?;
            if status != 200 {
                // Stop at the first failure (quota, most likely) rather than
                // hammering the same wall N more times; report what landed.
                return Err(format!(
                    "{} (after uploading {uploaded} of {})",
                    server_error("upload", status, &resp),
                    to_upload.len()
                ));
            }
            uploaded += 1;
        }
        Ok(PushResult { uploaded, skipped: files.len() - uploaded })
    })
    .await
    .map_err(|e| format!("task failed: {e}"))?
}

#[tauri::command]
pub async fn presets_cloud_pull<R: Runtime>(
    app: AppHandle<R>,
    url: String,
) -> Result<PullResult, String> {
    let token = session_token(&app)?;
    let dir = presets_dir(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        let files = local_files(&dir)?;
        let hashed: Vec<(String, String)> =
            files.iter().map(|(n, b)| (n.clone(), sha_hex(b))).collect();
        let cloud = fetch_manifest(&url, &token)?;
        let (to_download, conflicts) = plan_pull(&hashed, &cloud);
        let mut downloaded = 0;
        for name in &to_download {
            let body = serde_json::json!({ "file": name });
            let (status, resp) = post_capped_json(
                &format!("{url}/account/presets/get"),
                &body,
                CONTENT_CAP,
                Some(&token),
            )?;
            if status != 200 {
                return Err(format!(
                    "{} (after restoring {downloaded} of {})",
                    server_error("download", status, &resp),
                    to_download.len()
                ));
            }
            let v: serde_json::Value =
                serde_json::from_slice(&resp).map_err(|e| format!("bad server response: {e}"))?;
            let content = v.get("content").and_then(|c| c.as_str()).unwrap_or("");
            let bytes = base64::engine::general_purpose::STANDARD
                .decode(content)
                .map_err(|e| format!("bad server content for {name}: {e}"))?;
            if bytes.is_empty() || bytes.len() > FILE_CAP {
                return Err(format!("bad server content for {name}: out-of-range size"));
            }
            // plan_pull vetted the name, but this write is the actual
            // boundary — re-check right where the path is built.
            if !acceptable_remote_name(name) {
                return Err(format!("unsafe preset name from server: {name}"));
            }
            std::fs::write(dir.join(name), &bytes).map_err(|e| format!("write {name}: {e}"))?;
            downloaded += 1;
        }
        Ok(PullResult { downloaded, conflicts })
    })
    .await
    .map_err(|e| format!("task failed: {e}"))?
}

#[cfg(test)]
mod tests {
    use super::{acceptable_remote_name, plan_pull, plan_push, CloudPreset};

    fn cloud(entries: &[(&str, &str)]) -> Vec<CloudPreset> {
        entries
            .iter()
            .map(|(f, s)| CloudPreset { file: f.to_string(), sha256: s.to_string(), size: 10 })
            .collect()
    }

    fn local(entries: &[(&str, &str)]) -> Vec<(String, String)> {
        entries.iter().map(|(f, s)| (f.to_string(), s.to_string())).collect()
    }

    #[test]
    fn push_uploads_new_and_changed_skips_identical() {
        let l = local(&[("a.json", "s1"), ("b.milk", "s2"), ("c.json", "s3")]);
        let c = cloud(&[("a.json", "s1"), ("b.milk", "DIFFERENT")]);
        let up = plan_push(&l, &c);
        assert_eq!(up, vec!["b.milk".to_string(), "c.json".to_string()]);
    }

    #[test]
    fn push_with_empty_cloud_uploads_everything() {
        let l = local(&[("a.json", "s1")]);
        assert_eq!(plan_push(&l, &[]).len(), 1);
    }

    #[test]
    fn pull_downloads_missing_and_counts_conflicts_local_wins() {
        let l = local(&[("kept.json", "local-sha"), ("same.json", "s")]);
        let c = cloud(&[("kept.json", "cloud-sha"), ("same.json", "s"), ("new.json", "n")]);
        let (dl, conflicts) = plan_pull(&l, &c);
        assert_eq!(dl, vec!["new.json".to_string()], "the differing file is never downloaded");
        assert_eq!(conflicts, 1);
    }

    #[test]
    fn pull_refuses_unsafe_server_names_as_conflicts() {
        let c = vec![
            CloudPreset { file: "../evil.json".into(), sha256: "x".into(), size: 10 },
            CloudPreset { file: "fine.json".into(), sha256: "y".into(), size: 10 },
            CloudPreset { file: "prog.exe".into(), sha256: "z".into(), size: 10 },
            CloudPreset { file: "huge.json".into(), sha256: "h".into(), size: 300 * 1024 },
        ];
        let (dl, conflicts) = plan_pull(&[], &c);
        assert_eq!(dl, vec!["fine.json".to_string()]);
        assert_eq!(conflicts, 3);
    }

    #[test]
    fn remote_name_gate_matches_the_local_rule_plus_extension() {
        assert!(acceptable_remote_name("Geiss - Reflection (remix).json"));
        assert!(acceptable_remote_name("plain.MILK"));
        assert!(!acceptable_remote_name("a/b.json"));
        assert!(!acceptable_remote_name("a\\b.json"));
        assert!(!acceptable_remote_name("..\\up.json"));
        assert!(!acceptable_remote_name(".hidden.json"));
        assert!(!acceptable_remote_name("script.js"));
        assert!(!acceptable_remote_name(""));
    }
}

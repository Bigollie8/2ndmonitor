//! Server-side manifest validation — the Rust twin of the app's
//! `app/src/sandbox/manifest.ts`, extended with the permission grammar the
//! marketplace introduces:
//!   "net:<host>"    broker-proxied fetch to exactly this host
//!   "tauri:<cmd>"   one whitelisted Tauri command via the broker
//!   "secret:<key>"  declares (does not grant) a named credential the host
//!                   injects into outgoing requests; never a fetch/invoke
//!                   capability on its own
//! Presets and visualizers must declare zero permissions; only tiles may.

use serde_json::Value;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Perm {
    Net(String),
    Tauri(String),
    Secret(String),
}

impl Perm {
    pub fn parse(s: &str) -> Result<Perm, String> {
        if let Some(host) = s.strip_prefix("net:") {
            let ok = !host.is_empty()
                && host.len() <= 253
                && !host.contains(['/', ':', '?', '#', '@', ' '])
                && host.split('.').all(|l| {
                    !l.is_empty()
                        && l.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-')
                });
            if !ok {
                return Err(format!("invalid net host: {host:?} (bare hostname only)"));
            }
            Ok(Perm::Net(host.to_string()))
        } else if let Some(cmd) = s.strip_prefix("tauri:") {
            let ok = !cmd.is_empty()
                && cmd.len() <= 64
                && cmd.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'_');
            if !ok {
                return Err(format!("invalid tauri command: {cmd:?}"));
            }
            Ok(Perm::Tauri(cmd.to_string()))
        } else if let Some(key) = s.strip_prefix("secret:") {
            let ok = !key.is_empty()
                && key.len() <= 64
                && key.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'_');
            if !ok {
                return Err(format!("invalid secret key: {key:?}"));
            }
            Ok(Perm::Secret(key.to_string()))
        } else {
            Err(format!("unknown permission {s:?} (expected net:<host>, tauri:<command>, or secret:<key>)"))
        }
    }

    pub fn as_string(&self) -> String {
        match self {
            Perm::Net(h) => format!("net:{h}"),
            Perm::Tauri(c) => format!("tauri:{c}"),
            Perm::Secret(k) => format!("secret:{k}"),
        }
    }
}

#[derive(Debug, Clone)]
pub struct Validated {
    pub id: String,
    pub name: String,
    pub version: String,
    pub permissions: Vec<Perm>,
}

fn id_ok(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 64
        && id.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
}

pub fn validate(kind: &str, manifest_json: &str) -> Result<Validated, String> {
    if !matches!(kind, "preset" | "visualizer" | "tile") {
        return Err(format!("unknown kind {kind:?}"));
    }
    let v: Value = serde_json::from_str(manifest_json).map_err(|e| format!("manifest not JSON: {e}"))?;
    let obj = v.as_object().ok_or("manifest must be a JSON object")?;

    let id = obj.get("id").and_then(Value::as_str).unwrap_or("");
    if !id_ok(id) {
        return Err("id must be 1-64 chars of [a-z0-9-]".into());
    }
    let name = obj.get("name").and_then(Value::as_str).unwrap_or("").trim();
    if name.is_empty() {
        return Err("name is required".into());
    }
    let version = obj.get("version").and_then(Value::as_str).unwrap_or("").trim();
    if version.is_empty() || version.len() > 32 {
        return Err("version is required (≤32 chars)".into());
    }
    if obj.get("api").and_then(Value::as_u64) != Some(1) {
        return Err("api must be 1".into());
    }

    let raw_perms = obj
        .get("permissions")
        .and_then(Value::as_array)
        .ok_or("permissions must be an array")?;
    let mut permissions = Vec::new();
    for p in raw_perms {
        let s = p.as_str().ok_or("permissions entries must be strings")?;
        permissions.push(Perm::parse(s)?);
    }
    if kind != "tile" && !permissions.is_empty() {
        return Err(format!("{kind} bundles must not declare permissions"));
    }
    if permissions.len() > 16 {
        return Err("too many permissions (max 16)".into());
    }

    Ok(Validated {
        id: id.to_string(),
        name: name.to_string(),
        version: version.to_string(),
        permissions,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn m(perms: &str) -> String {
        format!(r#"{{"id":"my-tile","name":"T","version":"1.0.0","api":1,"permissions":{perms}}}"#)
    }

    #[test]
    fn tile_with_valid_perms_passes() {
        let v = validate("tile", &m(r#"["net:api.weather.com","tauri:get_system_stats"]"#)).unwrap();
        assert_eq!(v.permissions.len(), 2);
        assert_eq!(v.permissions[0], Perm::Net("api.weather.com".into()));
    }

    #[test]
    fn visualizer_with_perms_fails() {
        let err = validate("visualizer", &m(r#"["net:x.y"]"#)).unwrap_err();
        assert!(err.contains("must not declare"));
    }

    #[test]
    fn net_host_grammar_rejects_urls_and_ports() {
        for bad in ["net:https://x.y", "net:x.y/path", "net:x.y:8080", "net:", "net:a b"] {
            assert!(Perm::parse(bad).is_err(), "{bad} should fail");
        }
        assert!(Perm::parse("net:api.open-meteo.com").is_ok());
    }

    #[test]
    fn tauri_grammar() {
        assert!(Perm::parse("tauri:get_system_stats").is_ok());
        assert!(Perm::parse("tauri:Bad-Cmd").is_err());
        assert!(Perm::parse("shell:run").is_err());
    }

    #[test]
    fn secret_grammar() {
        assert_eq!(Perm::parse("secret:github_pat").unwrap(), Perm::Secret("github_pat".into()));
        assert!(Perm::parse("secret:").is_err());
        assert!(Perm::parse("secret:Has Space").is_err());
        assert!(Perm::parse("secret:UPPER").is_err());
    }

    #[test]
    fn tile_with_secret_perm_passes() {
        let v = validate("tile", &m(r#"["secret:token"]"#)).unwrap();
        assert_eq!(v.permissions, vec![Perm::Secret("token".into())]);
    }
}

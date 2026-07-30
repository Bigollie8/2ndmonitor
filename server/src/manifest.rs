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

// ─────────────────────────────────────────────────────────────────────────────
// `view.json` validation — the Rust twin of `app/src/tiles/viewSpec.ts`'s
// `validateViewSpec`. A declarative tile carries no code, only a description
// of where data comes from and which native primitive renders it, so this is
// the entire security review for a tile submission: reject at publish time
// whatever the client would reject at render time.
// ─────────────────────────────────────────────────────────────────────────────

/// Lowest refresh interval a bundle may request, so a published tile cannot
/// hammer a third-party API from every install. Mirrors `MIN_INTERVAL_MS` in
/// viewSpec.ts.
pub const MIN_INTERVAL_MS: u64 = 15_000;

/// `JSON.stringify(v)` for the subset of values that show up in our error
/// messages: `None` (an absent/undefined key) prints as `undefined`, matching
/// what a JS template literal does with `${undefined}`.
fn js_stringify(v: Option<&Value>) -> String {
    match v {
        None => "undefined".to_string(),
        Some(val) => serde_json::to_string(val).unwrap_or_else(|_| "null".to_string()),
    }
}

/// A plain dot-path: `^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$`.
/// No indexing, no expressions — the guardrail against the view spec growing
/// into an expression language.
fn is_dot_path(s: &str) -> bool {
    if s.is_empty() {
        return false;
    }
    s.split('.').all(|seg| {
        let mut chars = seg.chars();
        let first_ok = matches!(chars.next(), Some(c) if c.is_ascii_alphabetic() || c == '_');
        first_ok && chars.all(|c| c.is_ascii_alphanumeric() || c == '_')
    })
}

/// Matches `/\{\{\s*secret\.[^}]*\}\}/`: `{{`, optional whitespace, the
/// literal `secret.`, any run of non-`}` characters, then `}}`.
fn has_secret_ref(s: &str) -> bool {
    let b = s.as_bytes();
    let n = b.len();
    let mut i = 0;
    while i + 1 < n {
        if b[i] == b'{' && b[i + 1] == b'{' {
            let mut j = i + 2;
            while j < n && b[j].is_ascii_whitespace() {
                j += 1;
            }
            const NEEDLE: &[u8] = b"secret.";
            if j + NEEDLE.len() <= n && &b[j..j + NEEDLE.len()] == NEEDLE {
                let mut k = j + NEEDLE.len();
                while k < n && b[k] != b'}' {
                    k += 1;
                }
                if k + 1 < n && b[k] == b'}' && b[k + 1] == b'}' {
                    return true;
                }
            }
        }
        i += 1;
    }
    false
}

/// Deep scan for a `{{secret.*}}` placeholder in any string within `v`, at
/// any nesting depth (objects and arrays both). Mirrors `containsSecretRef`.
fn contains_secret_ref(v: &Value) -> bool {
    match v {
        Value::String(s) => has_secret_ref(s),
        Value::Array(items) => items.iter().any(contains_secret_ref),
        Value::Object(map) => map.values().any(contains_secret_ref),
        _ => false,
    }
}

/// `undefined`-or-string check for an optional field: absent is fine,
/// present-and-non-string is rejected. Mirrors the
/// `x !== undefined && typeof x !== 'string'` guards in viewSpec.ts (a bug
/// fixed there: a present-but-wrong-typed optional field must be rejected,
/// not silently passed through).
fn optional_string_ok(v: Option<&Value>) -> bool {
    match v {
        None => true,
        Some(Value::String(_)) => true,
        Some(_) => false,
    }
}

fn validate_source(raw: &Value) -> Result<(), String> {
    let obj = raw.as_object().ok_or_else(|| "source must be an object".to_string())?;

    let interval = match obj.get("intervalMs") {
        Some(Value::Number(n)) => n.as_f64(),
        _ => None,
    };
    let interval = match interval {
        Some(f) if f.is_finite() => f,
        _ => return Err("source.intervalMs must be a number".to_string()),
    };
    if interval < MIN_INTERVAL_MS as f64 {
        return Err(format!("source.intervalMs must be at least {MIN_INTERVAL_MS}ms"));
    }

    match obj.get("kind").and_then(Value::as_str) {
        Some("http") => {
            let url_ok = matches!(obj.get("url"), Some(Value::String(u)) if u.starts_with("https://"));
            if !url_ok {
                return Err("source.url must be an https:// URL".to_string());
            }
            if let Some(headers) = obj.get("headers") {
                let hmap = headers
                    .as_object()
                    .ok_or_else(|| "source.headers must be an object".to_string())?;
                for (k, v) in hmap {
                    if !v.is_string() {
                        return Err(format!("source.headers.{k} must be a string"));
                    }
                }
            }
            Ok(())
        }
        Some("tauri") => {
            let cmd_ok = matches!(obj.get("command"), Some(Value::String(c))
                if !c.is_empty() && c.len() <= 64
                    && c.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'_'));
            if !cmd_ok {
                return Err("source.command must be 1-64 chars of [a-z0-9_]".to_string());
            }
            if let Some(args) = obj.get("args") {
                if !args.is_object() {
                    return Err("source.args must be an object".to_string());
                }
            }
            Ok(())
        }
        _ => Err(format!(
            "unknown source kind {} (expected \"http\" or \"tauri\")",
            js_stringify(obj.get("kind"))
        )),
    }
}

fn validate_view(raw: &Value) -> Result<(), String> {
    let obj = raw.as_object().ok_or_else(|| "view must be an object".to_string())?;

    match obj.get("type").and_then(Value::as_str) {
        Some("list") => {
            let row = obj
                .get("row")
                .and_then(Value::as_object)
                .ok_or_else(|| "list view requires a `row` object".to_string())?;
            if !matches!(row.get("title"), Some(Value::String(_))) {
                return Err("list row requires a string `title`".to_string());
            }
            if !optional_string_ok(row.get("left")) {
                return Err("list row.left must be a string".to_string());
            }
            if !optional_string_ok(row.get("right")) {
                return Err("list row.right must be a string".to_string());
            }
            if !optional_string_ok(row.get("openUrl")) {
                return Err("list row.openUrl must be a string".to_string());
            }
            if !optional_string_ok(obj.get("emptyText")) {
                return Err("list emptyText must be a string".to_string());
            }
            Ok(())
        }
        Some("stat") => {
            if !matches!(obj.get("value"), Some(Value::String(_))) {
                return Err("stat view requires a string `value`".to_string());
            }
            if !optional_string_ok(obj.get("label")) {
                return Err("stat label must be a string".to_string());
            }
            if !optional_string_ok(obj.get("delta")) {
                return Err("stat delta must be a string".to_string());
            }
            Ok(())
        }
        Some("rows") => {
            let rows = obj
                .get("rows")
                .and_then(Value::as_array)
                .filter(|a| !a.is_empty())
                .ok_or_else(|| "rows view requires a non-empty `rows` array".to_string())?;
            for r in rows {
                let ok = r.as_object().is_some_and(|ro| {
                    matches!(ro.get("label"), Some(Value::String(_)))
                        && matches!(ro.get("value"), Some(Value::String(_)))
                });
                if !ok {
                    return Err("each rows entry needs string `label` and `value`".to_string());
                }
            }
            Ok(())
        }
        Some("text") => {
            if !matches!(obj.get("body"), Some(Value::String(_))) {
                return Err("text view requires a string `body`".to_string());
            }
            if !optional_string_ok(obj.get("attribution")) {
                return Err("text attribution must be a string".to_string());
            }
            Ok(())
        }
        Some("badge") => {
            if !matches!(obj.get("value"), Some(Value::String(_))) {
                return Err("badge view requires a string `value`".to_string());
            }
            if !optional_string_ok(obj.get("label")) {
                return Err("badge label must be a string".to_string());
            }
            Ok(())
        }
        _ => Err(format!(
            "unknown view type {} (expected list, stat, rows, text or badge)",
            js_stringify(obj.get("type"))
        )),
    }
}

/// Validates a tile's `view.json` text. Mirrors `validateViewSpec` in
/// `app/src/tiles/viewSpec.ts` rule-for-rule, so an invalid tile is rejected
/// at submission instead of publishing and then failing to render for every
/// user who installs it.
pub fn validate_view_spec(view_json: &str) -> Result<(), String> {
    let raw: Value = serde_json::from_str(view_json).map_err(|e| format!("view.json is not valid JSON: {e}"))?;
    let obj = raw
        .as_object()
        .ok_or_else(|| "view spec must be a JSON object".to_string())?;

    validate_source(obj.get("source").unwrap_or(&Value::Null))?;

    if let Some(select) = obj.get("select") {
        let ok = matches!(select, Value::String(s) if is_dot_path(s));
        if !ok {
            return Err("select must be a plain dot-path (no indexing, no expressions)".to_string());
        }
    }

    let view = obj.get("view").unwrap_or(&Value::Null);
    validate_view(view)?;

    // A credential may only be substituted into the outgoing request (in
    // source.url or source.headers). Anywhere in `view` it would be rendered
    // on screen, so reject it at validation time rather than trusting
    // authors. (`select` cannot carry one: the dot-path grammar above already
    // forbids `{` entirely.)
    if contains_secret_ref(view) {
        return Err(
            "{{secret.*}} is not allowed in `view` — secrets may only appear in source.url or source.headers"
                .to_string(),
        );
    }

    Ok(())
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

    #[test]
    fn valid_tile_view_spec_is_accepted() {
        let json = r#"{
            "source": {"kind":"http","url":"https://api.example.com/data","intervalMs":30000},
            "select": "data.items",
            "view": {"type":"list","row":{"title":"foo"}}
        }"#;
        assert!(validate_view_spec(json).is_ok());
    }

    #[test]
    fn http_source_requires_https() {
        let json = r#"{
            "source": {"kind":"http","url":"http://api.example.com/data","intervalMs":30000},
            "view": {"type":"stat","value":"x"}
        }"#;
        let err = validate_view_spec(json).unwrap_err();
        assert!(err.contains("https://"), "{err}");
    }

    #[test]
    fn interval_below_floor_is_rejected() {
        let json = r#"{
            "source": {"kind":"http","url":"https://api.example.com/data","intervalMs":5000},
            "view": {"type":"stat","value":"x"}
        }"#;
        let err = validate_view_spec(json).unwrap_err();
        assert!(err.contains("15000"), "{err}");
    }

    #[test]
    fn unknown_view_type_is_rejected() {
        let json = r#"{
            "source": {"kind":"http","url":"https://api.example.com/data","intervalMs":30000},
            "view": {"type":"chart","value":"x"}
        }"#;
        let err = validate_view_spec(json).unwrap_err();
        assert!(err.contains("unknown view type"), "{err}");
    }

    #[test]
    fn secret_ref_nested_in_row_title_is_rejected() {
        let json = r#"{
            "source": {"kind":"http","url":"https://api.example.com/data","intervalMs":30000},
            "view": {"type":"list","row":{"title":"{{secret.token}}"}}
        }"#;
        let err = validate_view_spec(json).unwrap_err();
        assert!(err.contains("secret"), "{err}");
    }

    #[test]
    fn secret_ref_inside_rows_array_entry_is_rejected() {
        // Proves the secret scan recurses into arrays, not just objects.
        let json = r#"{
            "source": {"kind":"http","url":"https://api.example.com/data","intervalMs":30000},
            "view": {"type":"rows","rows":[
                {"label":"a","value":"ok"},
                {"label":"b","value":"{{secret.token}}"}
            ]}
        }"#;
        let err = validate_view_spec(json).unwrap_err();
        assert!(err.contains("secret"), "{err}");
    }

    #[test]
    fn select_with_indexing_is_rejected() {
        let json = r#"{
            "source": {"kind":"http","url":"https://api.example.com/data","intervalMs":30000},
            "select": "items[0].x",
            "view": {"type":"stat","value":"x"}
        }"#;
        let err = validate_view_spec(json).unwrap_err();
        assert!(err.contains("dot-path"), "{err}");
    }

    #[test]
    fn tauri_command_grammar() {
        let ok = r#"{
            "source": {"kind":"tauri","command":"get_system_stats","intervalMs":30000},
            "view": {"type":"stat","value":"x"}
        }"#;
        assert!(validate_view_spec(ok).is_ok());

        let bad = r#"{
            "source": {"kind":"tauri","command":"Bad-Cmd","intervalMs":30000},
            "view": {"type":"stat","value":"x"}
        }"#;
        assert!(validate_view_spec(bad).is_err());
    }

    #[test]
    fn unknown_source_kind_is_rejected() {
        let json = r#"{
            "source": {"kind":"ftp","url":"https://x","intervalMs":30000},
            "view": {"type":"stat","value":"x"}
        }"#;
        let err = validate_view_spec(json).unwrap_err();
        assert!(err.contains("unknown source kind"), "{err}");
    }

    #[test]
    fn non_string_optional_field_is_rejected() {
        // The TypeScript side had a bug here that was fixed: a present-but-
        // wrong-typed optional field must be rejected, not passed through.
        let json = r#"{
            "source": {"kind":"http","url":"https://x","intervalMs":30000},
            "view": {"type":"stat","value":"x","label":42}
        }"#;
        let err = validate_view_spec(json).unwrap_err();
        assert!(err.contains("label"), "{err}");
    }

    #[test]
    fn secret_ref_with_whitespace_is_still_caught() {
        let json = r#"{
            "source": {"kind":"http","url":"https://x","intervalMs":30000},
            "view": {"type":"badge","value":"{{  secret.token  }}"}
        }"#;
        let err = validate_view_spec(json).unwrap_err();
        assert!(err.contains("secret"), "{err}");
    }
}

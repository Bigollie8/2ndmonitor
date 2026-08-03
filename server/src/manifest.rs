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

/// Category vocabulary, per kind. Shared verbatim with the app's sidebar —
/// `CATEGORY_LABELS` in `app/src/components/catalogRail.ts` holds the display
/// strings for exactly these values. A category outside its kind's list is
/// rejected rather than coerced, for the same reason `surface` is: a typo
/// should fail once at submission, not publish and then sort into the wrong
/// part of the store where the author cannot diagnose it.
const TILE_CATEGORIES: &[&str] =
    &["media", "system", "weather", "productivity", "ambient", "integrations"];
const VIZ_CATEGORIES: &[&str] = &["spectrum", "wave", "scene", "engine"];
const PRESET_CATEGORIES: &[&str] = &["milkdrop"];

pub fn category_ok(kind: &str, cat: &str) -> bool {
    let allowed = match kind {
        "tile" => TILE_CATEGORIES,
        "visualizer" => VIZ_CATEGORIES,
        "preset" => PRESET_CATEGORIES,
        _ => return false,
    };
    allowed.contains(&cat)
}

/// Optional descriptive metadata. Every field is `Option`/empty when absent —
/// this is additive to api 1, so an older manifest that declares none of it
/// stays valid and simply carries nothing.
#[derive(Debug, Clone, Default)]
pub struct Meta {
    pub summary: Option<String>,
    pub description: Option<String>,
    pub category: Option<String>,
    pub tags: Vec<String>,
    pub icon: Option<String>,
    pub changelog: Option<String>,
    pub min_app_version: Option<String>,
}

fn opt_string(
    obj: &serde_json::Map<String, Value>,
    key: &str,
    max: usize,
) -> Result<Option<String>, String> {
    let Some(raw) = obj.get(key) else { return Ok(None) };
    let s = raw
        .as_str()
        .ok_or_else(|| format!("{key} must be a string"))?
        .trim();
    if s.is_empty() {
        return Err(format!("{key} must not be blank when present"));
    }
    if s.chars().count() > max {
        return Err(format!("{key} must be at most {max} characters"));
    }
    Ok(Some(s.to_string()))
}

fn dotted_numeric(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 32
        && s.split('.').all(|seg| !seg.is_empty() && seg.bytes().all(|b| b.is_ascii_digit()))
}

/// Validates the optional metadata block. Public because the admin `PATCH`
/// route applies the identical rules — an admin correction must not be able to
/// write a category or tag shape that a submission could not.
pub fn validate_meta(kind: &str, obj: &serde_json::Map<String, Value>) -> Result<Meta, String> {
    let summary = opt_string(obj, "summary", 100)?;
    let description = opt_string(obj, "description", 4000)?;
    let changelog = opt_string(obj, "changelog", 1000)?;

    let category = match opt_string(obj, "category", 32)? {
        Some(c) if !category_ok(kind, &c) => {
            return Err(format!("category {c:?} is not valid for a {kind}"))
        }
        other => other,
    };

    let mut tags = Vec::new();
    if let Some(raw) = obj.get("tags") {
        let arr = raw.as_array().ok_or("tags must be an array")?;
        if arr.len() > 8 {
            return Err("too many tags (max 8)".into());
        }
        for t in arr {
            let s = t.as_str().ok_or("tags entries must be strings")?.trim();
            let ok = (1..=24).contains(&s.len())
                && s.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-');
            if !ok {
                return Err(format!("tag must be 1-24 chars of [a-z0-9-]: {s:?}"));
            }
            tags.push(s.to_string());
        }
    }

    // One or two chars, not one: a glyph plus a variation selector (U+FE0F) is
    // a single rendered symbol but two `char`s, and rejecting it would refuse
    // legitimate icons. Anything longer is a label, not an icon.
    let icon = match obj.get("icon") {
        None => None,
        Some(v) => {
            let s = v.as_str().ok_or("icon must be a string")?;
            if !(1..=2).contains(&s.chars().count()) {
                return Err("icon must be 1-2 characters".into());
            }
            Some(s.to_string())
        }
    };

    let min_app_version = match obj.get("minAppVersion") {
        None => None,
        Some(v) => {
            let s = v.as_str().ok_or("minAppVersion must be a string")?.trim();
            if !dotted_numeric(s) {
                return Err("minAppVersion must be dotted numeric, e.g. \"0.8.0\"".into());
            }
            Some(s.to_string())
        }
    };

    Ok(Meta { summary, description, category, tags, icon, changelog, min_app_version })
}

#[derive(Debug, Clone)]
pub struct Validated {
    pub id: String,
    pub name: String,
    pub version: String,
    pub permissions: Vec<Perm>,
    pub meta: Meta,
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

    // Render surface the bundle draws into (I11). Additive to api 1: absent
    // means 'canvas', matching the app's default for an older manifest. An
    // unknown value is rejected here rather than silently coerced to
    // 'canvas' — mirrors `app/src/sandbox/manifest.ts`'s `validateManifest`,
    // so a typo'd `surface` fails at submission instead of publishing and
    // rendering a blank frame the author can't diagnose.
    if let Some(surface_val) = obj.get("surface") {
        let ok = matches!(surface_val, Value::String(s) if s == "canvas" || s == "dom");
        if !ok {
            return Err("surface must be \"canvas\" or \"dom\"".into());
        }
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

    // Mirrors `app/src/sandbox/manifest.ts`'s `secrets`/`config` schema and
    // both cross-checks (I9). Before this, the server accepted
    // `"secrets": "not-an-array"`, 50 secrets, bad key shapes, and neither
    // cross-check the app enforces — fail-closed (the app still refuses a
    // bad manifest at install time), but it let a bundle publish and then
    // fail to install for every single user, rather than being rejected once
    // at submission.
    let mut declared_secret_keys: Vec<String> = Vec::new();
    if let Some(secrets_val) = obj.get("secrets") {
        let secrets_arr = secrets_val
            .as_array()
            .ok_or_else(|| "secrets must be an array".to_string())?;
        if secrets_arr.len() > 8 {
            return Err("too many secrets (max 8)".into());
        }
        for s in secrets_arr {
            let so = s
                .as_object()
                .ok_or_else(|| "secrets entries must be objects".to_string())?;
            let key = so.get("key").and_then(Value::as_str).unwrap_or("");
            let key_ok = !key.is_empty()
                && key.len() <= 64
                && key.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'_');
            if !key_ok {
                return Err(format!("secret key must be 1-64 chars of [a-z0-9_]: {:?}", key));
            }
            let label = so.get("label").and_then(Value::as_str).unwrap_or("").trim();
            if label.is_empty() {
                return Err(format!("secret {key} requires a label"));
            }
            let kind = so.get("kind").and_then(Value::as_str).unwrap_or("");
            if kind != "password" && kind != "text" {
                return Err(format!("secret {key} kind must be \"password\" or \"text\""));
            }
            if let Some(help) = so.get("help") {
                if !help.is_string() {
                    return Err(format!("secret {key} help must be a string"));
                }
            }
            declared_secret_keys.push(key.to_string());
        }
        // Load-bearing on the app side too: the install-time confirmation
        // dialog lists `permissions`, so a secret without a matching
        // `secret:<key>` permission would prompt for a credential the user
        // never approved installing.
        for key in &declared_secret_keys {
            let perm_name = format!("secret:{key}");
            if !permissions.iter().any(|p| p.as_string() == perm_name) {
                return Err(format!(
                    "secret {key} declared but missing matching permission {perm_name}"
                ));
            }
        }
    }

    // Reverse of the check above, and just as load-bearing: without a
    // matching `secrets` entry there is no label/kind/input for a declared
    // `secret:<key>` permission — an orphaned prompt for a credential the
    // tile can never actually collect. Must run even when `secrets` is
    // absent entirely (not nested in the `if let Some(secrets_val)` block
    // above).
    for p in &permissions {
        if let Perm::Secret(key) = p {
            if !declared_secret_keys.iter().any(|k| k == key) {
                return Err(format!(
                    "permission secret:{key} declared but missing matching secrets entry"
                ));
            }
        }
    }

    if let Some(config_val) = obj.get("config") {
        let config_arr = config_val
            .as_array()
            .ok_or_else(|| "config must be an array".to_string())?;
        if config_arr.len() > 8 {
            return Err("too many config entries (max 8)".into());
        }
        for c in config_arr {
            let co = c
                .as_object()
                .ok_or_else(|| "config entries must be objects".to_string())?;
            let key = co.get("key").and_then(Value::as_str).unwrap_or("").trim();
            if key.is_empty() {
                return Err("config entry requires a key".into());
            }
            let label = co.get("label").and_then(Value::as_str).unwrap_or("").trim();
            if label.is_empty() {
                return Err(format!("config {key} requires a label"));
            }
            let ty = co.get("type").and_then(Value::as_str).unwrap_or("");
            if ty != "text" && ty != "number" {
                return Err(format!("config {key} type must be \"text\" or \"number\""));
            }
        }
    }

    let meta = validate_meta(kind, obj)?;

    Ok(Validated {
        id: id.to_string(),
        name: name.to_string(),
        version: version.to_string(),
        permissions,
        meta,
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

/// Highest refresh interval a bundle may request (24h). Mirrors
/// `MAX_INTERVAL_MS` in viewSpec.ts — without this ceiling a submission could
/// publish an `intervalMs` so large that `setTimeout`'s 32-bit delay argument
/// clamps it to 0 client-side, turning "interval" into a tight loop (I3).
pub const MAX_INTERVAL_MS: u64 = 86_400_000;

/// `JSON.stringify(v)` for the subset of values that show up in our error
/// messages: `None` (an absent/undefined key) prints as `undefined`, matching
/// what a JS template literal does with `${undefined}`.
fn js_stringify(v: Option<&Value>) -> String {
    match v {
        None => "undefined".to_string(),
        Some(val) => serde_json::to_string(val).unwrap_or_else(|_| "null".to_string()),
    }
}

/// A plain dot-path: each segment is either an identifier
/// (`[A-Za-z_][A-Za-z0-9_]*`) or a literal non-negative integer with no
/// leading zero (`0` or `[1-9][0-9]*`). Must match `DOT_PATH` in
/// `app/src/tiles/viewSpec.ts` exactly — the two sides validate the same
/// submitted `view.json`, and a mismatch means the client and server
/// disagree about what's allowed to publish. The integer form is how a tile
/// indexes into an array a real API returned at that position (a bare
/// top-level array is completely ordinary for a third-party JSON API); it
/// is still not an expression language — no variables, no arithmetic, no
/// negative or relative indices.
fn is_dot_path(s: &str) -> bool {
    if s.is_empty() {
        return false;
    }
    s.split('.').all(is_dot_segment)
}

fn is_dot_segment(seg: &str) -> bool {
    if seg.is_empty() {
        return false;
    }
    let bytes = seg.as_bytes();
    let is_integer = seg == "0" || (bytes[0] != b'0' && bytes.iter().all(u8::is_ascii_digit));
    if is_integer {
        return true;
    }
    let mut chars = seg.chars();
    let first_ok = matches!(chars.next(), Some(c) if c.is_ascii_alphabetic() || c == '_');
    first_ok && chars.all(|c| c.is_ascii_alphanumeric() || c == '_')
}

/// Matches `/\{\{\s*secret\.[^}]*\}\}/`: `{{`, optional whitespace, the
/// literal `secret.`, any run of non-`}` characters, then `}}`.
///
/// Operates on `char`s, not bytes (I10): the whitespace skip below uses
/// `char::is_whitespace`, which is Unicode-aware, matching what the JS `\s`
/// class the app's regex (`SECRET_RE` in `viewSpec.ts`) considers whitespace
/// — including NBSP (U+00A0), U+2028, and U+3000 — instead of the old
/// `u8::is_ascii_whitespace`, which missed all of them. A byte-indexed scan
/// can't skip a multi-byte UTF-8 whitespace character correctly at all, so
/// this also fixes a latent panic/mis-scan risk on non-ASCII input, not just
/// the app/server disagreement: a `{{<NBSP>secret.token}}` used to publish
/// (server didn't see it as a secret ref) but get rejected at install time
/// (app's regex did) — and would have been expanded by the app's substituter
/// had that install-time check ever been bypassed.
///
/// U+FEFF (ZERO WIDTH NO-BREAK SPACE / BOM) is checked explicitly alongside
/// `char::is_whitespace`: JS's `\s` includes it per the ECMAScript
/// `WhiteSpace` production, but Unicode's `White_Space` property (what
/// `char::is_whitespace` implements) does not — U+FEFF is category `Cf`
/// (format), not whitespace. Without this, `{{<FEFF>secret.token}}` would
/// still publish here and be rejected only at install time, the exact
/// app/server disagreement this function exists to close.
fn has_secret_ref(s: &str) -> bool {
    let chars: Vec<char> = s.chars().collect();
    let n = chars.len();
    let mut i = 0;
    while i + 1 < n {
        if chars[i] == '{' && chars[i + 1] == '{' {
            let mut j = i + 2;
            while j < n && (chars[j].is_whitespace() || chars[j] == '\u{FEFF}') {
                j += 1;
            }
            const NEEDLE: &str = "secret.";
            let needle_len = NEEDLE.chars().count();
            if j + needle_len <= n {
                let candidate: String = chars[j..j + needle_len].iter().collect();
                if candidate == NEEDLE {
                    let mut k = j + needle_len;
                    while k < n && chars[k] != '}' {
                        k += 1;
                    }
                    if k + 1 < n && chars[k] == '}' && chars[k + 1] == '}' {
                        return true;
                    }
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
    if interval > MAX_INTERVAL_MS as f64 {
        return Err(format!("source.intervalMs must be at most {MAX_INTERVAL_MS}ms"));
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

    fn viz_with(extra: serde_json::Value) -> String {
        let mut m = serde_json::json!({
            "id": "demo", "name": "Demo", "version": "1.0.0", "api": 1, "permissions": []
        });
        let obj = m.as_object_mut().unwrap();
        for (k, v) in extra.as_object().unwrap() {
            obj.insert(k.clone(), v.clone());
        }
        m.to_string()
    }

    #[test]
    fn metadata_is_optional_and_absent_means_none() {
        let v = validate("visualizer", &viz_with(serde_json::json!({}))).unwrap();
        assert_eq!(v.meta.summary, None);
        assert_eq!(v.meta.category, None);
        assert!(v.meta.tags.is_empty());
    }

    #[test]
    fn metadata_round_trips_when_valid() {
        let v = validate(
            "visualizer",
            &viz_with(serde_json::json!({
                "summary": "A spinning thing",
                "description": "Longer prose about the spinning thing.",
                "category": "scene",
                "tags": ["retro", "slow"],
                "icon": "◆",
                "changelog": "Initial release.",
                "minAppVersion": "0.8.0"
            })),
        )
        .unwrap();
        assert_eq!(v.meta.summary.as_deref(), Some("A spinning thing"));
        assert_eq!(v.meta.category.as_deref(), Some("scene"));
        assert_eq!(v.meta.tags, vec!["retro".to_string(), "slow".to_string()]);
        assert_eq!(v.meta.icon.as_deref(), Some("◆"));
        assert_eq!(v.meta.min_app_version.as_deref(), Some("0.8.0"));
    }

    #[test]
    fn category_must_belong_to_the_kind() {
        // 'weather' is a tile category; a visualizer may not claim it.
        let err = validate("visualizer", &viz_with(serde_json::json!({"category": "weather"})))
            .unwrap_err();
        assert!(err.contains("category"), "unexpected error: {err}");
        assert!(category_ok("tile", "weather"));
        assert!(!category_ok("tile", "scene"));
        assert!(category_ok("preset", "milkdrop"));
    }

    #[test]
    fn summary_over_100_chars_is_rejected() {
        let long = "x".repeat(101);
        let err = validate("visualizer", &viz_with(serde_json::json!({"summary": long})))
            .unwrap_err();
        assert!(err.contains("summary"), "unexpected error: {err}");
    }

    #[test]
    fn tags_are_capped_and_shape_checked() {
        let nine: Vec<String> = (0..9).map(|i| format!("t{i}")).collect();
        let err = validate("visualizer", &viz_with(serde_json::json!({"tags": nine})))
            .unwrap_err();
        assert!(err.contains("tags"), "unexpected error: {err}");

        let err = validate("visualizer", &viz_with(serde_json::json!({"tags": ["Has Caps"]})))
            .unwrap_err();
        assert!(err.contains("tag"), "unexpected error: {err}");

        let err = validate("visualizer", &viz_with(serde_json::json!({"tags": "not-an-array"})))
            .unwrap_err();
        assert!(err.contains("tags"), "unexpected error: {err}");
    }

    #[test]
    fn icon_must_be_one_or_two_chars() {
        assert!(validate("visualizer", &viz_with(serde_json::json!({"icon": "◆"}))).is_ok());
        let err = validate("visualizer", &viz_with(serde_json::json!({"icon": "abc"})))
            .unwrap_err();
        assert!(err.contains("icon"), "unexpected error: {err}");
        let err = validate("visualizer", &viz_with(serde_json::json!({"icon": ""})))
            .unwrap_err();
        assert!(err.contains("icon"), "unexpected error: {err}");
    }

    #[test]
    fn min_app_version_must_be_dotted_numeric() {
        assert!(validate("visualizer", &viz_with(serde_json::json!({"minAppVersion": "1.2.3"}))).is_ok());
        let err = validate("visualizer", &viz_with(serde_json::json!({"minAppVersion": "next"})))
            .unwrap_err();
        assert!(err.contains("minAppVersion"), "unexpected error: {err}");
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
        // Since I9 added the secrets/`secret:` cross-check, a `secret:token`
        // permission now also needs a matching `secrets` entry to validate —
        // add one so this test still isolates "a tile may declare a secret:
        // permission", not the cross-check (covered separately below).
        let json = format!(
            r#"{{"id":"my-tile","name":"T","version":"1.0.0","api":1,"permissions":["secret:token"],"secrets":[{{"key":"token","label":"Token","kind":"password"}}]}}"#
        );
        let v = validate("tile", &json).unwrap();
        assert_eq!(v.permissions, vec![Perm::Secret("token".into())]);
    }

    // ── I9: secrets/config schema + cross-checks (mirrors
    // app/src/sandbox/manifest.test.ts's equivalent cases) ─────────────────

    fn m_full(perms: &str, extra: &str) -> String {
        format!(
            r#"{{"id":"x","name":"X","version":"1.0.0","api":1,"permissions":{perms}{extra}}}"#
        )
    }

    #[test]
    fn accepts_secrets_and_config_declarations() {
        let json = m_full(
            r#"["secret:token"]"#,
            r#","secrets":[{"key":"token","label":"API token","kind":"password"}],"config":[{"key":"symbols","label":"Symbols","type":"text"}]"#,
        );
        assert!(validate("tile", &json).is_ok());
    }

    #[test]
    fn secrets_rejects_non_array() {
        let json = m_full("[]", r#","secrets":"not-an-array""#);
        let err = validate("tile", &json).unwrap_err();
        assert!(err.contains("secrets must be an array"), "{err}");
    }

    #[test]
    fn secrets_rejects_bad_key_shape() {
        // No matching permission on purpose: `secret:UPPER` would itself fail
        // Perm::parse's identical [a-z0-9_] grammar first, which would mask
        // which check actually rejected this manifest. Omitting the
        // permission isolates the `secrets` array's own key-shape guard.
        let json = m_full("[]", r#","secrets":[{"key":"UPPER","label":"L","kind":"text"}]"#);
        let err = validate("tile", &json).unwrap_err();
        assert!(err.contains("secret key must be"), "{err}");
    }

    #[test]
    fn secrets_rejects_more_than_8() {
        let secrets: Vec<_> = (0..9)
            .map(|i| format!(r#"{{"key":"key{i}","label":"key{i}","kind":"text"}}"#))
            .collect();
        let perms: Vec<_> = (0..9).map(|i| format!(r#""secret:key{i}""#)).collect();
        let json = m_full(
            &format!("[{}]", perms.join(",")),
            &format!(r#","secrets":[{}]"#, secrets.join(",")),
        );
        assert!(validate("tile", &json).is_err());
    }

    #[test]
    fn secrets_exactly_8_passes() {
        let secrets: Vec<_> = (0..8)
            .map(|i| format!(r#"{{"key":"key{i}","label":"key{i}","kind":"text"}}"#))
            .collect();
        let perms: Vec<_> = (0..8).map(|i| format!(r#""secret:key{i}""#)).collect();
        let json = m_full(
            &format!("[{}]", perms.join(",")),
            &format!(r#","secrets":[{}]"#, secrets.join(",")),
        );
        assert!(validate("tile", &json).is_ok());
    }

    #[test]
    fn declared_secret_without_matching_permission_is_rejected() {
        let json = m_full("[]", r#","secrets":[{"key":"token","label":"API token","kind":"password"}]"#);
        let err = validate("tile", &json).unwrap_err();
        assert!(err.contains("secret:token"), "{err}");
    }

    #[test]
    fn secret_permission_with_no_secrets_array_at_all_is_rejected() {
        let json = m_full(r#"["secret:token"]"#, "");
        let err = validate("tile", &json).unwrap_err();
        assert!(err.contains("secret:token"), "{err}");
    }

    #[test]
    fn secret_permission_not_covered_by_any_secrets_entry_is_rejected() {
        // 'other' is present and matched (satisfies the forward rule) so
        // this isolates the reverse rule: 'token' has a permission but no
        // secrets entry.
        let json = m_full(
            r#"["secret:token","secret:other"]"#,
            r#","secrets":[{"key":"other","label":"Other","kind":"text"}]"#,
        );
        let err = validate("tile", &json).unwrap_err();
        assert!(err.contains("secret:token"), "{err}");
    }

    #[test]
    fn config_rejects_non_array() {
        let json = m_full("[]", r#","config":"nope""#);
        let err = validate("tile", &json).unwrap_err();
        assert!(err.contains("config must be an array"), "{err}");
    }

    #[test]
    fn config_rejects_bad_type() {
        let json = m_full("[]", r#","config":[{"key":"k","label":"L","type":"bool"}]"#);
        let err = validate("tile", &json).unwrap_err();
        assert!(err.contains("type must be"), "{err}");
    }

    #[test]
    fn config_exactly_8_passes_and_9_fails() {
        let cfg8: Vec<_> = (0..8)
            .map(|i| format!(r#"{{"key":"key{i}","label":"key{i}","type":"text"}}"#))
            .collect();
        let json8 = m_full("[]", &format!(r#","config":[{}]"#, cfg8.join(",")));
        assert!(validate("tile", &json8).is_ok());

        let cfg9: Vec<_> = (0..9)
            .map(|i| format!(r#"{{"key":"key{i}","label":"key{i}","type":"text"}}"#))
            .collect();
        let json9 = m_full("[]", &format!(r#","config":[{}]"#, cfg9.join(",")));
        assert!(validate("tile", &json9).is_err());
    }

    // ── I11: surface: 'canvas' | 'dom' (mirrors
    // app/src/sandbox/manifest.test.ts's equivalent cases) ──────────────────

    #[test]
    fn surface_absent_is_accepted() {
        let json = m_full("[]", "");
        assert!(validate("visualizer", &json).is_ok());
    }

    #[test]
    fn surface_canvas_and_dom_are_accepted() {
        for s in ["canvas", "dom"] {
            let json = m_full("[]", &format!(r#","surface":"{s}""#));
            assert!(validate("visualizer", &json).is_ok(), "{s} should be accepted");
        }
    }

    #[test]
    fn unknown_surface_is_rejected() {
        let json = m_full("[]", r#","surface":"webgl""#);
        let err = validate("visualizer", &json).unwrap_err();
        assert!(err.contains("surface"), "{err}");
    }

    #[test]
    fn non_string_surface_is_rejected() {
        let json = m_full("[]", r#","surface":1"#);
        let err = validate("visualizer", &json).unwrap_err();
        assert!(err.contains("surface"), "{err}");
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
    fn interval_above_24h_ceiling_is_rejected() {
        // At the ceiling: passes.
        let at_ceiling = r#"{
            "source": {"kind":"http","url":"https://api.example.com/data","intervalMs":86400000},
            "view": {"type":"stat","value":"x"}
        }"#;
        assert!(validate_view_spec(at_ceiling).is_ok());

        // One past it: rejected.
        let one_over = r#"{
            "source": {"kind":"http","url":"https://api.example.com/data","intervalMs":86400001},
            "view": {"type":"stat","value":"x"}
        }"#;
        let err = validate_view_spec(one_over).unwrap_err();
        assert!(err.contains("86400000"), "{err}");

        // The value from the I3 review finding ("~25 days") that used to
        // publish and degenerate setTimeout's delay to 0 client-side.
        let huge = r#"{
            "source": {"kind":"http","url":"https://api.example.com/data","intervalMs":2200000000},
            "view": {"type":"stat","value":"x"}
        }"#;
        assert!(validate_view_spec(huge).is_err());
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
    fn select_accepts_a_literal_integer_segment() {
        let one = r#"{
            "source": {"kind":"http","url":"https://api.example.com/data","intervalMs":30000},
            "select": "data.0.q",
            "view": {"type":"stat","value":"x"}
        }"#;
        assert!(validate_view_spec(one).is_ok());

        let two = r#"{
            "source": {"kind":"http","url":"https://api.example.com/data","intervalMs":30000},
            "select": "a.0.b.1.c",
            "view": {"type":"stat","value":"x"}
        }"#;
        assert!(validate_view_spec(two).is_ok());
    }

    #[test]
    fn select_still_rejects_bracket_indexing_negative_and_decorated_integers_and_a_bare_dot() {
        for bad_select in ["items[0].x", "a.-1.b", "a.01x.b", "."] {
            let json = format!(
                r#"{{
                    "source": {{"kind":"http","url":"https://api.example.com/data","intervalMs":30000}},
                    "select": {bad_select:?},
                    "view": {{"type":"stat","value":"x"}}
                }}"#
            );
            assert!(validate_view_spec(&json).is_err(), "{bad_select:?} should be rejected");
        }
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
    fn secret_ref_matches_unicode_whitespace_like_js_s(){
        // NBSP (U+00A0), LINE SEPARATOR (U+2028), IDEOGRAPHIC SPACE (U+3000)
        // — all whitespace per JS's \s (the app's SECRET_RE in viewSpec.ts),
        // all missed by the old byte-indexed is_ascii_whitespace scan (I10).
        assert!(has_secret_ref("{{\u{00A0}secret.token}}"));
        assert!(has_secret_ref("{{\u{2028}secret.token}}"));
        assert!(has_secret_ref("{{\u{3000}secret.token}}"));
        // Plain ASCII whitespace still matches (regression check).
        assert!(has_secret_ref("{{  secret.token  }}"));
        assert!(has_secret_ref("{{\tsecret.token}}"));
    }

    #[test]
    fn secret_ref_matches_u_feff_explicitly() {
        // U+FEFF (BOM / ZERO WIDTH NO-BREAK SPACE) is whitespace per JS's \s
        // (the ECMAScript WhiteSpace production) but NOT per Unicode's
        // White_Space property, so char::is_whitespace() alone still misses
        // it — checked for explicitly as a second condition (see has_secret_ref's
        // doc comment) to close the last app/server disagreement gap.
        assert!(has_secret_ref("{{\u{FEFF}secret.token}}"));
        // Mixed with ordinary whitespace, before and after the BOM.
        assert!(has_secret_ref("{{ \u{FEFF} secret.token}}"));
    }

    #[test]
    fn view_with_feff_before_secret_is_rejected_end_to_end() {
        let json = "{\"source\":{\"kind\":\"http\",\"url\":\"https://x\",\"intervalMs\":30000},\"view\":{\"type\":\"badge\",\"value\":\"{{\u{FEFF}secret.token}}\"}}";
        let err = validate_view_spec(json).unwrap_err();
        assert!(err.contains("secret"), "{err}");
    }

    #[test]
    fn view_with_nbsp_before_secret_is_rejected_end_to_end() {
        // Before I10's fix this would have PUBLISHED (server didn't see the
        // secret ref) yet FAILED to install (the app's JS regex did see it) —
        // a bundle that publishes successfully but breaks for every installer.
        let json = "{\"source\":{\"kind\":\"http\",\"url\":\"https://x\",\"intervalMs\":30000},\"view\":{\"type\":\"badge\",\"value\":\"{{\u{00A0}secret.token}}\"}}";
        let err = validate_view_spec(json).unwrap_err();
        assert!(err.contains("secret"), "{err}");
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

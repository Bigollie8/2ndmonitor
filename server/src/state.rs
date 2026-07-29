//! Shared state + configuration. Every optional capability is driven by an
//! env var and degrades gracefully when absent (see README):
//!   PORT               listen port (default 8787)
//!   SERVER_DATA_DIR    sqlite db + signing key location (default ./data)
//!   ADMIN_TOKEN        bearer token for /admin — unset ⇒ admin endpoints 403
//!   ANTHROPIC_API_KEY  enables the AI review pipeline step
//!   SMTP_URL           reserved for a mail relay; unset ⇒ dev mode (links
//!                      returned in responses and logged)

use parking_lot::Mutex;
use rusqlite::Connection;
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Instant;

#[derive(Clone)]
pub struct Config {
    pub port: u16,
    pub data_dir: std::path::PathBuf,
    pub admin_token: Option<String>,
    pub anthropic_api_key: Option<String>,
    pub smtp_url: Option<String>,
}

impl Config {
    pub fn from_env() -> Self {
        Config {
            port: std::env::var("PORT").ok().and_then(|p| p.parse().ok()).unwrap_or(8787),
            data_dir: std::env::var("SERVER_DATA_DIR").unwrap_or_else(|_| "./data".into()).into(),
            admin_token: std::env::var("ADMIN_TOKEN").ok().filter(|s| !s.is_empty()),
            anthropic_api_key: std::env::var("ANTHROPIC_API_KEY").ok().filter(|s| !s.is_empty()),
            smtp_url: std::env::var("SMTP_URL").ok().filter(|s| !s.is_empty()),
        }
    }

    /// In-memory config for tests: dev-mode email, admin token "test-admin".
    pub fn test() -> Self {
        Config {
            port: 0,
            data_dir: std::env::temp_dir().join("hub-marketplace-test"),
            admin_token: Some("test-admin".into()),
            anthropic_api_key: None,
            smtp_url: None,
        }
    }
}

/// Signature over the review closure so tests can inject a canned reviewer.
pub type ReviewFn = Arc<dyn Fn(&str, &str, Option<&str>) -> Option<String> + Send + Sync>;

#[derive(Clone)]
pub struct AppState {
    pub db: Arc<Mutex<Connection>>,
    pub cfg: Config,
    /// (ip, route) -> hit timestamps within the window.
    pub limiter: Arc<Mutex<HashMap<(String, String), Vec<Instant>>>>,
    /// ed25519 signing key seed (32 bytes). Loaded/generated at startup.
    pub signing_seed: [u8; 32],
    /// AI reviewer: (manifest, code, prev_code) -> ai_report JSON. None = skip.
    pub review_fn: Option<ReviewFn>,
}

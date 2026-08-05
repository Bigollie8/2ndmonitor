//! Creator handle rules.
//!
//! Pure and table-tested: a handle is the one piece of identity that appears
//! in URLs, in attribution on every card, and in the signed index, so the
//! rules for what one may be belong in a function with tests rather than
//! scattered across handlers.

/// Whole handles nobody may claim. Impersonation is the cheapest attack on a
/// marketplace — a bundle published by "official" reads as first-party — and
/// the routing-shaped ones (`api`, `www`) are reserved so a future
/// `/<handle>` route cannot collide with a real path.
pub const RESERVED: &[&str] = &[
    "admin", "administrator", "official", "support", "help", "moderator",
    "mod", "root", "system", "api", "www", "2ndmonitor", "secondmonitor",
    "marketplace", "staff", "security", "abuse",
];

pub const MIN_LEN: usize = 3;
pub const MAX_LEN: usize = 24;

/// Trim and lowercase. Applied before validation and before storage, so a
/// handle has exactly one canonical form and `Oliver` cannot coexist with
/// `oliver`.
pub fn normalise(raw: &str) -> String {
    raw.trim().to_lowercase()
}

/// The normalised handle, or a reason suitable for showing to a person.
pub fn validate(raw: &str) -> Result<String, &'static str> {
    let h = normalise(raw);
    if h.is_empty() {
        return Err("choose a handle");
    }
    if h.chars().count() < MIN_LEN {
        return Err("handles are at least 3 characters");
    }
    if h.chars().count() > MAX_LEN {
        return Err("handles are at most 24 characters");
    }
    if !h
        .chars()
        .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_' || c == '-')
    {
        return Err("handles use letters, numbers, hyphens and underscores only");
    }
    if RESERVED.contains(&h.as_str()) {
        return Err("that handle is reserved");
    }
    Ok(h)
}

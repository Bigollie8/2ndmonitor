//! Advisory AI review step. Never blocks or gates a submission — the output
//! lands in the admin queue for the human decision. Task 6 wires the real
//! Claude API call; `state.review_fn` lets tests inject a canned reviewer.

use crate::state::AppState;

/// Fire the reviewer for a pending bundle. Synchronous when a test reviewer
/// is injected; the live path (API key configured) is wired in ai_review's
/// full implementation.
pub fn kick(state: &AppState, id: &str, version: &str) {
    let Some(review_fn) = state.review_fn.clone() else {
        return; // no reviewer configured — human queue only
    };
    let (manifest, code, prev_code): (String, Option<String>, Option<String>) = {
        let db = state.db.lock();
        let Ok(row) = db.query_row(
            "SELECT manifest, code FROM bundles WHERE id = ?1 AND version = ?2",
            rusqlite::params![id, version],
            |r| Ok((r.get::<_, String>(0)?, r.get::<_, Option<String>>(1)?)),
        ) else {
            return;
        };
        let prev = db
            .query_row(
                "SELECT code FROM bundles WHERE id = ?1 AND status = 'approved' ORDER BY created_at DESC LIMIT 1",
                [id],
                |r| r.get::<_, Option<String>>(0),
            )
            .ok()
            .flatten();
        (row.0, row.1, prev)
    };
    let report = review_fn(&manifest, code.as_deref().unwrap_or(""), prev_code.as_deref());
    if let Some(report) = report {
        let _ = state.db.lock().execute(
            "UPDATE bundles SET ai_report = ?1 WHERE id = ?2 AND version = ?3",
            rusqlite::params![report, id, version],
        );
    }
}

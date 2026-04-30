//! Scan ~/.claude/projects/<project>/<session>.jsonl files and surface what
//! each active Claude Code session is doing — needs your input? running a
//! tool? idle? — so the hub tile can pulse the ones that need attention.
//!
//! The session JSONL format is one JSON object per line. We only look at the
//! tail (last few entries) to infer status. The most useful signals:
//!
//! - last entry type=`assistant`, stop_reason=`end_turn`  →  awaiting your reply
//! - last entry type=`assistant`, stop_reason=`tool_use`  →  running a tool
//! - last entry type=`tool_result` and very recent       →  agent is processing
//! - last entry type=`user`                              →  agent is processing
//! - file mtime older than 10 minutes                    →  idle

use serde::Serialize;
use serde_json::Value;
use std::{
    fs,
    path::{Path, PathBuf},
    time::{Duration, SystemTime},
};
use tauri::{AppHandle, Emitter, Runtime};

const SCAN_INTERVAL_SECS: u64 = 5;
/// Sessions older than this drop off the active list.
const MAX_AGE_SECS: u64 = 24 * 3600;
/// "Stuck" / awaiting-tool-permission heuristic threshold.
const STALE_TOOL_SECS: u64 = 15;
/// Idle threshold for the "idle" status.
const IDLE_SECS: u64 = 10 * 60;
/// Project-name substrings to exclude from the active list (case-insensitive).
/// Match either the encoded folder name or the decoded path.
const HIDDEN_PROJECT_SUBSTRINGS: &[&str] = &["nsfw"];

#[derive(Debug, Serialize, Clone)]
pub struct ClaudeSession {
    pub project: String,
    pub project_path: String,
    pub session_id: String,
    pub last_activity_secs: u64,
    /// One of: "awaiting_user" | "running_tool" | "permission" | "working" | "idle"
    pub status: String,
    pub status_detail: String,
    pub last_user_msg: Option<String>,
}

pub fn spawn<R: Runtime>(app: AppHandle<R>) {
    std::thread::spawn(move || loop {
        let sessions = scan();
        let _ = app.emit("claude:sessions", &sessions);
        std::thread::sleep(Duration::from_secs(SCAN_INTERVAL_SECS));
    });
}

fn home_dir() -> Option<PathBuf> {
    std::env::var_os("USERPROFILE")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(PathBuf::from))
}

fn scan() -> Vec<ClaudeSession> {
    let mut out = Vec::new();
    let Some(home) = home_dir() else { return out };
    let projects_dir = home.join(".claude").join("projects");
    if !projects_dir.exists() {
        return out;
    }

    let Ok(project_entries) = fs::read_dir(&projects_dir) else {
        return out;
    };
    for proj in project_entries.flatten() {
        let proj_path = proj.path();
        if !proj_path.is_dir() {
            continue;
        }
        let proj_dir_name = proj_path
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_string();
        let decoded_path = decode_project_path(&proj_dir_name);
        let project_human = decoded_path
            .rsplit(['/', '\\'])
            .find(|s| !s.is_empty())
            .unwrap_or("project")
            .to_string();

        // Skip projects whose name or full path contains any blocked substring.
        let lc_name = proj_dir_name.to_ascii_lowercase();
        let lc_path = decoded_path.to_ascii_lowercase();
        let lc_human = project_human.to_ascii_lowercase();
        if HIDDEN_PROJECT_SUBSTRINGS
            .iter()
            .any(|s| lc_name.contains(s) || lc_path.contains(s) || lc_human.contains(s))
        {
            continue;
        }

        let Ok(session_files) = fs::read_dir(&proj_path) else {
            continue;
        };
        for sf in session_files.flatten() {
            let p = sf.path();
            if p.extension().and_then(|s| s.to_str()) != Some("jsonl") {
                continue;
            }
            let Ok(meta) = sf.metadata() else { continue };
            let mtime = meta.modified().unwrap_or(SystemTime::UNIX_EPOCH);
            let age = SystemTime::now()
                .duration_since(mtime)
                .unwrap_or_default()
                .as_secs();
            if age > MAX_AGE_SECS {
                continue;
            }

            let session_id = p
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("")
                .to_string();

            let (status, detail, last_user) = analyze_session(&p, age);

            out.push(ClaudeSession {
                project: project_human.clone(),
                project_path: decoded_path.clone(),
                session_id,
                last_activity_secs: age,
                status,
                status_detail: detail,
                last_user_msg: last_user,
            });
        }
    }

    // Awaiting-user first, then running, then by recency.
    out.sort_by(|a, b| {
        let rank = |s: &ClaudeSession| match s.status.as_str() {
            "awaiting_user" | "permission" => 0,
            "running_tool" | "working" => 1,
            "idle" => 2,
            _ => 3,
        };
        rank(a)
            .cmp(&rank(b))
            .then(a.last_activity_secs.cmp(&b.last_activity_secs))
    });
    out
}

/// Claude Code escapes the project's absolute path into the directory name.
/// It replaces every path separator AND every `:` with `-`, so a Windows
/// path like `C:\Users\bigol\Projects\foo` becomes `C--Users-bigol-Projects-foo`.
/// We can't perfectly reverse the escape (a real `-` in a path is ambiguous),
/// so we just decode in a way that produces a readable label and a usable
/// "leaf" component for the tile.
fn decode_project_path(encoded: &str) -> String {
    if encoded.len() >= 3 && encoded.as_bytes()[1..3] == *b"--" && encoded.as_bytes()[0].is_ascii_alphabetic() {
        // Looks like a Windows drive: "C--..." -> "C:\..."
        let mut s = encoded.replacen("--", ":\\", 1);
        // Restore the rest of the path separators. Real `-` characters in
        // folder names will be lost — that's the cost of the lossy encoding.
        s = s.replace('-', "\\");
        s
    } else {
        format!("/{}", encoded.replace('-', "/"))
    }
}

fn analyze_session(path: &Path, age_secs: u64) -> (String, String, Option<String>) {
    let Ok(content) = fs::read_to_string(path) else {
        return ("idle".into(), "couldn't read".into(), None);
    };
    let last_line = content
        .lines()
        .rev()
        .find(|l| !l.trim().is_empty());
    let Some(last_line) = last_line else {
        return ("idle".into(), "empty session".into(), None);
    };
    let Ok(last) = serde_json::from_str::<Value>(last_line) else {
        return ("idle".into(), "parse error".into(), None);
    };

    let entry_type = last.get("type").and_then(|v| v.as_str()).unwrap_or("");

    // Walk the file backwards once for the most recent user-typed prompt.
    let last_user_msg = content.lines().rev().find_map(|l| {
        let v: Value = serde_json::from_str(l).ok()?;
        if v.get("type").and_then(|t| t.as_str()) != Some("user") {
            return None;
        }
        // Skip synthetic user messages that are tool results (not real input).
        let msg = v.get("message")?;
        let content_field = msg.get("content")?;
        let text = if let Some(s) = content_field.as_str() {
            s.to_string()
        } else if let Some(arr) = content_field.as_array() {
            // Real user prompts are usually plain strings; tool_result lives
            // inside a content array. We pull text only.
            let mut combined = String::new();
            let mut has_text_block = false;
            for block in arr {
                if block.get("type").and_then(|t| t.as_str()) == Some("text") {
                    if let Some(t) = block.get("text").and_then(|v| v.as_str()) {
                        if !combined.is_empty() {
                            combined.push(' ');
                        }
                        combined.push_str(t);
                        has_text_block = true;
                    }
                }
            }
            if !has_text_block {
                return None;
            }
            combined
        } else {
            return None;
        };
        let trimmed = text.trim();
        if trimmed.is_empty() {
            return None;
        }
        let truncated: String = trimmed.chars().take(80).collect();
        Some(if trimmed.chars().count() > 80 {
            format!("{truncated}…")
        } else {
            truncated
        })
    });

    if age_secs > IDLE_SECS {
        return ("idle".into(), format!("idle {}", fmt_age(age_secs)), last_user_msg);
    }

    match entry_type {
        "assistant" => {
            let stop = last
                .get("message")
                .and_then(|m| m.get("stop_reason"))
                .and_then(|s| s.as_str());
            let tool_uses: Vec<String> = last
                .get("message")
                .and_then(|m| m.get("content"))
                .and_then(|c| c.as_array())
                .map(|arr| {
                    arr.iter()
                        .filter_map(|b| {
                            if b.get("type").and_then(|t| t.as_str()) == Some("tool_use") {
                                b.get("name").and_then(|n| n.as_str()).map(|s| s.to_string())
                            } else {
                                None
                            }
                        })
                        .collect()
                })
                .unwrap_or_default();

            if !tool_uses.is_empty() {
                let label = tool_uses.join(", ");
                if age_secs > STALE_TOOL_SECS {
                    return (
                        "permission".into(),
                        format!("Permission needed: {label}"),
                        last_user_msg,
                    );
                }
                return ("running_tool".into(), format!("Running: {label}"), last_user_msg);
            }
            match stop {
                Some("end_turn") => ("awaiting_user".into(), "Awaiting your reply".into(), last_user_msg),
                Some(other) => ("working".into(), format!("stop: {other}"), last_user_msg),
                None => ("working".into(), "Generating".into(), last_user_msg),
            }
        }
        "user" => ("working".into(), "Claude is processing".into(), last_user_msg),
        "tool_result" => ("working".into(), "Tool finished, generating reply".into(), last_user_msg),
        other => ("idle".into(), other.to_string(), last_user_msg),
    }
}

fn fmt_age(secs: u64) -> String {
    if secs < 60 {
        format!("{secs}s")
    } else if secs < 3600 {
        format!("{}m", secs / 60)
    } else {
        format!("{}h", secs / 3600)
    }
}

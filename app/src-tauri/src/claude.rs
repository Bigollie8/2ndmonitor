//! Scan ~/.claude/projects/<project>/<session>.jsonl files and surface what
//! each active Claude Code session is doing — needs your input? running a
//! tool? idle? — so the hub tile can pulse the ones that need attention.
//!
//! The session JSONL format is one JSON object per line. We only look at the
//! tail (last few entries) to infer status. Verified against real 2.1.x
//! transcripts (0.9.8):
//!
//! - Only `type=user` / `type=assistant` lines carry conversational state.
//!   The file is FULL of bookkeeping lines that can be the physical last
//!   line — `attachment`, `last-prompt`, `mode`, `permission-mode`,
//!   `ai-title`, `custom-title`, `agent-name`, `agent-color`,
//!   `bridge-session`, `file-history-*`, `queue-operation`, `system`,
//!   `summary`, … — so status walks BACKWARD to the last meaningful line
//!   instead of keying on whatever happens to be final (the old behavior
//!   read "idle" for a hard-working session whose last line was metadata;
//!   that was the "only catches certain commands" report).
//! - Tool results are NOT `type=tool_result`: they arrive as `type=user`
//!   with a `tool_result` block inside `message.content`.
//! - `isSidechain: true` lines are subagent traffic — skipped; the main
//!   thread's state is what the tile should reflect.
//! - assistant + `tool_use` blocks           →  a tool was dispatched
//! - assistant + stop_reason=`end_turn`      →  awaiting your reply
//! - file mtime older than 10 minutes        →  idle
//!
//! Running vs. waiting-for-permission: the transcript records NOTHING when a
//! permission prompt is showing (verified — no marker entry exists), so that
//! distinction is inferred:
//! - `~/.claude/sessions/<pid>.json` registers each live interactive
//!   process. A session with no live process can be neither running a tool
//!   nor prompting — this kills the old failure mode where a session killed
//!   mid-tool showed "Permission needed" for 24 hours. The registry is
//!   treated as advisory: if it's missing or unreadable (older Claude Code)
//!   we fail OPEN and assume alive.
//! - Read-only tools (Read/Grep/Glob/…) are auto-approved and never prompt.
//! - Known long-runners (Bash/Task/agents) routinely run for minutes; a
//!   quiet transcript there means "still running", and only the detail text
//!   hints at a possible approval wait — never a false "NEEDS YOU".
//! - Everything else (Edit/Write/MCP tools) completes in seconds once
//!   approved, so quiet-beyond-15s genuinely does mean a prompt is up.

use once_cell::sync::Lazy;
use parking_lot::Mutex;
use serde::Serialize;
use serde_json::Value;
use std::{
    collections::HashMap,
    fs,
    io::{Read, Seek, SeekFrom},
    path::{Path, PathBuf},
    time::{Duration, SystemTime},
};
use tauri::{AppHandle, Emitter, Runtime};

const SCAN_INTERVAL_SECS: u64 = 5;
/// Sessions older than this drop off the active list.
const MAX_AGE_SECS: u64 = 24 * 3600;
/// "Stuck" / awaiting-tool-permission heuristic threshold — applied only to
/// tools that complete quickly once approved (NOT the long-runner list).
const STALE_TOOL_SECS: u64 = 15;
/// Past this, a quiet long-runner's detail text mentions the approval
/// possibility. Status stays `running_tool` — builds/tests legitimately run
/// for many minutes and must never read as "NEEDS YOU".
const LONG_TOOL_HINT_SECS: u64 = 60;
/// Auto-approved, read-only tools: these never show a permission prompt, so
/// a pending call is always "running" no matter how quiet the transcript is.
const READONLY_TOOLS: &[&str] = &[
    "Read", "Glob", "Grep", "LS", "TaskOutput", "TaskList", "TaskGet",
    "TodoWrite", "NotebookRead", "ToolSearch",
];
/// Tools that routinely run for minutes when approved (shell commands,
/// subagents, workflows). A quiet transcript with one of these pending means
/// "still running" far more often than "waiting for approval".
const LONG_RUNNER_TOOLS: &[&str] = &[
    "Bash", "PowerShell", "Task", "Agent", "Workflow", "Monitor",
];
/// Idle threshold for the "idle" status.
const IDLE_SECS: u64 = 10 * 60;
/// Project-name substrings to exclude from the active list (case-insensitive).
/// Match either the encoded folder name or the decoded path.
const HIDDEN_PROJECT_SUBSTRINGS: &[&str] = &["nsfw"];
/// How much of a transcript's tail we read to infer status. The doc comment
/// above always SAID "we only look at the tail" — until 0.9.5 the code read
/// the whole file. On a machine with hundreds of active multi-MB transcripts
/// (any Claude Code power user) that was hundreds of MB of allocation churn
/// every 5 seconds, forever — the RAM-leak report's Rust-side contributor.
const TAIL_BYTES: u64 = 64 * 1024;

/// Only scan while a Claude tile is actually mounted (0.9.5) — the same
/// gate mixer.rs uses for its 1Hz COM enumeration. Most users never place
/// this tile; they paid for the scan on every tick anyway.
static CLAUDE_ACTIVE: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

#[tauri::command]
pub fn set_claude_active(active: bool) {
    CLAUDE_ACTIVE.store(active, std::sync::atomic::Ordering::Relaxed);
}

/// Per-file analysis memo keyed by (mtime, len): an unchanged transcript is
/// not re-read, let alone re-parsed, on the next tick. Entries for files
/// that leave the scan window are dropped at the end of each scan, so the
/// map is bounded by the count of active session files.
static ANALYSIS_CACHE: Lazy<Mutex<HashMap<PathBuf, AnalysisEntry>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

/// What the transcript SAYS, independent of clock and process state. The
/// memo stores this instead of a final status string because two of the
/// status inputs — elapsed time and process liveness — change without the
/// file changing. The old cache froze "running_tool" vs "permission" at
/// whatever was true on the first parse; `finalize()` now re-derives the
/// final status from this snapshot on every tick, cache hit or not.
#[derive(Clone, PartialEq)]
enum ParsedState {
    /// Empty file, unreadable, or nothing but bookkeeping lines.
    NoConversation(String),
    /// The last meaningful line dispatched one or more tools.
    PendingTool { label: String, readonly: bool, long_runner: bool },
    /// assistant + stop_reason=end_turn.
    AwaitingUser,
    /// Claude is between visible states (user prompt landed, tool result
    /// landed, or an assistant line that isn't end_turn/tool_use).
    Working(String),
}

struct AnalysisEntry {
    mtime: SystemTime,
    len: u64,
    state: ParsedState,
    last_user: Option<String>,
}

#[derive(Debug, Serialize, Clone, PartialEq)]
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
    std::thread::spawn(move || {
        let mut last_emitted: Option<Vec<ClaudeSession>> = None;
        loop {
            if CLAUDE_ACTIVE.load(std::sync::atomic::Ordering::Relaxed) {
                let sessions = scan();
                // Identical scans (the common idle case) are not re-emitted:
                // each emit serializes the whole list into the webview, and
                // at 12 emits/minute forever that churn adds up.
                if last_emitted.as_ref() != Some(&sessions) {
                    let _ = app.emit("claude:sessions", &sessions);
                    last_emitted = Some(sessions);
                }
            } else if last_emitted.is_some() {
                // Tile unmounted: clear so a remount starts fresh.
                last_emitted = None;
                ANALYSIS_CACHE.lock().clear();
            }
            std::thread::sleep(Duration::from_secs(SCAN_INTERVAL_SECS));
        }
    });
}

fn home_dir() -> Option<PathBuf> {
    std::env::var_os("USERPROFILE")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(PathBuf::from))
}

/// Session ids with a LIVE Claude Code process, from the
/// `~/.claude/sessions/<pid>.json` registry, PID-verified via sysinfo.
/// `None` = the registry is unavailable (missing dir, unreadable, or no
/// parseable entries — e.g. an older Claude Code) → callers fail OPEN and
/// treat every session as possibly alive. `Some(empty)` is real information:
/// the registry works and nothing is running.
fn live_session_ids() -> Option<std::collections::HashSet<String>> {
    let dir = home_dir()?.join(".claude").join("sessions");
    let entries = fs::read_dir(&dir).ok()?;
    let mut candidates: Vec<(u32, String)> = Vec::new();
    for e in entries.flatten() {
        let p = e.path();
        if p.extension().and_then(|s| s.to_str()) != Some("json") {
            continue;
        }
        let Ok(text) = fs::read_to_string(&p) else { continue };
        let Ok(v) = serde_json::from_str::<Value>(&text) else { continue };
        let (Some(pid), Some(sid)) = (
            v.get("pid").and_then(|p| p.as_u64()),
            v.get("sessionId").and_then(|s| s.as_str()),
        ) else {
            continue;
        };
        candidates.push((pid as u32, sid.to_string()));
    }
    if candidates.is_empty() {
        return None;
    }
    // Registry files can linger after a crash — verify each PID is actually
    // alive. A handful of targeted refreshes every 5s is negligible.
    let mut sys = sysinfo::System::new();
    let pids: Vec<sysinfo::Pid> = candidates
        .iter()
        .map(|(p, _)| sysinfo::Pid::from_u32(*p))
        .collect();
    sys.refresh_processes(sysinfo::ProcessesToUpdate::Some(&pids), false);
    Some(
        candidates
            .into_iter()
            .filter(|(p, _)| sys.process(sysinfo::Pid::from_u32(*p)).is_some())
            .map(|(_, s)| s)
            .collect(),
    )
}

fn scan() -> Vec<ClaudeSession> {
    let mut out = Vec::new();
    let mut seen_paths: std::collections::HashSet<PathBuf> = std::collections::HashSet::new();
    let Some(home) = home_dir() else { return out };
    let live_ids = live_session_ids();
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

            // None (registry unavailable) → unknown → fail open (alive).
            let alive = live_ids.as_ref().map(|ids| ids.contains(&session_id));
            let (status, detail, last_user) = analyze_session_cached(&p, mtime, meta.len(), age, alive);
            seen_paths.insert(p.clone());

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

    // Drop memo entries for files that left the scan window, so the cache
    // stays bounded by the active session count.
    ANALYSIS_CACHE.lock().retain(|path, _| seen_paths.contains(path));

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

/// Memoized wrapper: identical (mtime, len) means the transcript hasn't
/// changed since the last tick — reuse the PARSED state instead of touching
/// the file at all. Time- and liveness-derived status (idle aging, the
/// permission threshold, a session's process dying) is re-finalized from the
/// cached snapshot on every tick, so those transitions happen on schedule
/// even while the file itself is quiet.
fn analyze_session_cached(
    path: &Path,
    mtime: SystemTime,
    len: u64,
    age_secs: u64,
    alive: Option<bool>,
) -> (String, String, Option<String>) {
    {
        let cache = ANALYSIS_CACHE.lock();
        if let Some(e) = cache.get(path) {
            if e.mtime == mtime && e.len == len {
                let (status, detail) = finalize(&e.state, age_secs, alive);
                return (status, detail, e.last_user.clone());
            }
        }
    }
    let (state, last_user) = parse_transcript(path);
    let (status, detail) = finalize(&state, age_secs, alive);
    ANALYSIS_CACHE.lock().insert(
        path.to_path_buf(),
        AnalysisEntry { mtime, len, state, last_user: last_user.clone() },
    );
    (status, detail, last_user)
}

/// Reads at most the last [`TAIL_BYTES`] of the transcript. A cut first line
/// is dropped (it's mid-JSON); every signal this module infers lives in the
/// final few entries anyway — this makes the module's "we only look at the
/// tail" doc comment true for the first time (0.9.5).
fn read_tail(path: &Path) -> Option<String> {
    let mut f = fs::File::open(path).ok()?;
    let len = f.metadata().ok()?.len();
    let start = len.saturating_sub(TAIL_BYTES);
    f.seek(SeekFrom::Start(start)).ok()?;
    let mut buf = Vec::with_capacity((len - start) as usize);
    f.read_to_end(&mut buf).ok()?;
    let mut s = String::from_utf8_lossy(&buf).into_owned();
    if start > 0 {
        if let Some(nl) = s.find('\n') {
            s.drain(..=nl);
        }
    }
    Some(s)
}

fn parse_transcript(path: &Path) -> (ParsedState, Option<String>) {
    let Some(content) = read_tail(path) else {
        return (ParsedState::NoConversation("couldn't read".into()), None);
    };
    parse_transcript_content(&content)
}

/// Pure over the tail text — the unit-testable core.
fn parse_transcript_content(content: &str) -> (ParsedState, Option<String>) {
    // The last MEANINGFUL line: only user/assistant lines carry
    // conversational state (see module docs for the bookkeeping-type zoo),
    // and subagent (isSidechain) traffic doesn't speak for the main thread.
    let last = content.lines().rev().find_map(|l| {
        if l.trim().is_empty() {
            return None;
        }
        let v: Value = serde_json::from_str(l).ok()?;
        let t = v.get("type").and_then(|t| t.as_str())?;
        if t != "user" && t != "assistant" {
            return None;
        }
        if v.get("isSidechain").and_then(|s| s.as_bool()) == Some(true) {
            return None;
        }
        Some(v)
    });

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

    let Some(last) = last else {
        return (ParsedState::NoConversation("no conversation yet".into()), last_user_msg);
    };

    let entry_type = last.get("type").and_then(|v| v.as_str()).unwrap_or("");
    let state = match entry_type {
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
                ParsedState::PendingTool {
                    readonly: tool_uses.iter().all(|t| READONLY_TOOLS.contains(&t.as_str())),
                    long_runner: tool_uses.iter().any(|t| LONG_RUNNER_TOOLS.contains(&t.as_str())),
                    label: tool_uses.join(", "),
                }
            } else {
                match stop {
                    Some("end_turn") => ParsedState::AwaitingUser,
                    // Mid-turn assistant lines (thinking/text blocks of a
                    // tool-calling turn carry stop_reason=tool_use with no
                    // tool_use block on THIS line; streaming lines carry
                    // null) — all mean "Claude is doing something".
                    Some(_) | None => ParsedState::Working("Generating".into()),
                }
            }
        }
        // A `user` line is either a real prompt or a tool_result envelope —
        // both mean Claude has input in hand and is (about to be) working.
        "user" => {
            let is_tool_result = last
                .get("message")
                .and_then(|m| m.get("content"))
                .and_then(|c| c.as_array())
                .map(|arr| {
                    arr.iter().any(|b| {
                        b.get("type").and_then(|t| t.as_str()) == Some("tool_result")
                    })
                })
                .unwrap_or(false);
            if is_tool_result {
                ParsedState::Working("Tool finished, generating reply".into())
            } else {
                ParsedState::Working("Claude is processing".into())
            }
        }
        other => ParsedState::NoConversation(other.to_string()),
    };
    (state, last_user_msg)
}

/// Combine what the transcript says with the clock and process liveness.
/// Pure — unit-tested. `alive: None` = registry unavailable → assume alive.
fn finalize(state: &ParsedState, age_secs: u64, alive: Option<bool>) -> (String, String) {
    if age_secs > IDLE_SECS {
        return ("idle".into(), format!("idle {}", fmt_age(age_secs)));
    }
    // A dead process can't be running, prompting, or generating; and a
    // closed session shouldn't pulse "awaiting your reply" either.
    if alive == Some(false) {
        return ("idle".into(), "session ended".into());
    }
    match state {
        ParsedState::NoConversation(detail) => ("idle".into(), detail.clone()),
        ParsedState::AwaitingUser => ("awaiting_user".into(), "Awaiting your reply".into()),
        ParsedState::Working(detail) => ("working".into(), detail.clone()),
        ParsedState::PendingTool { label, readonly, long_runner } => {
            if *readonly {
                return ("running_tool".into(), format!("Running: {label}"), );
            }
            if *long_runner {
                let detail = if age_secs > LONG_TOOL_HINT_SECS {
                    format!("Running: {label} · {} (or awaiting approval)", fmt_age(age_secs))
                } else {
                    format!("Running: {label}")
                };
                return ("running_tool".into(), detail);
            }
            if age_secs > STALE_TOOL_SECS {
                ("permission".into(), format!("Permission needed: {label}"))
            } else {
                ("running_tool".into(), format!("Running: {label}"))
            }
        }
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

#[cfg(test)]
mod tests {
    use super::*;

    // Line shapes distilled from real 2.1.x transcripts (see module docs).
    fn asst_tool(name: &str) -> String {
        format!(
            r#"{{"type":"assistant","message":{{"role":"assistant","stop_reason":"tool_use","content":[{{"type":"tool_use","name":"{name}","input":{{}}}}]}}}}"#
        )
    }
    const ASST_END_TURN: &str = r#"{"type":"assistant","message":{"role":"assistant","stop_reason":"end_turn","content":[{"type":"text","text":"done."}]}}"#;
    const ASST_TEXT_MIDTURN: &str = r#"{"type":"assistant","message":{"role":"assistant","stop_reason":"tool_use","content":[{"type":"text","text":"Let me check."}]}}"#;
    const USER_PROMPT: &str = r#"{"type":"user","message":{"role":"user","content":"fix the bug please"}}"#;
    const USER_TOOL_RESULT: &str = r#"{"type":"user","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"toolu_1","content":"ok"}]},"toolUseResult":{}}"#;
    const META_TAIL: &str = concat!(
        "{\"type\":\"attachment\",\"attachment\":{\"type\":\"skill_listing\"}}\n",
        "{\"type\":\"last-prompt\",\"lastPrompt\":\"x\"}\n",
        "{\"type\":\"ai-title\",\"aiTitle\":\"t\"}\n",
        "{\"type\":\"mode\",\"mode\":\"default\"}\n",
        "{\"type\":\"queue-operation\",\"operation\":\"enqueue\"}\n",
    );
    const SIDECHAIN_TOOL: &str = r#"{"type":"assistant","isSidechain":true,"message":{"role":"assistant","stop_reason":"tool_use","content":[{"type":"tool_use","name":"Bash","input":{}}]}}"#;

    fn status_of(tail: &str, age: u64, alive: Option<bool>) -> (String, String) {
        let (state, _) = parse_transcript_content(tail);
        finalize(&state, age, alive)
    }

    #[test]
    fn metadata_lines_after_end_turn_still_read_awaiting_user() {
        // The reported bug class: the physical last line is bookkeeping, so
        // the old last-line-only logic said "idle" for a session that just
        // finished its turn.
        let tail = format!("{USER_PROMPT}\n{ASST_END_TURN}\n{META_TAIL}");
        let (status, _) = status_of(&tail, 30, Some(true));
        assert_eq!(status, "awaiting_user");
    }

    #[test]
    fn metadata_lines_after_tool_use_still_read_running() {
        let tail = format!("{}\n{META_TAIL}", asst_tool("Bash"));
        let (status, detail) = status_of(&tail, 5, Some(true));
        assert_eq!(status, "running_tool");
        assert!(detail.contains("Bash"));
    }

    #[test]
    fn long_running_bash_never_flips_to_permission() {
        // A build/test running 5 minutes must not read "NEEDS YOU".
        let tail = asst_tool("Bash");
        let (status, detail) = status_of(&tail, 300, Some(true));
        assert_eq!(status, "running_tool");
        assert!(detail.contains("awaiting approval"), "past the hint window the detail mentions the possibility: {detail}");
        let (status, detail) = status_of(&tail, 30, Some(true));
        assert_eq!(status, "running_tool");
        assert!(!detail.contains("approval"), "quiet-but-short stays a plain Running: {detail}");
    }

    #[test]
    fn quick_tool_stale_means_permission_prompt() {
        // Edit completes in seconds once approved — 20s of silence is a
        // prompt sitting on screen.
        let tail = asst_tool("Edit");
        assert_eq!(status_of(&tail, 20, Some(true)).0, "permission");
        assert_eq!(status_of(&tail, 5, Some(true)).0, "running_tool");
    }

    #[test]
    fn readonly_tools_never_prompt() {
        for t in ["Read", "Grep", "Glob"] {
            let tail = asst_tool(t);
            let (status, _) = status_of(&tail, 120, Some(true));
            assert_eq!(status, "running_tool", "{t} is auto-approved");
        }
    }

    #[test]
    fn dead_process_cannot_run_or_prompt() {
        // Session killed mid-tool used to show "Permission needed" for the
        // whole 24h window.
        let tail = asst_tool("Edit");
        let (status, detail) = status_of(&tail, 120, Some(false));
        assert_eq!(status, "idle");
        assert!(detail.contains("ended"));
        // ...and a closed session doesn't pulse "awaiting your reply".
        assert_eq!(status_of(ASST_END_TURN, 30, Some(false)).0, "idle");
    }

    #[test]
    fn registry_unavailable_fails_open() {
        let tail = asst_tool("Edit");
        assert_eq!(status_of(&tail, 20, None).0, "permission");
        assert_eq!(status_of(ASST_END_TURN, 30, None).0, "awaiting_user");
    }

    #[test]
    fn tool_result_envelope_is_working() {
        // tool results arrive as type=user with a tool_result block, NOT a
        // top-level type=tool_result.
        let tail = format!("{}\n{USER_TOOL_RESULT}", asst_tool("Bash"));
        let (status, detail) = status_of(&tail, 3, Some(true));
        assert_eq!(status, "working");
        assert!(detail.contains("Tool finished"));
    }

    #[test]
    fn real_user_prompt_is_working() {
        assert_eq!(status_of(USER_PROMPT, 2, Some(true)).0, "working");
    }

    #[test]
    fn midturn_assistant_text_is_working() {
        // stop_reason=tool_use with no tool_use block on THIS line — the
        // thinking/text lines of a tool-calling turn.
        assert_eq!(status_of(ASST_TEXT_MIDTURN, 5, Some(true)).0, "working");
    }

    #[test]
    fn sidechain_traffic_does_not_speak_for_the_main_thread() {
        let tail = format!("{ASST_END_TURN}\n{SIDECHAIN_TOOL}");
        assert_eq!(status_of(&tail, 30, Some(true)).0, "awaiting_user");
    }

    #[test]
    fn idle_age_wins_over_everything() {
        assert_eq!(status_of(ASST_END_TURN, IDLE_SECS + 1, Some(true)).0, "idle");
    }

    #[test]
    fn empty_or_garbage_is_idle() {
        assert_eq!(status_of("", 5, Some(true)).0, "idle");
        assert_eq!(status_of("not json at all\n{\"type\":\"mode\"}", 5, Some(true)).0, "idle");
    }

    #[test]
    fn last_user_prompt_is_extracted_and_truncated() {
        let long = "x".repeat(100);
        let tail = format!(
            "{{\"type\":\"user\",\"message\":{{\"role\":\"user\",\"content\":\"{long}\"}}}}\n{ASST_END_TURN}"
        );
        let (_, last_user) = parse_transcript_content(&tail);
        let msg = last_user.expect("prompt found");
        assert!(msg.chars().count() <= 81);
        assert!(msg.ends_with('…'));
    }
}

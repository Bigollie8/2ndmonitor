//! Docker container listing. Uses the `docker` CLI rather than talking to the
//! engine pipe directly — no extra crates, no platform-specific transports,
//! and `docker ps --format '{{json .}}'` is a stable contract.
//!
//! The CLI may not be in PATH (Docker Desktop installs put it under
//! `Program Files\Docker\Docker\resources\bin`). We try the bare command first
//! and fall back to a couple of known install paths before reporting "not
//! installed" to the frontend.

use std::process::Command;

#[derive(serde::Serialize, Debug, Default)]
pub struct DockerContainer {
    pub id: String,
    pub names: String,
    pub image: String,
    pub status: String,
    pub state: String,
    pub ports: String,
    pub created: String,
}

#[derive(serde::Serialize)]
pub struct DockerResult {
    pub containers: Vec<DockerContainer>,
    /// Set when we couldn't reach Docker — frontend shows "Docker not running"
    /// or similar instead of an empty list.
    pub error: Option<String>,
}

#[tauri::command]
pub async fn docker_list_containers() -> Result<DockerResult, String> {
    tokio::task::spawn_blocking(list_containers_blocking)
        .await
        .map_err(|e| format!("join error: {e}"))
}

fn list_containers_blocking() -> DockerResult {
    let candidates = [
        "docker",
        // Docker Desktop default install on Windows.
        r"C:\Program Files\Docker\Docker\resources\bin\docker.exe",
    ];
    let mut last_err: Option<String> = None;
    for cmd in &candidates {
        match Command::new(cmd)
            .args(["ps", "-a", "--format", "{{json .}}"])
            .output()
        {
            Ok(out) if out.status.success() => {
                let text = String::from_utf8_lossy(&out.stdout);
                let mut containers: Vec<DockerContainer> = Vec::new();
                for line in text.lines() {
                    let line = line.trim();
                    if line.is_empty() {
                        continue;
                    }
                    if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(line) {
                        let str_field = |k: &str| -> String {
                            parsed.get(k).and_then(|v| v.as_str()).unwrap_or("").to_string()
                        };
                        containers.push(DockerContainer {
                            id: str_field("ID"),
                            names: str_field("Names"),
                            image: str_field("Image"),
                            status: str_field("Status"),
                            state: str_field("State"),
                            ports: str_field("Ports"),
                            created: str_field("CreatedAt"),
                        });
                    }
                }
                return DockerResult { containers, error: None };
            }
            Ok(out) => {
                let stderr = String::from_utf8_lossy(&out.stderr);
                last_err = Some(if stderr.contains("Cannot connect to the Docker daemon") {
                    "Docker daemon not running".to_string()
                } else {
                    stderr.lines().next().unwrap_or("docker ps failed").to_string()
                });
            }
            Err(e) => {
                last_err = Some(format!("docker not found: {e}"));
            }
        }
    }
    DockerResult {
        containers: Vec::new(),
        error: Some(last_err.unwrap_or_else(|| "docker unavailable".to_string())),
    }
}

use nvml_wrapper::{enum_wrappers::device::TemperatureSensor, Nvml};
use parking_lot::Mutex;
use serde::Serialize;
use std::{sync::Arc, thread, time::Duration};
use sysinfo::{
    CpuRefreshKind, MemoryRefreshKind, Networks, ProcessRefreshKind, RefreshKind, System,
};
use tauri::{AppHandle, Emitter, Manager, Runtime};

// Bytes/sec throughput at which the network sparkline saturates to 1.0.
// 50 MB/s is the rough ceiling for gigabit Ethernet's user-visible payload.
const NET_SPARKLINE_CAP: f64 = 50.0 * 1024.0 * 1024.0;

#[derive(Debug, Clone, Serialize)]
pub struct TopProcess {
    pub name: String,
    pub cpu: f32,
}

#[derive(Debug, Clone, Serialize)]
pub struct AppMetrics {
    /// CPU% used by THIS app's process tree. 0..N where N can exceed 100 on multi-core.
    pub cpu: f32,
    /// Resident memory in MB across the app's process tree.
    pub ram_mb: f32,
    /// GPU utilization% for this app via NVML process-util sampling.
    /// None when NVML unavailable (AMD/Intel) or no recent samples for our PIDs.
    pub gpu: Option<f32>,
}

#[derive(Debug, Clone, Serialize)]
pub struct SysmonSample {
    pub cpu: f32,
    pub ram: f32,
    pub gpu: f32,
    pub net: f32,
    pub cpu_pct_text: String,
    pub ram_text: String,
    pub gpu_pct_text: String,
    pub net_text: String,
    pub cpu_sub: String,
    pub ram_sub: String,
    pub gpu_sub: String,
    pub net_sub: String,
    pub top: Vec<TopProcess>,
    /// This app's own resource usage — surfaced in the bottom status bar so the
    /// user can see its impact at a glance. None on rare boot races.
    pub app: Option<AppMetrics>,
}

struct State {
    sys: System,
    networks: Networks,
    nvml: Option<Nvml>,
    /// Microsecond timestamp of the last NVML process-util sample we processed.
    /// Used to ask NVML only for samples newer than this on each tick.
    last_gpu_sample_ts: u64,
}

pub fn spawn<R: Runtime>(app: AppHandle<R>) {
    let sys = System::new_with_specifics(
        RefreshKind::new()
            .with_cpu(CpuRefreshKind::everything())
            .with_memory(MemoryRefreshKind::everything())
            .with_processes(ProcessRefreshKind::new().with_cpu()),
    );
    let networks = Networks::new_with_refreshed_list();

    // NVML init is best-effort — non-NVIDIA systems just won't have it. The UI
    // gracefully shows "n/a" in that case.
    let nvml = match Nvml::init() {
        Ok(n) => Some(n),
        Err(e) => {
            eprintln!("NVML unavailable, GPU metrics disabled: {e}");
            None
        }
    };

    let state = Arc::new(Mutex::new(State { sys, networks, nvml, last_gpu_sample_ts: 0 }));

    // Prime CPU readings — sysinfo needs two refreshes to compute deltas.
    {
        let mut s = state.lock();
        s.sys.refresh_cpu_all();
    }
    thread::sleep(Duration::from_millis(200));
    {
        let mut s = state.lock();
        s.sys.refresh_cpu_all();
        s.networks.refresh();
    }

    thread::spawn(move || loop {
        thread::sleep(Duration::from_secs(1));
        let sample = collect(&state);
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.emit("sysmon:tick", &sample);
        } else {
            let _ = app.emit("sysmon:tick", &sample);
        }
    });
}

fn collect(state: &Arc<Mutex<State>>) -> SysmonSample {
    let mut s = state.lock();

    // ── CPU ─────────────────────────────────────────────────────────────────
    s.sys.refresh_cpu_all();
    s.sys.refresh_memory();
    // `false` skips per-task (thread) refresh which is a real cost on Windows
    // and we don't display thread info anywhere.
    s.sys.refresh_processes(sysinfo::ProcessesToUpdate::All, false);

    let cpu_pct = s.sys.global_cpu_usage();
    let cpu_norm = (cpu_pct / 100.0).clamp(0.0, 1.0);
    let cpu_brand = s
        .sys
        .cpus()
        .first()
        .map(|c| c.brand().to_string())
        .unwrap_or_default();
    let cpu_freq_ghz = s
        .sys
        .cpus()
        .first()
        .map(|c| c.frequency() as f64 / 1000.0)
        .unwrap_or(0.0);

    // ── RAM ─────────────────────────────────────────────────────────────────
    let total_mem = s.sys.total_memory().max(1) as f64;
    let used_mem = s.sys.used_memory() as f64;
    let ram_pct = (used_mem / total_mem) as f32;
    let ram_norm = ram_pct.clamp(0.0, 1.0);
    let used_gb = used_mem / 1024.0 / 1024.0 / 1024.0;
    let total_gb = total_mem / 1024.0 / 1024.0 / 1024.0;

    // ── Top processes + this app's own metrics ────────────────────────────
    // Tauri spawns WebView2 helper processes (renderer, GPU, audio) — the
    // visualizer GPU work happens in a child process, not our main exe.
    // Walk the descendant tree so the perf tracker reflects the *full* app cost.
    let our_pid = sysinfo::Pid::from_u32(std::process::id());
    let our_pids: Vec<sysinfo::Pid> = collect_descendants(&s.sys, our_pid);
    let mut app_cpu = 0.0f32;
    let mut app_ram_bytes: u64 = 0;
    for pid in &our_pids {
        if let Some(p) = s.sys.process(*pid) {
            app_cpu += p.cpu_usage();
            app_ram_bytes += p.memory();
        }
    }

    // GPU per-process via NVML. Sums sm_util across our PIDs since the last
    // tick. NVML returns u32 percentages; multiple samples per PID are averaged.
    let mut last_ts = s.last_gpu_sample_ts;
    let app_gpu = sample_app_gpu(s.nvml.as_ref(), &our_pids, &mut last_ts);
    s.last_gpu_sample_ts = last_ts;

    let app_metrics = if our_pids.is_empty() {
        None
    } else {
        Some(AppMetrics {
            cpu: app_cpu,
            ram_mb: (app_ram_bytes as f64 / 1024.0 / 1024.0) as f32,
            gpu: app_gpu,
        })
    };
    let mut procs: Vec<(String, f32)> = s
        .sys
        .processes()
        .values()
        .map(|p| (p.name().to_string_lossy().into_owned(), p.cpu_usage()))
        .collect();
    procs.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
    let top: Vec<TopProcess> = procs
        .into_iter()
        .take(4)
        .map(|(name, cpu)| TopProcess { name, cpu })
        .collect();

    // ── GPU (NVIDIA via NVML, best-effort) ──────────────────────────────────
    let (gpu_norm, gpu_pct_text, gpu_sub) = sample_gpu(s.nvml.as_ref());

    // ── Net (sysinfo Networks, summed across interfaces) ────────────────────
    s.networks.refresh();
    let mut down_bps: u64 = 0;
    let mut up_bps: u64 = 0;
    for (_, data) in s.networks.iter() {
        // refresh() reports bytes since the previous refresh; with a 1s
        // cadence this is bytes/sec.
        down_bps = down_bps.saturating_add(data.received());
        up_bps = up_bps.saturating_add(data.transmitted());
    }
    let net_total = down_bps + up_bps;
    let net_norm = (net_total as f64 / NET_SPARKLINE_CAP).clamp(0.0, 1.0) as f32;
    let net_text = format!("↓{}", fmt_bytes_rate(down_bps));
    let net_sub = format!("↑{} · all interfaces", fmt_bytes_rate(up_bps));

    SysmonSample {
        cpu: cpu_norm,
        ram: ram_norm,
        gpu: gpu_norm,
        net: net_norm,
        cpu_pct_text: format!("{:.0}%", cpu_pct),
        ram_text: format!("{:.1}G", used_gb),
        gpu_pct_text,
        net_text,
        cpu_sub: format!("{:.1} GHz · {}", cpu_freq_ghz, cpu_brand),
        ram_sub: format!("{:.0}% of {:.0} GB", ram_pct * 100.0, total_gb),
        gpu_sub,
        net_sub,
        top,
        app: app_metrics,
    }
}

/// Walks the process table to find all descendants of `root` (inclusive).
/// Used to attribute WebView2 helper CPU/RAM/GPU to our app.
fn collect_descendants(sys: &System, root: sysinfo::Pid) -> Vec<sysinfo::Pid> {
    let mut out = Vec::with_capacity(8);
    let mut stack = vec![root];
    while let Some(parent) = stack.pop() {
        if !out.contains(&parent) {
            out.push(parent);
        }
        for (pid, p) in sys.processes() {
            if p.parent() == Some(parent) && !out.contains(pid) {
                stack.push(*pid);
            }
        }
    }
    out
}

/// Returns the summed GPU utilization (in %) across our PIDs since the previous
/// tick. None when NVML isn't available or no samples were returned. Updates
/// `last_ts` so the next call only sees fresh samples.
fn sample_app_gpu(
    nvml: Option<&Nvml>,
    our_pids: &[sysinfo::Pid],
    last_ts: &mut u64,
) -> Option<f32> {
    let nvml = nvml?;
    let device = nvml.device_by_index(0).ok()?;
    let samples = device.process_utilization_stats(*last_ts).ok()?;

    // Track the max sample timestamp so the next call asks for newer samples only.
    let mut max_ts = *last_ts;
    let mut total: f64 = 0.0;
    let mut count: u32 = 0;
    let pid_set: std::collections::HashSet<u32> = our_pids.iter().map(|p| p.as_u32()).collect();
    for s in samples {
        if s.timestamp > max_ts {
            max_ts = s.timestamp;
        }
        if pid_set.contains(&s.pid) {
            total += s.sm_util as f64;
            count += 1;
        }
    }
    *last_ts = max_ts;

    if count == 0 {
        // No fresh samples for our pids in this window. Could mean GPU work
        // happened but is older than this tick — or simply nothing yet.
        // Return Some(0.0) rather than None when NVML *is* working; that way
        // the UI shows "0%" instead of "—".
        return Some(0.0);
    }
    // Cap at 100% — multiple WebView2 children can each report up to 100% sm_util.
    Some((total / count as f64).clamp(0.0, 100.0) as f32)
}

fn sample_gpu(nvml: Option<&Nvml>) -> (f32, String, String) {
    let Some(nvml) = nvml else {
        return (0.0, "n/a".into(), "no NVIDIA GPU".into());
    };
    let Ok(device) = nvml.device_by_index(0) else {
        return (0.0, "n/a".into(), "device 0 unavailable".into());
    };
    let util = match device.utilization_rates() {
        Ok(u) => u,
        Err(e) => return (0.0, "n/a".into(), format!("util: {e}")),
    };
    let mem = device.memory_info().ok();
    let temp = device.temperature(TemperatureSensor::Gpu).ok();
    let name = device.name().unwrap_or_else(|_| "GPU".into());

    let pct = util.gpu as f32;
    let norm = (pct / 100.0).clamp(0.0, 1.0);
    let pct_text = format!("{}%", pct as u32);
    let sub = match (mem, temp) {
        (Some(m), Some(t)) => format!(
            "{:.1}G · {}°C · {}",
            m.used as f64 / 1024.0 / 1024.0 / 1024.0,
            t,
            name
        ),
        (Some(m), None) => format!(
            "{:.1}G · {}",
            m.used as f64 / 1024.0 / 1024.0 / 1024.0,
            name
        ),
        (None, Some(t)) => format!("{}°C · {}", t, name),
        (None, None) => name,
    };
    (norm, pct_text, sub)
}

fn fmt_bytes_rate(b: u64) -> String {
    let bf = b as f64;
    if bf >= 1024.0 * 1024.0 {
        format!("{:.1} MB/s", bf / 1024.0 / 1024.0)
    } else if bf >= 1024.0 {
        format!("{:.0} KB/s", bf / 1024.0)
    } else {
        format!("{} B/s", b)
    }
}

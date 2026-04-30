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
    /// CPU% used by THIS app's process. 0..N where N can exceed 100 on multi-core.
    pub cpu: f32,
    /// Resident memory in MB.
    pub ram_mb: f32,
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

    let state = Arc::new(Mutex::new(State { sys, networks, nvml }));

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
    s.sys.refresh_processes(sysinfo::ProcessesToUpdate::All, true);

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
    let our_pid = sysinfo::Pid::from_u32(std::process::id());
    let app_metrics = s.sys.process(our_pid).map(|p| AppMetrics {
        cpu: p.cpu_usage(),
        ram_mb: (p.memory() as f64 / 1024.0 / 1024.0) as f32,
    });
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

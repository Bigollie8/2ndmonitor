//! Per-part system temperatures for the sysmon tile (spec §3, v0.6.6).
//!
//! Reader 1 (preferred): LibreHardwareMonitor / OpenHardwareMonitor publish a
//! `Sensor` WMI class in their own namespace while they run; we query all
//! Temperature sensors and reduce them to canonical parts.
//! Reader 2 (fallback): the NVML GPU temp (already sampled by sysmon.rs) plus
//! the ACPI thermal zone (`root\WMI`, decikelvin) where the board exposes it.
//!
//! Threading: `sample()` is called from the sysmon sampler thread — a
//! dedicated `thread::spawn` loop in sysmon.rs — never from a Tauri command or
//! the main thread, so the blocking WMI round-trip cannot freeze the UI
//! (the 0.6.3 freeze class). A 5 s cache keeps the 1 Hz tick cheap.

// The WMI readers only exist on Windows; without them the reduction helpers
// have no non-test callers, which would otherwise warn on the macOS branch.
#![cfg_attr(not(windows), allow(dead_code))]

use serde::Serialize;

/// One canonical part temperature, ready for the frontend chip strip.
/// Serde style matches `SysmonSample`: derive Serialize, snake_case fields.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct TempReading {
    pub label: String,
    pub celsius: f32,
}

/// A raw temperature sensor row, decoupled from the `wmi` crate types so the
/// reduction logic is pure and unit-testable on any OS.
#[derive(Debug, Clone)]
pub struct SensorRow {
    pub name: String,
    pub value: f32,
    pub parent: String,
}

/// Reduces the raw LHM/OHM temperature sensor list to canonical parts —
/// CPU package, GPU core, motherboard, one entry per NVMe/SSD — in that
/// order. Sensors that map to no canonical part are dropped; missing parts
/// are simply omitted (the frontend renders whatever is present).
pub fn reduce_sensors(all: &[SensorRow]) -> Vec<TempReading> {
    // Plausibility gate first: dead sensors report 0 and glitched ones report
    // absurd values; filtering up front keeps them out of the max()/numbering
    // logic below.
    let rows: Vec<SensorRow> = all
        .iter()
        .filter(|r| r.value > 0.5 && r.value < 120.0)
        .cloned()
        .collect();

    let mut out: Vec<TempReading> = Vec::new();

    // ── CPU package ────────────────────────────────────────────────────────
    // Prefer the explicit package sensor ("CPU Package" on Intel,
    // "Core (Tctl/Tdie)" on AMD); fall back to the hottest CPU-parented one.
    let cpu_rows: Vec<&SensorRow> = rows
        .iter()
        .filter(|r| r.parent.contains("/amdcpu/") || r.parent.contains("/intelcpu/"))
        .collect();
    let cpu = cpu_rows
        .iter()
        .find(|r| r.name.contains("CPU Package") || r.name.contains("Tctl/Tdie"))
        .copied()
        .or_else(|| cpu_rows.iter().copied().max_by(|a, b| a.value.total_cmp(&b.value)));
    if let Some(r) = cpu {
        out.push(TempReading { label: "CPU".into(), celsius: r.value });
    }

    // ── GPU core ───────────────────────────────────────────────────────────
    // LHM names the die sensor "GPU Core" under /gpu-nvidia/N, /gpu-amd/N or
    // /gpu-intel/N. If a variant renames it, fall back to the first
    // GPU-parented sensor.
    let gpu = rows
        .iter()
        .find(|r| r.name.contains("GPU Core"))
        .or_else(|| rows.iter().find(|r| r.parent.contains("/gpu")));
    if let Some(r) = gpu {
        out.push(TempReading { label: "GPU".into(), celsius: r.value });
    }

    // ── Motherboard ────────────────────────────────────────────────────────
    // Board temps come from the SuperIO chip (parent /lpc/<chip>/N) or a
    // /motherboard node. Prefer a sensor actually named for the board.
    let board_rows: Vec<&SensorRow> = rows
        .iter()
        .filter(|r| r.parent.contains("/lpc/") || r.parent.contains("/motherboard"))
        .collect();
    let board = board_rows
        .iter()
        .find(|r| r.name.contains("Motherboard") || r.name.contains("System"))
        .copied()
        .or_else(|| board_rows.first().copied());
    if let Some(r) = board {
        out.push(TempReading { label: "Board".into(), celsius: r.value });
    }

    // ── Drives: one entry per distinct /nvme/N or /hdd/N parent ────────────
    let mut seen_parents: Vec<&str> = Vec::new();
    for r in &rows {
        let is_nvme = r.parent.contains("/nvme/");
        if !is_nvme && !r.parent.contains("/hdd/") {
            continue;
        }
        if seen_parents.contains(&r.parent.as_str()) {
            continue; // extra sensors on the same drive ("Temperature 1/2…")
        }
        seen_parents.push(&r.parent);
        let base = if is_nvme { "NVMe" } else { "SSD" };
        let existing = out.iter().filter(|t| t.label.starts_with(base)).count();
        let label = if existing == 0 {
            base.to_string()
        } else {
            format!("{base} {}", existing + 1)
        };
        out.push(TempReading { label, celsius: r.value });
    }

    out
}

/// `MSAcpi_ThermalZoneTemperature.CurrentTemperature` reports decikelvin.
pub fn acpi_to_celsius(deci_kelvin: u32) -> f32 {
    deci_kelvin as f32 / 10.0 - 273.15
}

#[cfg(test)]
mod tests {
    use super::*;

    fn row(name: &str, value: f32, parent: &str) -> SensorRow {
        SensorRow { name: name.into(), value, parent: parent.into() }
    }

    #[test]
    fn reduces_full_intel_system_to_canonical_parts() {
        let rows = vec![
            row("Core #1", 52.0, "/intelcpu/0"),
            row("Core #2", 54.0, "/intelcpu/0"),
            row("CPU Package", 58.0, "/intelcpu/0"),
            row("GPU Core", 64.0, "/gpu-nvidia/0"),
            row("GPU Hot Spot", 76.0, "/gpu-nvidia/0"),
            row("System", 41.0, "/lpc/nct6797d/0"),
            row("Temperature", 47.0, "/nvme/0"),
        ];
        let got = reduce_sensors(&rows);
        assert_eq!(got, vec![
            TempReading { label: "CPU".into(), celsius: 58.0 },
            TempReading { label: "GPU".into(), celsius: 64.0 },
            TempReading { label: "Board".into(), celsius: 41.0 },
            TempReading { label: "NVMe".into(), celsius: 47.0 },
        ]);
    }

    #[test]
    fn amd_prefers_tctl_tdie_package_sensor() {
        let rows = vec![
            row("CCD1 (Tdie)", 55.0, "/amdcpu/0"),
            row("Core (Tctl/Tdie)", 61.5, "/amdcpu/0"),
        ];
        assert_eq!(
            reduce_sensors(&rows),
            vec![TempReading { label: "CPU".into(), celsius: 61.5 }]
        );
    }

    #[test]
    fn cpu_without_package_sensor_uses_hottest_cpu_sensor() {
        let rows = vec![
            row("Core #1", 48.0, "/intelcpu/0"),
            row("Core #2", 53.0, "/intelcpu/0"),
        ];
        assert_eq!(
            reduce_sensors(&rows),
            vec![TempReading { label: "CPU".into(), celsius: 53.0 }]
        );
    }

    #[test]
    fn numbers_multiple_drives_and_dedupes_per_drive_sensors() {
        let rows = vec![
            row("Temperature", 47.0, "/nvme/0"),
            row("Temperature 2", 51.0, "/nvme/0"), // same drive → ignored
            row("Temperature", 39.0, "/nvme/1"),
            row("Temperature", 33.0, "/hdd/0"),
        ];
        assert_eq!(reduce_sensors(&rows), vec![
            TempReading { label: "NVMe".into(), celsius: 47.0 },
            TempReading { label: "NVMe 2".into(), celsius: 39.0 },
            TempReading { label: "SSD".into(), celsius: 33.0 },
        ]);
    }

    #[test]
    fn drops_implausible_values_and_unmapped_parents() {
        let rows = vec![
            row("CPU Package", 0.0, "/intelcpu/0"), // dead sensor reads 0
            row("Temperature", 200.0, "/nvme/0"),   // glitched
            row("Ambient", 24.0, "/somechip/7"),    // parent maps to no part
        ];
        assert_eq!(reduce_sensors(&rows), Vec::<TempReading>::new());
    }

    #[test]
    fn empty_input_gives_empty_output() {
        assert_eq!(reduce_sensors(&[]), Vec::<TempReading>::new());
    }

    #[test]
    fn acpi_decikelvin_converts_to_celsius() {
        let c = acpi_to_celsius(3032); // 303.2 K
        assert!((c - 30.05).abs() < 0.01, "got {c}");
    }
}

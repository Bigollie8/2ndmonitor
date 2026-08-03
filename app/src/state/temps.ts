// Pure helpers for the sysmon temps strip (spec §3, v0.6.6). Kept out of
// tiles.tsx so they run under node:test (tiles.tsx pulls in React/DOM).

import { formatTemp, type TempUnit } from './units';

/** Mirrors Rust `temps::TempReading` on the `sysmon:tick` payload. */
export interface TempReading { label: string; celsius: number }

export interface TempChip { label: string; text: string; color: string }

// Repo palette (data.ts amber accent, standard status red).
export const TEMP_OK_COLOR = 'rgba(255,255,255,0.7)';
export const TEMP_WARN_COLOR = '#fbbf24'; // amber — above 85 °C
export const TEMP_HOT_COLOR = '#ef4444';  // red — above 95 °C

export function tempColor(celsius: number): string {
  if (celsius > 95) return TEMP_HOT_COLOR;
  if (celsius > 85) return TEMP_WARN_COLOR;
  return TEMP_OK_COLOR;
}

/** Payload → renderable chips. null/absent payload → empty list (no strip).
 *  `unit` is the resolved display unit (0.7.2 §3) — payload is always °C, and
 *  the warn/hot thresholds keep judging the raw °C value. NOTE: sysmon's
 *  cpu_sub/gpu_sub strings stay °C (Rust-preformatted, string on the wire). */
export function tempsToChips(temps: TempReading[] | null | undefined, unit: TempUnit = 'c'): TempChip[] {
  if (!temps) return [];
  return temps.map((t) => ({
    label: t.label,
    text: `${t.label} ${formatTemp(t.celsius, 'c', unit)}`,
    color: tempColor(t.celsius),
  }));
}

/**
 * Strip tooltip. Only when the GPU is the sole reading (NVML fallback, no
 * LibreHardwareMonitor) do we hint how to unlock the rest. No banner.
 */
export function tempsTooltip(chips: TempChip[]): string | undefined {
  if (chips.length === 1 && chips[0]!.label === 'GPU') {
    return 'Run LibreHardwareMonitor to see CPU, board and drive temps';
  }
  return undefined;
}

// ─────────────────────────────────────────────────────────────────────────────
// Pure temperature-unit helpers (0.7.2 §3). No React, no Tauri — node-testable
// with explicit locales. Sibling of dateTime.ts; the tiles thread the resolved
// unit through props (see App.tsx).
// ─────────────────────────────────────────────────────────────────────────────

/** Persisted tweak value. 'system' resolves via the locale region. */
export type TempUnitSetting = 'system' | 'f' | 'c';
/** A resolved, concrete unit. */
export type TempUnit = 'f' | 'c';

/** Regions that use Fahrenheit day-to-day (per CLDR measurement data: the US
 *  and its territories, a few Caribbean/Pacific states, Liberia, Myanmar). */
const FAHRENHEIT_REGIONS = new Set([
  'US', 'AS', 'GU', 'MP', 'PR', 'UM', 'VI',
  'BS', 'BZ', 'KY', 'PW', 'FM', 'MH', 'LR', 'MM',
]);

/** 'system' → °F for Fahrenheit regions, °C everywhere else. Explicit 'f'/'c'
 *  pass through. `locale` defaults to the browser locale; tests pass it. */
export function resolveTempUnit(setting: TempUnitSetting, locale?: string): TempUnit {
  if (setting === 'f' || setting === 'c') return setting;
  const tag = locale ?? (typeof navigator !== 'undefined' ? navigator.language : 'en-US');
  try {
    const region = new Intl.Locale(tag).maximize().region;
    return region !== undefined && FAHRENHEIT_REGIONS.has(region) ? 'f' : 'c';
  } catch {
    return 'c';
  }
}

export function cToF(celsius: number): number { return celsius * 9 / 5 + 32; }
export function fToC(fahrenheit: number): number { return (fahrenheit - 32) * 5 / 9; }

export function convertTemp(value: number, from: TempUnit, to: TempUnit): number {
  if (from === to) return value;
  return from === 'c' ? cToF(value) : fToC(value);
}

/** Rounded display string with the proper suffix: formatTemp(72, 'f', 'c') →
 *  "22°C". `from` names the wire unit (weather payload °F, sysmon temps °C). */
export function formatTemp(value: number, from: TempUnit, to: TempUnit): string {
  return `${Math.round(convertTemp(value, from, to))}°${to === 'f' ? 'F' : 'C'}`;
}

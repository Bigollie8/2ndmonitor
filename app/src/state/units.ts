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

// ─────────────────────────────────────────────────────────────────────────────
// Wind speed (0.8.1). Same shape as the temperature helpers above: the weather
// payload's wire unit is mph (`wind_speed_unit=mph` in weather.rs's query), and
// the display unit is resolved from a tweak.
// ─────────────────────────────────────────────────────────────────────────────

/** Persisted tweak value. 'system' resolves via the locale region. */
export type WindUnitSetting = 'system' | 'mph' | 'kph';
/** A resolved, concrete unit. */
export type WindUnit = 'mph' | 'kph';

/** Regions that report wind in mph day-to-day: the US and its territories,
 *  plus the UK, which uses mph for wind and road speed while otherwise being
 *  metric — which is exactly why this is a separate set from
 *  FAHRENHEIT_REGIONS rather than a reuse of it. */
const MPH_REGIONS = new Set([
  'US', 'AS', 'GU', 'MP', 'PR', 'UM', 'VI', 'GB',
]);

/** 'system' → mph for mph regions, km/h everywhere else. Explicit values pass
 *  through. `locale` defaults to the browser locale; tests pass it. */
export function resolveWindUnit(setting: WindUnitSetting, locale?: string): WindUnit {
  if (setting === 'mph' || setting === 'kph') return setting;
  const tag = locale ?? (typeof navigator !== 'undefined' ? navigator.language : 'en-US');
  try {
    const region = new Intl.Locale(tag).maximize().region;
    return region !== undefined && MPH_REGIONS.has(region) ? 'mph' : 'kph';
  } catch {
    return 'kph';
  }
}

export function mphToKph(mph: number): number { return mph * 1.609344; }
export function kphToMph(kph: number): number { return kph / 1.609344; }

export function convertWind(value: number, from: WindUnit, to: WindUnit): number {
  if (from === to) return value;
  return from === 'mph' ? mphToKph(value) : kphToMph(value);
}

/** Rounded display string with the conventional suffix: formatWind(12, 'mph',
 *  'kph') → "19 km/h". Converts BEFORE rounding, so each unit's display is
 *  independently correct rather than a rounded value converted again. */
export function formatWind(value: number, from: WindUnit, to: WindUnit): string {
  return `${Math.round(convertWind(value, from, to))} ${to === 'mph' ? 'mph' : 'km/h'}`;
}

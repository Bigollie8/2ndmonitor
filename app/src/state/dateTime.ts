// ─────────────────────────────────────────────────────────────────────────────
// Pure format helpers for the Date & time tile (0.7.1 §4). No React, no Tauri
// — node-testable with fixed timestamps, explicit locales, and forced
// timezones. The tile itself lives in components/DateTimeTile.tsx.
// ─────────────────────────────────────────────────────────────────────────────

/** True when `locale` (default: the system locale) prefers a 12-hour clock.
 *  Reads Intl's resolved options rather than guessing from region strings. */
export function systemHour12(locale?: string): boolean {
  return new Intl.DateTimeFormat(locale, { hour: 'numeric' }).resolvedOptions().hour12 ?? false;
}

export interface ClockFormatOptions {
  hour12: boolean;
  seconds?: boolean;
  /** Tests pass explicit locales; the tile omits it (system locale). */
  locale?: string;
  /** Tests pass 'UTC' so assertions don't depend on the machine timezone. */
  timeZone?: string;
}

/** "14:05", "14:05:09", "2:05 PM" — hour12 decides the cycle. */
export function formatClock(ts: number, opts: ClockFormatOptions): string {
  return new Intl.DateTimeFormat(opts.locale, {
    hour: 'numeric',
    minute: '2-digit',
    ...(opts.seconds ? { second: '2-digit' as const } : {}),
    hour12: opts.hour12,
    ...(opts.timeZone ? { timeZone: opts.timeZone } : {}),
  }).format(ts);
}

/** Full date line, e.g. "Monday, August 3" (locale-shaped). */
export function formatDateLine(ts: number, locale?: string, timeZone?: string): string {
  return new Intl.DateTimeFormat(locale, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    ...(timeZone ? { timeZone } : {}),
  }).format(ts);
}

/** Persisted tweak for the platform-wide clock format (0.7.2 §3). */
export type ClockFormatSetting = 'system' | '12h' | '24h';

/** Resolve the tweak to a concrete hour12 flag. 'system' defers to the OS
 *  locale via systemHour12(). Tests pass explicit locales. */
export function resolveHour12(clockFormat: ClockFormatSetting, locale?: string): boolean {
  if (clockFormat === '12h') return true;
  if (clockFormat === '24h') return false;
  return systemHour12(locale);
}

/** formatClock, split for two-tone clock renders (forecast tile keeps its
 *  big hh:mm + small accent :ss layout): the hour:minute body and the day
 *  period ("PM"), null in 24-hour mode. */
export interface ClockParts { hm: string; dayPeriod: string | null }

export function formatClockParts(ts: number, opts: ClockFormatOptions): ClockParts {
  const parts = new Intl.DateTimeFormat(opts.locale, {
    hour: 'numeric',
    minute: '2-digit',
    hour12: opts.hour12,
    ...(opts.timeZone ? { timeZone: opts.timeZone } : {}),
  }).formatToParts(ts);
  const dayPeriod = parts.find((p) => p.type === 'dayPeriod')?.value ?? null;
  const hm = parts.filter((p) => p.type !== 'dayPeriod').map((p) => p.value).join('').trim();
  return { hm, dayPeriod };
}

/** Compact hourly-strip label from a raw 0-23 hour. 12h mode matches the
 *  Rust-preformatted shape shipped since 0.5 ("8p", "12a"); 24h zero-pads. */
export function formatHourLabel(hour: number, hour12: boolean): string {
  if (!hour12) return String(hour).padStart(2, '0');
  const suffix = hour >= 12 ? 'p' : 'a';
  return `${((hour + 11) % 12) + 1}${suffix}`;
}

/** Instance config for the dateTime tile. `style` shipped in 0.7.1 as a
 *  forward-compat field; 0.7.2 §4 widens it to three real styles. */
export type DateTimeStyle = 'digital' | 'minimal' | 'analog';

/** Cycle order for the hover style button. */
export const DATE_TIME_STYLES: DateTimeStyle[] = ['digital', 'minimal', 'analog'];

export interface DateTimeConfig {
  style: DateTimeStyle;
  seconds: boolean;
}

/** Parse a persisted `instance.config` blob. Malformed fields fall back
 *  independently (unknown style → 'digital', keeping a valid `seconds`).
 *  Same parse-with-fallback pattern as parseMapView / parseRadarConfig. */
export function parseDateTimeConfig(raw: unknown): DateTimeConfig {
  const fallback: DateTimeConfig = { style: 'digital', seconds: false };
  if (!raw || typeof raw !== 'object') return fallback;
  const c = raw as { style?: unknown; seconds?: unknown };
  const style: DateTimeStyle =
    c.style === 'minimal' || c.style === 'analog' ? c.style : 'digital';
  return { style, seconds: c.seconds === true };
}

export interface HandAngles { hour: number; minute: number; second: number }

/** Analog-clock hand angles in degrees clockwise from 12 o'clock:
 *  hour 30°/h + 0.5°/min, minute 6°/min + 0.1°/s, second 6°/s.
 *  `timeZone` for tests (same convention as formatClock). */
export function handAngles(ts: number, timeZone?: string): HandAngles {
  const parts = new Intl.DateTimeFormat('en-US', {
    hour: 'numeric', minute: 'numeric', second: 'numeric',
    hourCycle: 'h23',
    ...(timeZone ? { timeZone } : {}),
  }).formatToParts(ts);
  const num = (type: 'hour' | 'minute' | 'second'): number =>
    Number(parts.find((p) => p.type === type)?.value ?? '0');
  const h = num('hour') % 12;
  const m = num('minute');
  const s = num('second');
  return { hour: h * 30 + m * 0.5, minute: m * 6 + s * 0.1, second: s * 6 };
}

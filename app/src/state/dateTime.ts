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

/** Instance config for the dateTime tile. `style` exists from day one so a
 *  future analog clock is a config value, not a migration. */
export interface DateTimeConfig {
  style: 'digital';
  seconds: boolean;
}

/** Parse a persisted `instance.config` blob. Anything malformed → defaults.
 *  Same parse-with-fallback pattern as parseMapView in components/map/
 *  mapConfig.ts. */
export function parseDateTimeConfig(raw: unknown): DateTimeConfig {
  const fallback: DateTimeConfig = { style: 'digital', seconds: false };
  if (!raw || typeof raw !== 'object') return fallback;
  const c = raw as { style?: unknown; seconds?: unknown };
  if (c.style !== undefined && c.style !== 'digital') return fallback;
  return { style: 'digital', seconds: c.seconds === true };
}

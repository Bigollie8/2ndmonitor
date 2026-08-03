import { useEffect, useState } from 'react';
import { HFTile } from './tiles';
import type { Density } from '../types';
import { type Weather, useWeather } from '../state/tauri';
import { redactLocation } from '../state/streamer';
import { formatClockParts, formatHourLabel } from '../state/dateTime';
import { formatTemp, type TempUnit } from '../state/units';

export function NowAndForecastTile({ density, accent, accent2, streamer = false, hour12, tempUnit }: {
  density: Density; accent: string; accent2: string; streamer?: boolean;
  /** Resolved platform clock format (0.7.2 §3) — resolveHour12 in App. */
  hour12: boolean;
  /** Resolved platform temperature unit — resolveTempUnit in App. */
  tempUnit: TempUnit;
}) {
  const weather = useWeather();
  const [time, setTime] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  const clock = formatClockParts(time.getTime(), { hour12 });
  const ss = String(time.getSeconds()).padStart(2, '0');
  const dateLabel = time.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });

  const grad = bgFor(weather, accent, accent2);

  return (
    <HFTile
      title="Now & forecast"
      density={density}
      headRight={
        <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)' }}>
          {redactLocation(weather?.location ?? 'Knoxville, TN', streamer)}
        </span>
      }
      style={{ height: '100%' }}
    >
      <div style={{
        position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
        background: grad,
        overflow: 'hidden',
      }}>
        {/* TOP — clock + current conditions */}
        <div style={{ flex: '0 0 auto', display: 'flex', padding: '14px 14px 6px', gap: 14, minHeight: 0 }}>
          {/* Left: time + date */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', minWidth: 0 }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
                <span style={{
                  fontSize: 52, fontWeight: 700,
                  fontFamily: '"JetBrains Mono", ui-monospace, monospace',
                  letterSpacing: '-0.04em', lineHeight: 0.9, color: '#fff',
                }}>{clock.hm}</span>
                <span style={{
                  fontSize: 22, fontWeight: 500,
                  fontFamily: '"JetBrains Mono", ui-monospace, monospace',
                  color: accent, lineHeight: 1,
                }}>:{ss}</span>
                {clock.dayPeriod && (
                  <span style={{
                    fontSize: 15, fontWeight: 600, lineHeight: 1,
                    color: 'rgba(255,255,255,0.55)',
                  }}>{clock.dayPeriod}</span>
                )}
              </div>
              <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.6)', marginTop: 6 }}>
                {dateLabel} · Week {weekNumber(time)}
              </div>
            </div>
            {weather && (
              <div style={{
                display: 'grid', gridTemplateColumns: 'repeat(2, auto)', gap: '4px 14px',
                fontSize: 10.5, color: 'rgba(255,255,255,0.65)',
              }}>
                <Stat icon="☀" label="rise" value={weather.sunrise} />
                <Stat icon="☾" label="set"  value={weather.sunset} />
                <Stat icon="◐" label="hum"  value={`${weather.humidity}%`} />
                <Stat icon="≋" label="wind" value={`${Math.round(weather.wind_mph)} mph`} />
              </div>
            )}
          </div>

          {/* Right: current temp + icon + label */}
          <div style={{
            flex: '0 0 auto', display: 'flex', flexDirection: 'column',
            alignItems: 'flex-end', justifyContent: 'space-between',
          }}>
            {weather ? (
              <>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
                  <span style={{ fontSize: 56, lineHeight: 1 }}>{weather.current_icon}</span>
                  <span style={{
                    fontSize: 64, fontWeight: 700, color: '#fff',
                    fontFamily: '"JetBrains Mono", ui-monospace, monospace',
                    lineHeight: 0.9, letterSpacing: '-0.04em',
                  }}>
                    {formatTemp(weather.current_temp_f, 'f', tempUnit)}
                  </span>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 13, color: '#fff', fontWeight: 500 }}>{weather.current_label}</div>
                  <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.55)' }}>
                    feels {formatTemp(weather.feels_like_f, 'f', tempUnit)}
                  </div>
                </div>
              </>
            ) : (
              <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)' }}>Loading forecast…</span>
            )}
          </div>
        </div>

        {/* MIDDLE — hourly strip (next 12 hours) fills what used to be dead space */}
        <div style={{
          flex: 1, minHeight: 0, display: 'flex',
          padding: '4px 12px',
          gap: 0,
          alignItems: 'stretch',
          borderTop: '1px solid rgba(255,255,255,0.05)',
          borderBottom: '1px solid rgba(255,255,255,0.08)',
          background: 'rgba(0,0,0,0.12)',
          overflow: 'hidden',
        }}>
          {(weather?.hourly ?? Array.from({ length: 12 }, () => null)).slice(0, 12).map((h, i) => (
            <HourlyCell key={i} hour={h} accent={accent2} isNow={i === 0} hour12={hour12} tempUnit={tempUnit} />
          ))}
        </div>

        {/* BOTTOM — 7-day forecast strip */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${weather?.forecast.length ?? 7}, 1fr)`,
          background: 'rgba(0,0,0,0.18)',
          flexShrink: 0,
        }}>
          {(weather?.forecast ?? Array.from({ length: 7 }, () => null)).map((d, i) => (
            <ForecastDay key={i} day={d} accent={accent} isFirst={i === 0} tempUnit={tempUnit} />
          ))}
        </div>
      </div>
    </HFTile>
  );
}

function HourlyCell({
  hour, accent, isNow, hour12, tempUnit,
}: {
  hour: import('../state/tauri').HourForecast | null;
  accent: string;
  isNow: boolean;
  hour12: boolean;
  tempUnit: TempUnit;
}) {
  const showRain = (hour?.precip_pct ?? 0) >= 20;
  return (
    <div style={{
      flex: 1,
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'space-between',
      padding: '6px 4px', gap: 2, minWidth: 0,
      borderLeft: 'none',
      background: isNow ? `${accent}10` : 'transparent',
      position: 'relative',
    }}>
      <span style={{
        fontSize: 9, fontWeight: 600,
        color: isNow ? accent : 'rgba(255,255,255,0.55)',
        textTransform: 'uppercase', letterSpacing: '.06em',
        fontFamily: '"JetBrains Mono", ui-monospace, monospace',
      }}>
        {isNow ? 'NOW' : hourLabelOf(hour, hour12)}
      </span>
      <span style={{ fontSize: 18, lineHeight: 1 }}>{hour?.icon ?? '·'}</span>
      <span style={{
        fontSize: 11, fontWeight: 700, color: '#fff',
        fontFamily: '"JetBrains Mono", ui-monospace, monospace',
      }}>{hour ? formatTemp(hour.temp_f, 'f', tempUnit) : '—'}</span>
      {showRain && hour && (
        <span style={{
          fontSize: 8, color: '#60a5fa',
          fontFamily: '"JetBrains Mono", ui-monospace, monospace',
        }}>{hour.precip_pct}%</span>
      )}
    </div>
  );
}

/** Hourly-strip label. `hour.hour` is the 0.7.2 additive raw hour — fall back
 *  to the Rust-preformatted 12h label when the payload predates it. */
function hourLabelOf(hour: import('../state/tauri').HourForecast | null, hour12: boolean): string {
  if (!hour) return '—';
  return typeof hour.hour === 'number' ? formatHourLabel(hour.hour, hour12) : hour.time;
}

function Stat({ icon, label, value }: { icon: string; label: string; value: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontFamily: '"JetBrains Mono", ui-monospace, monospace' }}>
      <span style={{ opacity: 0.7 }}>{icon}</span>
      <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: '.08em', minWidth: 28 }}>{label}</span>
      <span style={{ color: '#fff' }}>{value}</span>
    </div>
  );
}

function ForecastDay({
  day, accent, isFirst, tempUnit,
}: {
  day: import('../state/tauri').DayForecast | null;
  accent: string;
  isFirst: boolean;
  tempUnit: TempUnit;
}) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      padding: '10px 6px', gap: 4,
      borderLeft: isFirst ? 'none' : '1px solid rgba(255,255,255,0.04)',
      background: isFirst ? `${accent}12` : 'transparent',
    }}>
      <span style={{
        fontSize: 10, fontWeight: 600, color: isFirst ? accent : 'rgba(255,255,255,0.55)',
        textTransform: 'uppercase', letterSpacing: '.06em',
      }}>
        {day?.day_of_week ?? '—'}
      </span>
      <span style={{ fontSize: 22, lineHeight: 1 }}>{day?.icon ?? '·'}</span>
      <div style={{ display: 'flex', gap: 6, alignItems: 'baseline', fontFamily: '"JetBrains Mono", ui-monospace, monospace' }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: '#fff' }}>
          {day ? formatTemp(day.high_f, 'f', tempUnit) : '—'}
        </span>
        <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)' }}>
          {day ? formatTemp(day.low_f, 'f', tempUnit) : ''}
        </span>
      </div>
    </div>
  );
}

function weekNumber(d: Date): number {
  const onejan = new Date(d.getFullYear(), 0, 1);
  return Math.ceil(((d.getTime() - onejan.getTime()) / 86400000 + onejan.getDay() + 1) / 7);
}

/**
 * Background gradient picks up the dominant weather mood — sunny gets warm,
 * rainy gets cool blue, snow gets pale, etc. Falls back to the global accent
 * gradient when we don't have weather yet.
 */
function bgFor(weather: Weather | null, accent: string, accent2: string): string {
  if (!weather) {
    return `linear-gradient(135deg, ${accent}18, ${accent2}10), #0a0c11`;
  }
  const code = weather.current_code;
  // Sunny / clear
  if (code === 0 || code === 1) {
    return 'radial-gradient(ellipse at 80% 0%, rgba(251,191,36,0.18), transparent 55%), linear-gradient(135deg, #1a1814 0%, #0a0c11 60%)';
  }
  // Partly cloudy
  if (code === 2 || code === 3) {
    return 'radial-gradient(ellipse at 75% 10%, rgba(186,210,255,0.10), transparent 60%), linear-gradient(135deg, #131820 0%, #0a0c11 60%)';
  }
  // Fog
  if (code === 45 || code === 48) {
    return 'radial-gradient(ellipse at 50% 30%, rgba(180,180,180,0.13), transparent 70%), #11141a';
  }
  // Rain / showers
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) {
    return 'radial-gradient(ellipse at 60% 0%, rgba(96,165,250,0.18), transparent 55%), linear-gradient(135deg, #0e1722 0%, #0a0c11 60%)';
  }
  // Snow
  if (code >= 71 && code <= 86) {
    return 'radial-gradient(ellipse at 50% 0%, rgba(220,231,255,0.18), transparent 55%), linear-gradient(135deg, #131822 0%, #0a0c11 60%)';
  }
  // Thunderstorm
  if (code === 95 || code === 96 || code === 99) {
    return 'radial-gradient(ellipse at 70% 0%, rgba(167,139,250,0.22), transparent 55%), linear-gradient(135deg, #0c0e18 0%, #06070a 60%)';
  }
  return `linear-gradient(135deg, ${accent}18, ${accent2}10), #0a0c11`;
}

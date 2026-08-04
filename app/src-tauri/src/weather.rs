//! 7-day weather forecast via Open-Meteo (no API key required).
//! Polls every 30 minutes, emits a `weather:tick` event with current conditions
//! plus a daily forecast strip the frontend renders next to the clock.
//!
//! Location is dynamic — frontend can change it via `set_weather_location`.

use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use std::sync::{Arc, Condvar, Mutex as StdMutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager, Runtime, State};

const POLL_INTERVAL_SECS: u64 = 30 * 60;

/// First retry delay after a failed fetch, doubling per consecutive failure.
const RETRY_BASE_SECS: u64 = 30;
/// Ceiling for the retry backoff. Must stay below POLL_INTERVAL_SECS so a
/// failing endpoint is still retried more often than the healthy cadence.
const RETRY_MAX_SECS: u64 = 300;

/// Delay before the next attempt after `failures` consecutive errors:
/// 30/60/120/240 s, capped at 300 s. Mirrors usePoll's backoffDelay on the TS
/// side — before 0.7.3 this loop had no retry at all, so a single failed fetch
/// at launch left the forecast tile empty for the full 30-minute interval and
/// only an app refresh (which re-pushes the location) recovered it.
fn retry_delay_secs(failures: u32) -> u64 {
    // min(16) only guards the shift itself from overflowing; RETRY_MAX_SECS is
    // what actually caps the delay.
    let shifted = RETRY_BASE_SECS.saturating_mul(1u64 << failures.min(16));
    shifted.min(RETRY_MAX_SECS)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WeatherLocation {
    pub label: String,
    pub lat: f64,
    pub lon: f64,
}

impl Default for WeatherLocation {
    fn default() -> Self {
        Self { label: "Knoxville, TN".into(), lat: 35.9606, lon: -83.9207 }
    }
}

pub struct WeatherState {
    pub location: Mutex<WeatherLocation>,
    /// Last successful payload, replayed to a late-attaching frontend via
    /// `weather_current`. Tauri events have no replay, so a webview that
    /// finishes booting after the first emit would otherwise see nothing
    /// until the next poll (0.7.3).
    pub last: Mutex<Option<Weather>>,
    /// One-shot signaler — the poll loop refetches immediately when this flips.
    /// std Mutex (not parking_lot) because it pairs with `refetch_cv`: the
    /// worker blocks on the Condvar instead of polling the flag every 200 ms.
    pub refetch_now: StdMutex<bool>,
    pub refetch_cv: Condvar,
}

#[derive(Debug, Serialize, Clone)]
pub struct DayForecast {
    pub date: String,        // "2026-04-29"
    pub day_of_week: String, // "Mon"
    pub high_f: f32,
    pub low_f: f32,
    pub code: u32,
    pub icon: String,
    pub label: String,
}

#[derive(Debug, Serialize, Clone)]
pub struct HourForecast {
    pub time: String,       // "8p" / "12a"
    /// Raw 24-h hour (0-23), parsed from the same ISO timestamp as `time`.
    /// Additive in 0.7.2 so the UI can honor the clock-format setting.
    pub hour: u32,
    pub temp_f: f32,
    pub code: u32,
    pub icon: String,
    pub precip_pct: u32,    // chance of precipitation 0-100
}

#[derive(Debug, Serialize, Clone)]
pub struct Weather {
    pub current_temp_f: f32,
    pub feels_like_f: f32,
    pub current_code: u32,
    pub current_icon: String,
    pub current_label: String,
    pub humidity: u32,
    pub wind_mph: f32,
    pub sunrise: String,
    pub sunset: String,
    pub hourly: Vec<HourForecast>,
    pub forecast: Vec<DayForecast>,
    pub location: String,
}

#[derive(Deserialize)]
struct OpenMeteoResp {
    current: CurrentResp,
    hourly: HourlyResp,
    daily: DailyResp,
}

#[derive(Deserialize)]
struct CurrentResp {
    temperature_2m: f32,
    apparent_temperature: f32,
    weather_code: u32,
    relative_humidity_2m: f32,
    wind_speed_10m: f32,
}

#[derive(Deserialize)]
struct HourlyResp {
    time: Vec<String>,
    temperature_2m: Vec<f32>,
    weather_code: Vec<u32>,
    #[serde(default)]
    precipitation_probability: Vec<Option<u32>>,
}

#[derive(Deserialize)]
struct DailyResp {
    time: Vec<String>,
    temperature_2m_max: Vec<f32>,
    temperature_2m_min: Vec<f32>,
    weather_code: Vec<u32>,
    sunrise: Vec<String>,
    sunset: Vec<String>,
}

pub fn spawn<R: Runtime>(app: AppHandle<R>) {
    let state = Arc::new(WeatherState {
        location: Mutex::new(WeatherLocation::default()),
        last: Mutex::new(None),
        refetch_now: StdMutex::new(false),
        refetch_cv: Condvar::new(),
    });
    app.manage(state.clone());

    std::thread::spawn(move || {
        let mut failures: u32 = 0;
        loop {
            let loc = state.location.lock().clone();
            let wait_secs = match fetch(&loc) {
                Ok(w) => {
                    failures = 0;
                    // Cache before emitting: a webview that finishes booting
                    // after this emit replays it via `weather_current`.
                    *state.last.lock() = Some(w.clone());
                    let _ = app.emit("weather:tick", &w);
                    POLL_INTERVAL_SECS
                }
                Err(e) => {
                    eprintln!("weather: {e}");
                    let d = retry_delay_secs(failures);
                    failures = failures.saturating_add(1);
                    d
                }
            };
            // Sleep up to `wait_secs`, but wake early if `refetch_now` flips.
            // Condvar wait means zero wakeups while idle — the thread only
            // runs on notify (location change) or when the deadline passes.
            let deadline = Instant::now() + Duration::from_secs(wait_secs);
            let mut refetch = state
                .refetch_now
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            loop {
                if *refetch {
                    break;
                }
                let remaining = deadline.saturating_duration_since(Instant::now());
                if remaining.is_zero() {
                    break;
                }
                // Loop guards against spurious wakeups: re-check flag + deadline.
                let (guard, _timed_out) = state
                    .refetch_cv
                    .wait_timeout(refetch, remaining)
                    .unwrap_or_else(|poisoned| poisoned.into_inner());
                refetch = guard;
            }
            // A manual refetch (location change) resets the backoff: the user
            // asked for this one, so don't make them wait out a stale penalty.
            if *refetch {
                failures = 0;
            }
            *refetch = false;
        }
    });
}

#[tauri::command]
pub fn set_weather_location<R: Runtime>(
    _app: AppHandle<R>,
    state: State<'_, Arc<WeatherState>>,
    label: String, lat: f64, lon: f64,
) -> Result<(), String> {
    *state.location.lock() = WeatherLocation { label, lat, lon };
    *state
        .refetch_now
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner()) = true;
    state.refetch_cv.notify_one();
    Ok(())
}

/// Last successful forecast, or None if none has landed yet. Lets a freshly
/// mounted frontend paint immediately instead of waiting for the next tick —
/// `weather:tick` is fire-and-forget, so an emit that beats the listener
/// registration is lost outright (0.7.3).
#[tauri::command]
pub fn weather_current(state: State<'_, Arc<WeatherState>>) -> Option<Weather> {
    state.last.lock().clone()
}

fn fetch(loc: &WeatherLocation) -> Result<Weather, String> {
    let url = format!(
        "https://api.open-meteo.com/v1/forecast\
        ?latitude={lat}&longitude={lon}\
        &daily=temperature_2m_max,temperature_2m_min,weather_code,sunrise,sunset\
        &hourly=temperature_2m,weather_code,precipitation_probability\
        &current=temperature_2m,apparent_temperature,weather_code,relative_humidity_2m,wind_speed_10m\
        &temperature_unit=fahrenheit&wind_speed_unit=mph\
        &timezone=auto&forecast_days=7&forecast_hours=12&past_hours=0",
        lat = loc.lat,
        lon = loc.lon
    );
    let resp: OpenMeteoResp = ureq::get(&url)
        .timeout(Duration::from_secs(10))
        .call()
        .map_err(|e| e.to_string())?
        .into_json()
        .map_err(|e| e.to_string())?;

    let forecast: Vec<DayForecast> = resp
        .daily
        .time
        .iter()
        .enumerate()
        .map(|(i, date)| {
            let code = *resp.daily.weather_code.get(i).unwrap_or(&0);
            DayForecast {
                date: date.clone(),
                day_of_week: day_of_week_label(date),
                high_f: *resp.daily.temperature_2m_max.get(i).unwrap_or(&0.0),
                low_f: *resp.daily.temperature_2m_min.get(i).unwrap_or(&0.0),
                code,
                icon: weather_icon(code).into(),
                label: weather_label(code).into(),
            }
        })
        .collect();

    let hourly: Vec<HourForecast> = resp
        .hourly
        .time
        .iter()
        .enumerate()
        .map(|(i, ts)| {
            let code = *resp.hourly.weather_code.get(i).unwrap_or(&0);
            HourForecast {
                time: format_hour_label(ts),
                hour: parse_hour(ts).unwrap_or(0),
                temp_f: *resp.hourly.temperature_2m.get(i).unwrap_or(&0.0),
                code,
                icon: weather_icon(code).into(),
                precip_pct: resp.hourly.precipitation_probability.get(i).and_then(|o| *o).unwrap_or(0),
            }
        })
        .collect();

    Ok(Weather {
        current_temp_f: resp.current.temperature_2m,
        feels_like_f: resp.current.apparent_temperature,
        current_code: resp.current.weather_code,
        current_icon: weather_icon(resp.current.weather_code).into(),
        current_label: weather_label(resp.current.weather_code).into(),
        humidity: resp.current.relative_humidity_2m as u32,
        wind_mph: resp.current.wind_speed_10m,
        sunrise: format_clock(resp.daily.sunrise.first()),
        sunset: format_clock(resp.daily.sunset.first()),
        hourly,
        forecast,
        location: loc.label.clone(),
    })
}

/// "2026-04-29T20:00" → Some(20). The additive `hour` payload field (0.7.2)
/// and the legacy preformatted label both come from this one parse.
fn parse_hour(iso: &str) -> Option<u32> {
    iso.split('T').nth(1)?.split(':').next()?.parse::<u32>().ok()
}

/// "2026-04-29T20:00" → "8p"
fn format_hour_label(iso: &str) -> String {
    let Some(h) = parse_hour(iso) else { return iso.to_string() };
    let suffix = if h >= 12 { "p" } else { "a" };
    let h12 = ((h + 11) % 12) + 1;
    format!("{}{}", h12, suffix)
}

fn weather_icon(code: u32) -> &'static str {
    match code {
        0 => "☀",
        1 | 2 => "⛅",
        3 => "☁",
        45 | 48 => "🌫",
        51..=57 => "🌦",
        61 | 63 => "🌧",
        65 => "⛈",
        66 | 67 => "🌧",
        71..=77 => "❄",
        80..=82 => "🌧",
        85 | 86 => "🌨",
        95 => "⛈",
        96 | 99 => "⛈",
        _ => "•",
    }
}

fn weather_label(code: u32) -> &'static str {
    match code {
        0 => "Clear",
        1 => "Mainly clear",
        2 => "Partly cloudy",
        3 => "Overcast",
        45 | 48 => "Fog",
        51..=57 => "Drizzle",
        61 => "Light rain",
        63 => "Rain",
        65 => "Heavy rain",
        66 | 67 => "Freezing rain",
        71 => "Light snow",
        73 => "Snow",
        75 => "Heavy snow",
        77 => "Snow grains",
        80 => "Light showers",
        81 => "Showers",
        82 => "Heavy showers",
        85 | 86 => "Snow showers",
        95 => "Thunderstorm",
        96 | 99 => "Thunderstorm",
        _ => "—",
    }
}

/// "2026-04-29" → "Wed". Sakamoto's algorithm, no chrono dep.
fn day_of_week_label(iso: &str) -> String {
    let mut parts = iso.split('-');
    let y: i32 = parts.next().and_then(|s| s.parse().ok()).unwrap_or(2026);
    let m: u32 = parts.next().and_then(|s| s.parse().ok()).unwrap_or(1);
    let d: u32 = parts.next().and_then(|s| s.parse().ok()).unwrap_or(1);
    static T: [i64; 12] = [0, 3, 2, 5, 0, 3, 5, 1, 4, 6, 2, 4];
    let yy = if m < 3 { (y - 1) as i64 } else { y as i64 };
    let mm = m as usize;
    let dd = d as i64;
    let dow = ((yy + yy / 4 - yy / 100 + yy / 400 + T[mm - 1] + dd) % 7) as usize;
    ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][dow].into()
}

/// "2026-04-29T06:42" → "6:42a"
fn format_clock(iso: Option<&String>) -> String {
    let Some(s) = iso else { return String::new() };
    let Some(t) = s.split('T').nth(1) else { return s.clone() };
    let mut hm = t.split(':');
    let Some(h_str) = hm.next() else { return t.into() };
    let Some(m_str) = hm.next() else { return t.into() };
    let Ok(h) = h_str.parse::<u32>() else { return t.into() };
    let suffix = if h >= 12 { "p" } else { "a" };
    let h12 = ((h + 11) % 12) + 1;
    format!("{}:{}{}", h12, m_str, suffix)
}

#[cfg(test)]
mod tests {
    use super::{format_hour_label, parse_hour, retry_delay_secs, POLL_INTERVAL_SECS};

    #[test]
    fn retry_delay_backs_off_then_caps() {
        assert_eq!(retry_delay_secs(0), 30);
        assert_eq!(retry_delay_secs(1), 60);
        assert_eq!(retry_delay_secs(2), 120);
        assert_eq!(retry_delay_secs(3), 240);
        // capped — a permanently dead endpoint is retried at a civilised rate
        assert_eq!(retry_delay_secs(4), 300);
        assert_eq!(retry_delay_secs(50), 300);
        // and never longer than the normal poll interval
        assert!(retry_delay_secs(50) < POLL_INTERVAL_SECS);
    }

    #[test]
    fn parse_hour_reads_the_iso_hour() {
        assert_eq!(parse_hour("2026-04-29T20:00"), Some(20));
        assert_eq!(parse_hour("2026-04-29T00:00"), Some(0));
        assert_eq!(parse_hour("2026-04-29T12:00"), Some(12));
        assert_eq!(parse_hour("garbage"), None);
    }

    #[test]
    fn format_hour_label_matches_the_shipped_shape() {
        assert_eq!(format_hour_label("2026-04-29T20:00"), "8p");
        assert_eq!(format_hour_label("2026-04-29T00:00"), "12a");
        assert_eq!(format_hour_label("2026-04-29T12:00"), "12p");
        assert_eq!(format_hour_label("garbage"), "garbage");
    }
}

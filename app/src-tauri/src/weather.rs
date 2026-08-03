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
        refetch_now: StdMutex::new(false),
        refetch_cv: Condvar::new(),
    });
    app.manage(state.clone());

    std::thread::spawn(move || loop {
        let loc = state.location.lock().clone();
        match fetch(&loc) {
            Ok(w) => {
                let _ = app.emit("weather:tick", &w);
            }
            Err(e) => eprintln!("weather: {e}"),
        }
        // Sleep up to POLL_INTERVAL_SECS, but wake early if `refetch_now`
        // flips. Condvar wait means zero wakeups while idle — the thread only
        // runs on notify (location change) or when the 30-min deadline passes.
        let deadline = Instant::now() + Duration::from_secs(POLL_INTERVAL_SECS);
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
        *refetch = false;
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
    use super::{format_hour_label, parse_hour};

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

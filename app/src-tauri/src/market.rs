//! Backend proxies for tile data sources that don't ship browser-friendly CORS:
//! stocks (Yahoo Finance unofficial), tides (NOAA), and a generic GitHub fetch
//! used by the PRs tile. All run in a blocking Tauri command via `ureq` because
//! the latency budget is wide (these refresh on a minute-scale at fastest).

use serde::Serialize;

/// Yahoo Finance quote summary, condensed to what the tile renders. Yahoo's
/// `chart` endpoint is the only public quote source that doesn't require an
/// API key and returns a stable JSON shape, so we tolerate the minor schema
/// risk in exchange for zero-config setup.
#[derive(Serialize, Debug)]
pub struct StockQuote {
    pub symbol: String,
    /// Latest reported price, or `None` if the symbol resolved but no quote.
    pub price: Option<f64>,
    /// Previous regular-session close — used to compute %change.
    pub prev_close: Option<f64>,
    /// Currency code, e.g. "USD". Useful for non-US tickers.
    pub currency: Option<String>,
    /// Short display name from Yahoo (e.g. "Apple Inc.").
    pub short_name: Option<String>,
    /// Marker so the tile can show "errored" tickers grey instead of blank.
    pub error: Option<String>,
}

#[tauri::command]
pub async fn fetch_stock_quotes(symbols: Vec<String>) -> Result<Vec<StockQuote>, String> {
    let cleaned: Vec<String> = symbols
        .iter()
        .map(|s| s.trim().to_uppercase())
        .filter(|s| !s.is_empty() && s.len() <= 16)
        .collect();
    if cleaned.is_empty() {
        return Ok(vec![]);
    }
    if cleaned.len() > 25 {
        return Err("too many symbols (max 25)".into());
    }

    let out: Vec<StockQuote> = tokio::task::spawn_blocking(move || {
        cleaned
            .into_iter()
            .map(|sym| fetch_one_quote(&sym))
            .collect()
    })
    .await
    .map_err(|e| format!("join error: {e}"))?;
    Ok(out)
}

fn fetch_one_quote(symbol: &str) -> StockQuote {
    let url = format!(
        "https://query1.finance.yahoo.com/v8/finance/chart/{}?interval=1d&range=2d",
        urlencoding::encode(symbol)
    );
    let resp = match ureq::get(&url)
        .set("User-Agent", "Mozilla/5.0 SecondMonitorHub/0.3")
        .timeout(std::time::Duration::from_secs(8))
        .call()
    {
        Ok(r) => r,
        Err(e) => {
            return StockQuote {
                symbol: symbol.to_string(),
                price: None, prev_close: None, currency: None, short_name: None,
                error: Some(format!("network: {e}")),
            };
        }
    };
    let json: serde_json::Value = match resp.into_json() {
        Ok(v) => v,
        Err(e) => {
            return StockQuote {
                symbol: symbol.to_string(),
                price: None, prev_close: None, currency: None, short_name: None,
                error: Some(format!("parse: {e}")),
            };
        }
    };
    let result = json
        .pointer("/chart/result/0")
        .cloned()
        .unwrap_or(serde_json::Value::Null);
    if result.is_null() {
        let err_msg = json
            .pointer("/chart/error/description")
            .and_then(|v| v.as_str())
            .unwrap_or("symbol not found");
        return StockQuote {
            symbol: symbol.to_string(),
            price: None, prev_close: None, currency: None, short_name: None,
            error: Some(err_msg.to_string()),
        };
    }
    let meta = result.get("meta").cloned().unwrap_or(serde_json::Value::Null);
    StockQuote {
        symbol: symbol.to_string(),
        price: meta.get("regularMarketPrice").and_then(|v| v.as_f64()),
        prev_close: meta.get("chartPreviousClose").and_then(|v| v.as_f64()),
        currency: meta.get("currency").and_then(|v| v.as_str()).map(|s| s.to_string()),
        short_name: meta.get("symbol").and_then(|v| v.as_str()).map(|s| s.to_string()),
        error: None,
    }
}

/// One tide event in NOAA's prediction series.
#[derive(Serialize, Debug)]
pub struct TideEvent {
    /// Local-time string as NOAA returns it: "2026-05-08 12:34".
    pub t: String,
    /// Height in feet (or whatever unit was requested — we always ask for feet).
    pub v: f64,
    /// "H" for high tide, "L" for low.
    pub kind: String,
}

#[derive(Serialize, Debug)]
pub struct TidePredictions {
    pub station_id: String,
    pub events: Vec<TideEvent>,
    pub error: Option<String>,
}

#[tauri::command]
pub async fn fetch_tide_predictions(station_id: String) -> Result<TidePredictions, String> {
    let trimmed = station_id.trim().to_string();
    if trimmed.is_empty() || trimmed.len() > 16 {
        return Err("invalid station id".into());
    }
    tokio::task::spawn_blocking(move || fetch_tides_blocking(&trimmed))
        .await
        .map_err(|e| format!("join error: {e}"))
}

fn fetch_tides_blocking(station_id: &str) -> TidePredictions {
    // NOAA "datagetter" API: high/low only, 48h window centered on today, feet.
    let url = format!(
        "https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?\
date=today&product=predictions&datum=MLLW&time_zone=lst_ldt&interval=hilo&\
units=english&format=json&station={station}&begin_date={begin}&range=48",
        station = urlencoding::encode(station_id),
        begin = chrono_now_yyyymmdd(),
    );
    let resp = match ureq::get(&url)
        .timeout(std::time::Duration::from_secs(8))
        .call()
    {
        Ok(r) => r,
        Err(e) => return TidePredictions {
            station_id: station_id.to_string(), events: vec![],
            error: Some(format!("network: {e}")),
        },
    };
    let json: serde_json::Value = match resp.into_json() {
        Ok(v) => v,
        Err(e) => return TidePredictions {
            station_id: station_id.to_string(), events: vec![],
            error: Some(format!("parse: {e}")),
        },
    };
    if let Some(err) = json.get("error").and_then(|v| v.get("message")).and_then(|v| v.as_str()) {
        return TidePredictions {
            station_id: station_id.to_string(), events: vec![],
            error: Some(err.to_string()),
        };
    }
    let predictions = json
        .get("predictions")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();
    let events: Vec<TideEvent> = predictions
        .iter()
        .filter_map(|p| {
            let t = p.get("t").and_then(|v| v.as_str())?.to_string();
            let v = p.get("v").and_then(|v| v.as_str())?.parse::<f64>().ok()?;
            let kind = p.get("type").and_then(|v| v.as_str()).unwrap_or("").to_string();
            Some(TideEvent { t, v, kind })
        })
        .collect();
    TidePredictions {
        station_id: station_id.to_string(), events, error: None,
    }
}

/// Tiny helper — we don't need a real chrono dep just for a 10-character date
/// string. Returns "YYYYMMDD" in the system's local time. NOAA's API treats
/// this as the start of the prediction window.
fn chrono_now_yyyymmdd() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let days = secs / 86400;
    // Civil-from-days algorithm — Howard Hinnant's date library reference impl.
    let z = days as i64 + 719468;
    let era = if z >= 0 { z } else { z - 146096 } / 146097;
    let doe = (z - era * 146097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = if m <= 2 { y + 1 } else { y };
    format!("{:04}{:02}{:02}", year, m, d)
}

/// Generic GitHub fetcher used by the PRs tile. Sends the user's PAT as a
/// Bearer token; no auth caching here — the front-end stores the PAT and
/// passes it on each request, which is fine for a single-user desktop app.
#[tauri::command]
pub async fn fetch_github_prs(token: String, query: String) -> Result<serde_json::Value, String> {
    if token.trim().is_empty() {
        return Err("missing GitHub token".into());
    }
    if query.trim().is_empty() {
        return Err("missing query".into());
    }
    tokio::task::spawn_blocking(move || {
        let url = format!(
            "https://api.github.com/search/issues?q={}&per_page=30",
            urlencoding::encode(&query)
        );
        let resp = ureq::get(&url)
            .set("Authorization", &format!("Bearer {}", token.trim()))
            .set("User-Agent", "SecondMonitorHub/0.3")
            .set("Accept", "application/vnd.github+json")
            .timeout(std::time::Duration::from_secs(10))
            .call()
            .map_err(|e| format!("network: {e}"))?;
        resp.into_json::<serde_json::Value>()
            .map_err(|e| format!("parse: {e}"))
    })
    .await
    .map_err(|e| format!("join error: {e}"))?
}

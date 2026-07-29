//! Manage child WebView2 webviews that render real web apps inside named tile rects.
//!
//! The frontend computes each tile's screen-space rect (after the 2560×1440 canvas
//! is `transform: scale()`'d to fit the viewport) and pushes it via `position_tile`.
//! Child webviews are real native rectangles — no rounded corners or CSS filters
//! apply, but they get full WebView2 (Discord, Linear, etc. all just work).

use tauri::{
    webview::WebviewBuilder, AppHandle, LogicalPosition, LogicalSize, Manager, Runtime, Url,
    WebviewUrl,
};

#[tauri::command]
pub async fn position_tile<R: Runtime>(
    app: AppHandle<R>,
    label: String,
    url: String,
    x: f64,
    y: f64,
    w: f64,
    h: f64,
) -> Result<(), String> {
    // Only real web origins may be mounted — reject javascript:, file:, data:,
    // tauri: etc. before the string ever reaches WebView2. The frontend passes
    // user-configured URLs here, so this is the trust boundary.
    let url = url.trim().to_string();
    let scheme_check = url.to_ascii_lowercase();
    if !scheme_check.starts_with("https://") && !scheme_check.starts_with("http://") {
        return Err(format!("refusing non-http(s) tile url: {url}"));
    }

    // Reposition existing webview if it's already mounted — the common path on
    // every resize / canvas-scale change.
    if let Some(existing) = app.webviews().get(&label) {
        existing
            .set_position(LogicalPosition::new(x, y))
            .map_err(|e| e.to_string())?;
        existing
            .set_size(LogicalSize::new(w, h))
            .map_err(|e| e.to_string())?;
        return Ok(());
    }

    // First mount — parse URL and add as a child of the main window.
    let parsed = Url::parse(&url).map_err(|e| e.to_string())?;
    let main = app
        .get_window("main")
        .ok_or_else(|| "main window not found".to_string())?;
    main.add_child(
        WebviewBuilder::new(label.clone(), WebviewUrl::External(parsed)),
        LogicalPosition::new(x, y),
        LogicalSize::new(w, h),
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn close_tile<R: Runtime>(app: AppHandle<R>, label: String) -> Result<(), String> {
    if let Some(webview) = app.webviews().get(&label) {
        webview.close().map_err(|e| e.to_string())?;
    }
    Ok(())
}

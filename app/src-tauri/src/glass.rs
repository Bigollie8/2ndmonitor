//! Liquid-glass window effect. `set_glass` applies or clears Windows acrylic
//! behind the (transparent) main window at runtime — no restart needed.
//!
//! Degradation contract: an OS refusal (battery saver, accessibility
//! settings, an older Windows build) must NEVER surface as an `Err` — the
//! command logs, returns `Ok(false)`, and the app simply shows "clear glass"
//! through the transparent window. Never a broken frame.
//!
//! Kept `async` on purpose: a sync `#[tauri::command]` runs on the main
//! thread, and blocking there is this repo's known UI-freeze bug class (the
//! 0.6.3 Content Library freeze). The DWM call itself is cheap, but async
//! costs nothing and keeps it off the main thread.

/// `tint_alpha` is 0.0–1.0. `enabled: false` OR a zero tint clears acrylic
/// entirely — strength 0 means "clear glass", not "acrylic with an invisible
/// tint" (spec: "Strength 0 = acrylic cleared = clear glass").
#[tauri::command]
pub async fn set_glass(
    window: tauri::WebviewWindow,
    enabled: bool,
    tint_alpha: f32,
) -> Result<bool, String> {
    #[cfg(windows)]
    {
        use window_vibrancy::{apply_acrylic, clear_acrylic};
        let alpha = (tint_alpha.clamp(0.0, 1.0) * 255.0).round() as u8;
        let result = if enabled && alpha > 0 {
            // Dark tint near the canvas base color rgb(6,7,10).
            apply_acrylic(&window, Some((10, 11, 14, alpha)))
        } else {
            clear_acrylic(&window)
        };
        match result {
            Ok(()) => Ok(true),
            Err(e) => {
                eprintln!("set_glass: acrylic unavailable, degrading to clear glass: {e}");
                Ok(false)
            }
        }
    }
    #[cfg(not(windows))]
    {
        let _ = (window, enabled, tint_alpha);
        Ok(false)
    }
}

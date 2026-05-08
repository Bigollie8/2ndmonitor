//! Stream Deck v2 action backends. All commands here are one-shot side-effects
//! invoked by Stream Deck buttons — no spawn(), no global state.

use std::process::Command;

#[cfg(windows)]
use windows::Win32::UI::Input::KeyboardAndMouse::{
    SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYEVENTF_KEYUP, VIRTUAL_KEY,
    VK_0, VK_1, VK_2, VK_3, VK_4, VK_5, VK_6, VK_7, VK_8, VK_9,
    VK_A, VK_B, VK_C, VK_D, VK_E, VK_F, VK_G, VK_H, VK_I, VK_J, VK_K, VK_L,
    VK_M, VK_N, VK_O, VK_P, VK_Q, VK_R, VK_S, VK_T, VK_U, VK_V, VK_W, VK_X,
    VK_Y, VK_Z,
    VK_F1, VK_F2, VK_F3, VK_F4, VK_F5, VK_F6, VK_F7, VK_F8, VK_F9, VK_F10,
    VK_F11, VK_F12,
    VK_BACK, VK_DELETE, VK_DOWN, VK_END, VK_ESCAPE, VK_HOME, VK_INSERT, VK_LEFT,
    VK_LWIN, VK_MENU, VK_NEXT, VK_PRIOR, VK_RETURN, VK_RIGHT, VK_SHIFT, VK_SPACE,
    VK_TAB, VK_UP, VK_CONTROL,
};

/// Open a URL in the user's default browser. http(s)/mailto only — no arbitrary
/// shell strings (avoids accidental command injection through the picker text
/// field).
#[tauri::command]
pub fn app_open_url(url: String) -> Result<(), String> {
    let trimmed = url.trim();
    if trimmed.is_empty() {
        return Err("empty URL".into());
    }
    let lower = trimmed.to_ascii_lowercase();
    if !(lower.starts_with("http://")
        || lower.starts_with("https://")
        || lower.starts_with("mailto:"))
    {
        return Err("URL must start with http://, https://, or mailto:".into());
    }
    #[cfg(windows)]
    {
        Command::new("cmd")
            .args(["/C", "start", "", trimmed])
            .spawn()
            .map_err(|e| format!("failed to launch browser: {e}"))?;
        return Ok(());
    }
    #[cfg(not(windows))]
    {
        let _ = Command::new("xdg-open").arg(trimmed).spawn();
        Ok(())
    }
}

/// Copy plain text to the system clipboard.
#[tauri::command]
pub fn app_copy_text(text: String) -> Result<(), String> {
    let mut clipboard = arboard::Clipboard::new()
        .map_err(|e| format!("clipboard unavailable: {e}"))?;
    clipboard
        .set_text(text)
        .map_err(|e| format!("clipboard set failed: {e}"))?;
    Ok(())
}

#[derive(serde::Deserialize)]
pub struct HotkeyArgs {
    #[serde(default)]
    pub ctrl: bool,
    #[serde(default)]
    pub shift: bool,
    #[serde(default)]
    pub alt: bool,
    #[serde(default)]
    pub meta: bool,
    /// Single token: A-Z, 0-9, F1-F12, or one of the named keys handled below.
    pub key: String,
}

/// Synthesize a global hotkey by injecting modifier + main-key down/up events.
/// Modifiers go down before the main key, and come back up in reverse order
/// (matches what real keyboards do, so applications that latch on key state
/// see a coherent sequence).
#[tauri::command]
pub fn app_send_hotkey(args: HotkeyArgs) -> Result<(), String> {
    #[cfg(windows)]
    {
        let main = parse_key(&args.key)?;
        let mut modifiers: Vec<VIRTUAL_KEY> = Vec::new();
        if args.ctrl { modifiers.push(VK_CONTROL); }
        if args.shift { modifiers.push(VK_SHIFT); }
        if args.alt { modifiers.push(VK_MENU); }
        if args.meta { modifiers.push(VK_LWIN); }

        let mut events: Vec<INPUT> = Vec::with_capacity(modifiers.len() * 2 + 2);
        for m in &modifiers {
            events.push(make_key_input(*m, false));
        }
        events.push(make_key_input(main, false));
        events.push(make_key_input(main, true));
        for m in modifiers.iter().rev() {
            events.push(make_key_input(*m, true));
        }

        let sent = unsafe { SendInput(&events, std::mem::size_of::<INPUT>() as i32) };
        if (sent as usize) != events.len() {
            return Err(format!("SendInput dispatched {sent}/{}", events.len()));
        }
        Ok(())
    }
    #[cfg(not(windows))]
    {
        let _ = args;
        Err("hotkey send only implemented on Windows".into())
    }
}

#[cfg(windows)]
fn make_key_input(vk: VIRTUAL_KEY, key_up: bool) -> INPUT {
    let mut flags = KEYEVENTF_KEYUP;
    if !key_up {
        flags = windows::Win32::UI::Input::KeyboardAndMouse::KEYBD_EVENT_FLAGS(0);
    }
    INPUT {
        r#type: INPUT_KEYBOARD,
        Anonymous: INPUT_0 {
            ki: KEYBDINPUT {
                wVk: vk,
                wScan: 0,
                dwFlags: flags,
                time: 0,
                dwExtraInfo: 0,
            },
        },
    }
}

#[cfg(windows)]
fn parse_key(s: &str) -> Result<VIRTUAL_KEY, String> {
    let upper = s.trim().to_ascii_uppercase();
    let vk = match upper.as_str() {
        "A" => VK_A, "B" => VK_B, "C" => VK_C, "D" => VK_D, "E" => VK_E,
        "F" => VK_F, "G" => VK_G, "H" => VK_H, "I" => VK_I, "J" => VK_J,
        "K" => VK_K, "L" => VK_L, "M" => VK_M, "N" => VK_N, "O" => VK_O,
        "P" => VK_P, "Q" => VK_Q, "R" => VK_R, "S" => VK_S, "T" => VK_T,
        "U" => VK_U, "V" => VK_V, "W" => VK_W, "X" => VK_X, "Y" => VK_Y,
        "Z" => VK_Z,
        "0" => VK_0, "1" => VK_1, "2" => VK_2, "3" => VK_3, "4" => VK_4,
        "5" => VK_5, "6" => VK_6, "7" => VK_7, "8" => VK_8, "9" => VK_9,
        "F1" => VK_F1, "F2" => VK_F2, "F3" => VK_F3, "F4" => VK_F4,
        "F5" => VK_F5, "F6" => VK_F6, "F7" => VK_F7, "F8" => VK_F8,
        "F9" => VK_F9, "F10" => VK_F10, "F11" => VK_F11, "F12" => VK_F12,
        "ENTER" | "RETURN" => VK_RETURN,
        "ESC" | "ESCAPE" => VK_ESCAPE,
        "TAB" => VK_TAB,
        "SPACE" => VK_SPACE,
        "BACKSPACE" | "BACK" => VK_BACK,
        "DELETE" | "DEL" => VK_DELETE,
        "INSERT" | "INS" => VK_INSERT,
        "HOME" => VK_HOME,
        "END" => VK_END,
        "PAGEUP" | "PGUP" => VK_PRIOR,
        "PAGEDOWN" | "PGDN" => VK_NEXT,
        "UP" => VK_UP,
        "DOWN" => VK_DOWN,
        "LEFT" => VK_LEFT,
        "RIGHT" => VK_RIGHT,
        _ => return Err(format!("unsupported key: {upper}")),
    };
    Ok(vk)
}

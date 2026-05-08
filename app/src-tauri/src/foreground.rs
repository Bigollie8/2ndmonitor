//! Foreground window tracking. Exposes a single command that returns the
//! current foreground app's executable name and window title. The frontend
//! polls this and accumulates a running time-per-app tally locally.

#[cfg(windows)]
use windows::Win32::{
    Foundation::{CloseHandle, HMODULE, HWND, MAX_PATH},
    System::ProcessStatus::GetModuleBaseNameW,
    System::Threading::{OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION, PROCESS_VM_READ},
    UI::WindowsAndMessaging::{GetForegroundWindow, GetWindowTextLengthW, GetWindowTextW, GetWindowThreadProcessId},
};

#[derive(serde::Serialize, Default)]
pub struct ForegroundInfo {
    /// Process executable name without path (e.g. "chrome.exe"). Empty when
    /// unavailable.
    pub process_name: String,
    /// Title of the foreground window. May be empty for some chromeless apps.
    pub window_title: String,
    /// PID of the foreground process — useful for the frontend to dedupe rapid
    /// title changes inside the same app (e.g., browser tab switches).
    pub pid: u32,
}

#[tauri::command]
pub fn foreground_get() -> ForegroundInfo {
    #[cfg(windows)]
    unsafe {
        let hwnd: HWND = GetForegroundWindow();
        if hwnd.is_invalid() {
            return ForegroundInfo::default();
        }
        // Window title.
        let len = GetWindowTextLengthW(hwnd) as usize;
        let mut title = String::new();
        if len > 0 {
            let mut buf = vec![0u16; len + 1];
            let copied = GetWindowTextW(hwnd, &mut buf) as usize;
            if copied > 0 {
                title = String::from_utf16_lossy(&buf[..copied]);
            }
        }

        // PID + process name.
        let mut pid: u32 = 0;
        GetWindowThreadProcessId(hwnd, Some(&mut pid));
        let process_name = if pid != 0 {
            process_name_for_pid(pid).unwrap_or_default()
        } else {
            String::new()
        };

        ForegroundInfo { process_name, window_title: title, pid }
    }
    #[cfg(not(windows))]
    {
        ForegroundInfo::default()
    }
}

#[cfg(windows)]
unsafe fn process_name_for_pid(pid: u32) -> Option<String> {
    let handle = OpenProcess(
        PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_VM_READ,
        false,
        pid,
    )
    .ok()?;
    let mut buf = vec![0u16; MAX_PATH as usize];
    let len = GetModuleBaseNameW(handle, HMODULE::default(), &mut buf);
    let _ = CloseHandle(handle);
    if len == 0 {
        return None;
    }
    Some(String::from_utf16_lossy(&buf[..len as usize]))
}

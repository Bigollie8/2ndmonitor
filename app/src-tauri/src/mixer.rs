//! Audio mixer — master volume, output-device picker, per-app sessions on
//! Windows; output-device picker only on macOS (see `macimpl` below for why
//! master volume and per-app sessions aren't there).
//!
//! On Windows, all COM work runs on a single apartment-threaded worker
//! thread. The frontend posts setter commands via a static mpsc Sender (kept
//! simple — these fire a few times per second at most, on slider drag).
//! After every applied command we re-emit a fresh `mixer:state` snapshot,
//! plus a steady 1 Hz heartbeat so external changes (Windows volume slider,
//! sessions appearing/disappearing) show up in the UI within a second. The
//! macOS worker mirrors this same command/snapshot loop (see `macimpl`) minus
//! the COM apartment dance, which Core Audio's `AudioObject*` calls don't need.
//!
//! `IPolicyConfig` (used to switch the default output device on Windows) is
//! undocumented but stable since Vista — same approach SoundSwitch /
//! EarTrumpet use. We call it via raw vtable indexing so we don't need to
//! declare the interface.

use parking_lot::{const_mutex, Mutex};
use serde::Serialize;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, Receiver, Sender};
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Runtime};

#[derive(Debug, Clone, Serialize)]
pub struct MasterState {
    pub volume: f32,
    pub mute: bool,
    pub device_id: String,
    pub device_name: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct OutputDevice {
    pub id: String,
    pub name: String,
    pub is_default: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct AppSession {
    pub pid: u32,
    pub name: String,
    pub volume: f32,
    pub mute: bool,
    pub is_system_sounds: bool,
    /// `data:image/png;base64,…` for the exe's shell icon, or null when not
    /// extractable (system-sounds session, vanished process, COM error).
    pub icon: Option<String>,
    /// Lowercased executable basename (e.g. `"spotify.exe"`), or `None` for
    /// the system-sounds session / when the process image path couldn't be
    /// resolved.
    pub exe: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct MixerSnapshot {
    pub master: Option<MasterState>,
    pub devices: Vec<OutputDevice>,
    pub sessions: Vec<AppSession>,
}

enum MixerCmd {
    SetMasterVolume(f32),
    SetMasterMute(bool),
    SetSessionVolume(u32, f32),
    SetSessionMute(u32, bool),
    SetDefaultOutput(String),
    Refresh,
}

static SENDER: Mutex<Option<Sender<MixerCmd>>> = const_mutex(None);

/// Gate for the 1 Hz snapshot loop. The COM device/session enumeration is the
/// expensive part of this module, so we only do it while a mixer tile is
/// actually mounted — the frontend flips this via `set_mixer_active`. Setter
/// commands (volume/mute/default-output) keep working regardless.
static MIXER_ACTIVE: AtomicBool = AtomicBool::new(false);

fn send(cmd: MixerCmd) {
    if let Some(tx) = SENDER.lock().as_ref() {
        let _ = tx.send(cmd);
    }
}

#[tauri::command]
pub fn mixer_set_master_volume(v: f32) {
    send(MixerCmd::SetMasterVolume(v.clamp(0.0, 1.0)));
}
#[tauri::command]
pub fn mixer_set_master_mute(m: bool) {
    send(MixerCmd::SetMasterMute(m));
}
#[tauri::command]
pub fn mixer_set_session_volume(pid: u32, v: f32) {
    send(MixerCmd::SetSessionVolume(pid, v.clamp(0.0, 1.0)));
}
#[tauri::command]
pub fn mixer_set_session_mute(pid: u32, m: bool) {
    send(MixerCmd::SetSessionMute(pid, m));
}
#[tauri::command]
pub fn mixer_set_default_output(device_id: String) {
    send(MixerCmd::SetDefaultOutput(device_id));
}
#[tauri::command]
pub fn mixer_refresh() {
    send(MixerCmd::Refresh);
}
#[tauri::command]
pub fn set_mixer_active(active: bool) {
    MIXER_ACTIVE.store(active, Ordering::Relaxed);
}

pub fn spawn<R: Runtime>(app: AppHandle<R>) {
    let (tx, rx) = mpsc::channel::<MixerCmd>();
    *SENDER.lock() = Some(tx);
    thread::spawn(move || {
        if let Err(e) = worker(app, rx) {
            eprintln!("mixer disabled: {e}");
        }
    });
}

#[cfg(not(any(target_os = "windows", target_os = "macos")))]
fn worker<R: Runtime>(_app: AppHandle<R>, _rx: Receiver<MixerCmd>) -> Result<(), String> {
    Ok(())
}

/// Same shape as the Windows worker above, minus the COM apartment dance —
/// Core Audio's `AudioObject*` calls need no per-thread initialization. Only
/// `SetDefaultOutput` is handled; master/session volume commands are no-ops
/// on macOS (no public per-app or master-volume API — see module docs), so
/// `MixerSnapshot.master` stays `None` and `.sessions` stays empty. The
/// frontend already renders that combination correctly (master row disabled,
/// no per-app rows, device rows populated).
#[cfg(target_os = "macos")]
fn worker<R: Runtime>(app: AppHandle<R>, rx: Receiver<MixerCmd>) -> Result<(), String> {
    loop {
        // Block up to 1 second for a setter; emit a snapshot either way —
        // mirrors the Windows loop's coalescing behaviour.
        let cmd = rx.recv_timeout(Duration::from_secs(1));
        if let Ok(c) = cmd {
            macimpl::apply_cmd(c);
            while let Ok(c) = rx.try_recv() {
                macimpl::apply_cmd(c);
            }
        }
        if !MIXER_ACTIVE.load(Ordering::Relaxed) {
            continue;
        }
        let snap = macimpl::capture().unwrap_or_else(|_| MixerSnapshot {
            master: None,
            devices: vec![],
            sessions: vec![],
        });
        let _ = app.emit("mixer:state", snap);
    }
}

#[cfg(target_os = "windows")]
fn worker<R: Runtime>(app: AppHandle<R>, rx: Receiver<MixerCmd>) -> Result<(), String> {
    use windows::Win32::System::Com::{CoInitializeEx, COINIT_APARTMENTTHREADED};
    unsafe {
        CoInitializeEx(None, COINIT_APARTMENTTHREADED)
            .ok()
            .map_err(|e| format!("CoInitializeEx: {e}"))?;
    }

    let enumerator =
        unsafe { winimpl::create_enumerator() }.map_err(|e| format!("MMDeviceEnumerator: {e}"))?;

    loop {
        // Block up to 1 second for a setter; emit a snapshot either way.
        let cmd = rx.recv_timeout(Duration::from_secs(1));
        if let Ok(c) = cmd {
            unsafe { winimpl::apply_cmd(&enumerator, c) };
            // Coalesce any other commands that piled up during slider drags.
            while let Ok(c) = rx.try_recv() {
                unsafe { winimpl::apply_cmd(&enumerator, c) };
            }
        }
        // No mixer tile mounted → skip the enumeration + emit entirely. The
        // 1 s recv_timeout above doubles as the idle sleep (and still services
        // setter commands), so when the flag flips back on, the very next
        // iteration produces a fresh snapshot within ~1 s.
        if !MIXER_ACTIVE.load(Ordering::Relaxed) {
            continue;
        }
        let snap = unsafe { winimpl::capture(&enumerator) }.unwrap_or_else(|_| MixerSnapshot {
            master: None,
            devices: vec![],
            sessions: vec![],
        });
        let _ = app.emit("mixer:state", snap);
    }
}

/// One-shot session snapshot for callers outside the mixer's own COM worker
/// (the audio supervisor and the source picker). Initializes COM on the
/// calling thread, enumerates, and tears down. Costs a few ms; called at most
/// once every 2 s by the reattach watcher.
#[cfg(target_os = "windows")]
pub fn sessions_snapshot() -> Result<Vec<AppSession>, String> {
    use windows::Win32::Foundation::RPC_E_CHANGED_MODE;
    use windows::Win32::System::Com::{CoInitializeEx, CoUninitialize, COINIT_MULTITHREADED};
    unsafe {
        let hr = CoInitializeEx(None, COINIT_MULTITHREADED);
        // RPC_E_CHANGED_MODE means this thread already has COM initialized in
        // a different apartment mode (e.g. this ends up called on the
        // mixer's own STA worker thread, see `worker()` above) — COM is
        // already usable here, but this call did NOT take out a reference, so
        // we must not pair it with CoUninitialize below. Any other failure
        // means COM genuinely isn't usable on this thread; skip enumeration.
        if hr.is_err() && hr != RPC_E_CHANGED_MODE {
            return Err(format!("CoInitializeEx: {}", hr.message()));
        }
        let result = (|| {
            let en = winimpl::create_enumerator().map_err(|e| e.to_string())?;
            let snap = winimpl::capture(&en).map_err(|e| e.to_string())?;
            Ok(snap.sessions)
        })();
        if hr.is_ok() {
            CoUninitialize();
        }
        result
    }
}

/// macOS is excluded rather than stubbed: it has a real inventory of its own
/// (`audio_process_apps` below), and both callers of this — the source picker
/// and `find_pid_for_exe` — go there instead, so a stub here would be dead code
/// that quietly answers "no apps" if anything ever reached it.
#[cfg(not(any(target_os = "windows", target_os = "macos")))]
pub fn sessions_snapshot() -> Result<Vec<AppSession>, String> { Ok(vec![]) }

/// Device id of the current default *render* endpoint (`eConsole` role) — the
/// one WASAPI loopback captures. The audio supervisor polls this to notice a
/// playback-device switch (including one made from the mixer tile's own
/// dropdown) and rebind its capture, since neither cpal nor the process
/// loopback client follows the default device on its own.
///
/// Deliberately much cheaper than [`sessions_snapshot`]: one enumerator plus
/// `GetDefaultAudioEndpoint` + `GetId`, no session walk, no per-process image
/// lookups. Same COM-apartment handling as `sessions_snapshot` — see the
/// `RPC_E_CHANGED_MODE` note there.
#[cfg(target_os = "windows")]
pub fn default_endpoint_id() -> Result<String, String> {
    use windows::Win32::Foundation::RPC_E_CHANGED_MODE;
    use windows::Win32::System::Com::{CoInitializeEx, CoUninitialize, COINIT_MULTITHREADED};
    unsafe {
        let hr = CoInitializeEx(None, COINIT_MULTITHREADED);
        if hr.is_err() && hr != RPC_E_CHANGED_MODE {
            return Err(format!("CoInitializeEx: {}", hr.message()));
        }
        let result = (|| {
            let en = winimpl::create_enumerator().map_err(|e| e.to_string())?;
            winimpl::default_endpoint_id(&en).map_err(|e| e.to_string())
        })();
        if hr.is_ok() {
            CoUninitialize();
        }
        result
    }
}

#[cfg(target_os = "macos")]
pub fn default_endpoint_id() -> Result<String, String> {
    // The device UID, NOT the numeric AudioObjectID (0.8.7). AudioObjectIDs
    // are transient handles — the HAL renumbers them on device sleep/wake,
    // Bluetooth reconnects and HDMI renegotiation, all of which happen
    // periodically on a real Mac. The supervisor compares this value every
    // 2 s to decide whether the default output "moved", and a renumbered
    // handle for the SAME device read as a move: full tap teardown + a fresh
    // AudioHardwareCreateProcessTap — which is a fresh chance for macOS to
    // re-prompt for the audio-capture permission. That is the reported
    // "asks for permission every ~20 minutes" loop. read_device_uid's own doc
    // comment already called the UID "the stable string id the HAL knows the
    // device by"; this branch just never used it.
    let id = macimpl::default_output_device_id()?;
    Ok(macimpl::default_output_device_uid(id).unwrap_or_else(|| id.to_string()))
}

#[cfg(not(any(target_os = "windows", target_os = "macos")))]
pub fn default_endpoint_id() -> Result<String, String> {
    Err("default endpoint id is Windows-only".to_string())
}

/// An app that currently owns a Core Audio *process object* — the macOS
/// analogue of holding a Windows audio session, and read as exactly the same
/// signal: "this app is available to capture right now". A process object
/// appears when an app first touches the audio HAL and survives it pausing,
/// which matches how the Windows side keeps non-expired sessions.
///
/// Deliberately *not* sourced from a plain `NSWorkspace.runningApplications`
/// scan. `audio::session_pairs` reads a pid here as "attachable right now",
/// and a tap on a pid with no Core Audio process object fails — which would
/// trip the sticky `supported` flag and stop the 2 s watcher from ever
/// reattaching when the app does start playing. Filtering through the
/// process-object list keeps "absent" meaning "not playing yet, keep
/// watching", exactly as the Windows session snapshot does.
#[cfg(target_os = "macos")]
#[derive(Debug, Clone)]
pub struct AudioApp {
    /// Lowercased bundle identifier (`com.spotify.client`). Plays exactly the
    /// role the lowercased exe basename plays on Windows: it is what
    /// `SourceOption.exe` carries, what `Source::Apps.exes` stores, and
    /// therefore what the per-source sensitivity key is built from — so it must
    /// be normalized here, since bundle ids are *not* reliably lowercase
    /// (`com.apple.Music`).
    pub bundle_id: String,
    pub name: String,
    pub pid: u32,
}

/// Apps with a Core Audio process object, deduped by bundle id. Drives both
/// the source picker and `audio::session_pairs`, so the picker can never offer
/// something the supervisor then fails to resolve.
#[cfg(target_os = "macos")]
pub fn audio_process_apps() -> Result<Vec<AudioApp>, String> {
    macimpl::audio_process_apps()
}


#[cfg(target_os = "windows")]
mod winimpl {
    use super::{AppSession, MasterState, MixerCmd, MixerSnapshot, OutputDevice};
    use std::ffi::c_void;
    use std::path::Path;
    use windows::core::{Interface, BSTR, GUID, HRESULT, PCWSTR};
    use windows::Win32::Foundation::{CloseHandle, HANDLE, MAX_PATH};
    use windows::Win32::Media::Audio::Endpoints::IAudioEndpointVolume;
    use windows::Win32::Media::Audio::{
        eConsole, eMultimedia, eRender, AudioSessionStateActive, AudioSessionStateExpired, ERole,
        IAudioSessionControl, IAudioSessionControl2, IAudioSessionEnumerator,
        IAudioSessionManager2, IMMDevice, IMMDeviceCollection, IMMDeviceEnumerator,
        ISimpleAudioVolume, MMDeviceEnumerator, DEVICE_STATE_ACTIVE,
    };
    use windows::Win32::System::Com::{
        CoCreateInstance, CoTaskMemFree, CLSCTX_ALL, CLSCTX_INPROC_SERVER, STGM_READ,
    };
    use windows::Win32::System::Threading::{
        OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_FORMAT,
        PROCESS_QUERY_LIMITED_INFORMATION,
    };
    use windows::Win32::UI::Shell::PropertiesSystem::PROPERTYKEY;

    // PKEY_Device_FriendlyName: {a45c254e-df1c-4efd-8020-67d146a850e0}, 14
    const PKEY_DEVICE_FRIENDLY_NAME: PROPERTYKEY = PROPERTYKEY {
        fmtid: GUID::from_u128(0xa45c254e_df1c_4efd_8020_67d146a850e0),
        pid: 14,
    };

    pub unsafe fn create_enumerator() -> windows::core::Result<IMMDeviceEnumerator> {
        CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)
    }

    /// Just the default render endpoint's id — the first two calls `capture`
    /// makes, without the rest of the snapshot.
    pub unsafe fn default_endpoint_id(en: &IMMDeviceEnumerator) -> windows::core::Result<String> {
        let d = en.GetDefaultAudioEndpoint(eRender, eConsole)?;
        Ok(pwstr_id(d.GetId()?))
    }

    pub unsafe fn capture(en: &IMMDeviceEnumerator) -> windows::core::Result<MixerSnapshot> {
        let default_device = en.GetDefaultAudioEndpoint(eRender, eConsole)?;
        let default_id = pwstr_id(default_device.GetId()?);

        let endpoint_vol: IAudioEndpointVolume =
            default_device.Activate(CLSCTX_INPROC_SERVER, None)?;
        let master = MasterState {
            volume: endpoint_vol.GetMasterVolumeLevelScalar()?.clamp(0.0, 1.0),
            mute: endpoint_vol.GetMute()?.as_bool(),
            device_id: default_id.clone(),
            device_name: read_device_name(&default_device).unwrap_or_else(|_| "Unknown".to_string()),
        };

        let coll: IMMDeviceCollection = en.EnumAudioEndpoints(eRender, DEVICE_STATE_ACTIVE)?;
        let count = coll.GetCount()?;
        let mut devices: Vec<OutputDevice> = Vec::with_capacity(count as usize);
        for i in 0..count {
            let d = coll.Item(i)?;
            let id = pwstr_id(d.GetId()?);
            let name = read_device_name(&d).unwrap_or_else(|_| "Unknown".to_string());
            let is_default = id == default_id;
            devices.push(OutputDevice { id, name, is_default });
        }
        devices.sort_by(|a, b| {
            b.is_default
                .cmp(&a.is_default)
                .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
        });

        let sm: IAudioSessionManager2 = default_device.Activate(CLSCTX_INPROC_SERVER, None)?;
        let enu: IAudioSessionEnumerator = sm.GetSessionEnumerator()?;
        let scount = enu.GetCount()?;
        // Collect (priority, session). Priority: 2 = active, 1 = inactive,
        // expired sessions are dropped in build_session (returns None).
        let mut raw: Vec<(u8, AppSession)> = Vec::with_capacity(scount as usize);
        for i in 0..scount {
            let ctrl: IAudioSessionControl = enu.GetSession(i)?;
            if let Some((priority, s)) = build_session(&ctrl) {
                raw.push((priority, s));
            }
        }
        // Active sessions first so the dedupe step picks them as the
        // representative when the same PID has multiple sessions (e.g.
        // peripheral daemons that open one inactive session per audio device
        // — the user sees one row instead of three).
        raw.sort_by(|a, b| b.0.cmp(&a.0));
        use std::collections::HashSet;
        let mut seen: HashSet<(bool, u32)> = HashSet::new();
        let mut sessions: Vec<AppSession> = Vec::with_capacity(raw.len());
        for (_priority, s) in raw {
            if seen.insert((s.is_system_sounds, s.pid)) {
                sessions.push(s);
            }
        }
        // Final UI sort: system sounds first, then alphabetical so rows don't
        // shuffle on every 1Hz refresh.
        sessions.sort_by(|a, b| {
            b.is_system_sounds
                .cmp(&a.is_system_sounds)
                .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
                .then_with(|| a.pid.cmp(&b.pid))
        });

        Ok(MixerSnapshot {
            master: Some(master),
            devices,
            sessions,
        })
    }

    unsafe fn build_session(ctrl: &IAudioSessionControl) -> Option<(u8, AppSession)> {
        // Skip expired sessions (process exited, audio engine hasn't GC'd yet).
        // These show up in the enumerator as ghost entries.
        let state = ctrl.GetState().ok()?;
        if state == AudioSessionStateExpired {
            return None;
        }
        let priority: u8 = if state == AudioSessionStateActive { 2 } else { 1 };

        let ctrl2: IAudioSessionControl2 = ctrl.cast().ok()?;
        let pid = ctrl2.GetProcessId().ok()?;
        // IsSystemSoundsSession returns S_OK for the system-sounds session and
        // S_FALSE for everything else. Both are non-error HRESULTs, so the
        // safe windows-rs wrapper would tell us nothing — we have to call the
        // raw vtable function and inspect the HRESULT value directly.
        let is_system_sounds = {
            let hr = (Interface::vtable(&ctrl2).IsSystemSoundsSession)(Interface::as_raw(&ctrl2));
            hr.0 == 0
        };

        let simple: ISimpleAudioVolume = ctrl.cast().ok()?;
        let volume = simple.GetMasterVolume().ok()?.clamp(0.0, 1.0);
        let mute = simple.GetMute().ok()?.as_bool();

        let exe_path = if is_system_sounds { None } else { process_image_path(pid) };
        let name = if is_system_sounds {
            "System sounds".to_string()
        } else {
            // Resolution order, mirrored from how Windows Volume Mixer itself
            // resolves session names:
            //   1. IAudioSessionControl::GetDisplayName — only when the app
            //      bothered to set it AND it isn't a "@resource,id" indirect
            //      string (we can't load arbitrary mui resources from here).
            //   2. The exe's version-info FileDescription — this is what
            //      Task Manager's "Name" column shows ("Google Chrome",
            //      "Discord", "Spotify"). The cache keeps this off the hot path.
            //   3. The exe basename (chrome.exe, Discord.exe).
            //   4. "PID nnnn" if even basename lookup fails.
            let display = ctrl
                .GetDisplayName()
                .ok()
                .map(pwstr_id)
                .filter(|s| !s.is_empty() && !s.starts_with('@'));
            display
                .or_else(|| exe_path.as_deref().and_then(cached_friendly_name))
                .or_else(|| exe_path.as_deref().and_then(basename_of))
                .unwrap_or_else(|| format!("PID {pid}"))
        };

        // Extract icon by full exe path (cached). System-sounds session has no
        // exe, so skip — the frontend renders a "♪" glyph for it.
        let icon = exe_path.as_deref().and_then(cached_icon_data_url);

        let exe = exe_path
            .as_deref()
            .and_then(|p| Path::new(p).file_name())
            .and_then(|n| n.to_str())
            .map(|s| s.to_lowercase());

        Some((
            priority,
            AppSession {
                pid,
                name,
                volume,
                mute,
                is_system_sounds,
                icon,
                exe,
            },
        ))
    }

    fn basename_of(path: &str) -> Option<String> {
        Path::new(path).file_name().map(|n| n.to_string_lossy().to_string())
    }

    unsafe fn read_device_name(d: &IMMDevice) -> windows::core::Result<String> {
        // Friendly name comes back as a VT_LPWSTR PROPVARIANT. windows-core 0.58
        // hides the union; PropVariantToBSTR handles the string-coerce cleanly,
        // and PROPVARIANT auto-clears on Drop.
        let store = d.OpenPropertyStore(STGM_READ)?;
        let prop = store.GetValue(&PKEY_DEVICE_FRIENDLY_NAME)?;
        let bstr = BSTR::try_from(&prop)?;
        Ok(bstr.to_string())
    }

    fn process_image_path(pid: u32) -> Option<String> {
        unsafe {
            let handle: HANDLE = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;
            let mut buf: [u16; MAX_PATH as usize] = [0; MAX_PATH as usize];
            let mut size: u32 = buf.len() as u32;
            let res = QueryFullProcessImageNameW(
                handle,
                PROCESS_NAME_FORMAT(0),
                windows::core::PWSTR(buf.as_mut_ptr()),
                &mut size,
            );
            let _ = CloseHandle(handle);
            if res.is_err() || size == 0 {
                return None;
            }
            Some(String::from_utf16_lossy(&buf[..size as usize]))
        }
    }

    /// Convert a PWSTR returned by COM (caller-owns) to a Rust String, freeing
    /// the original COM allocation.
    fn pwstr_id(p: windows::core::PWSTR) -> String {
        if p.is_null() {
            return String::new();
        }
        unsafe {
            let s = p.to_string().unwrap_or_default();
            CoTaskMemFree(Some(p.0 as *const c_void));
            s
        }
    }

    pub unsafe fn apply_cmd(en: &IMMDeviceEnumerator, cmd: MixerCmd) {
        let result = match cmd {
            MixerCmd::SetMasterVolume(v) => set_master_volume(en, v),
            MixerCmd::SetMasterMute(m) => set_master_mute(en, m),
            MixerCmd::SetSessionVolume(pid, v) => set_session_volume(en, pid, v),
            MixerCmd::SetSessionMute(pid, m) => set_session_mute(en, pid, m),
            MixerCmd::SetDefaultOutput(id) => set_default_output(&id),
            MixerCmd::Refresh => Ok(()),
        };
        if let Err(e) = result {
            eprintln!("mixer cmd: {e}");
        }
    }

    unsafe fn set_master_volume(en: &IMMDeviceEnumerator, v: f32) -> windows::core::Result<()> {
        let d = en.GetDefaultAudioEndpoint(eRender, eConsole)?;
        let ev: IAudioEndpointVolume = d.Activate(CLSCTX_INPROC_SERVER, None)?;
        ev.SetMasterVolumeLevelScalar(v.clamp(0.0, 1.0), std::ptr::null())?;
        Ok(())
    }

    unsafe fn set_master_mute(en: &IMMDeviceEnumerator, m: bool) -> windows::core::Result<()> {
        let d = en.GetDefaultAudioEndpoint(eRender, eConsole)?;
        let ev: IAudioEndpointVolume = d.Activate(CLSCTX_INPROC_SERVER, None)?;
        ev.SetMute(m, std::ptr::null())?;
        Ok(())
    }

    /// Apply `f` to every session whose process id matches `pid`. Multi-apply
    /// is intentional: peripheral daemons (LEDKeeper2, RGB software) often
    /// open one session per audio device, but we collapse those to a single
    /// UI row, so the user's mute/volume change must touch all of them.
    unsafe fn for_each_session<F>(
        en: &IMMDeviceEnumerator,
        pid: u32,
        mut f: F,
    ) -> windows::core::Result<()>
    where
        F: FnMut(&IAudioSessionControl) -> windows::core::Result<()>,
    {
        let d = en.GetDefaultAudioEndpoint(eRender, eConsole)?;
        let sm: IAudioSessionManager2 = d.Activate(CLSCTX_INPROC_SERVER, None)?;
        let enu: IAudioSessionEnumerator = sm.GetSessionEnumerator()?;
        let n = enu.GetCount()?;
        for i in 0..n {
            let ctrl = enu.GetSession(i)?;
            let ctrl2: IAudioSessionControl2 = ctrl.cast()?;
            if ctrl2.GetProcessId().unwrap_or(0) == pid {
                let _ = f(&ctrl);
            }
        }
        Ok(())
    }

    unsafe fn set_session_volume(
        en: &IMMDeviceEnumerator,
        pid: u32,
        v: f32,
    ) -> windows::core::Result<()> {
        for_each_session(en, pid, |ctrl| {
            let sv: ISimpleAudioVolume = ctrl.cast()?;
            sv.SetMasterVolume(v.clamp(0.0, 1.0), std::ptr::null())?;
            Ok(())
        })
    }

    unsafe fn set_session_mute(
        en: &IMMDeviceEnumerator,
        pid: u32,
        m: bool,
    ) -> windows::core::Result<()> {
        for_each_session(en, pid, |ctrl| {
            let sv: ISimpleAudioVolume = ctrl.cast()?;
            sv.SetMute(m, std::ptr::null())?;
            Ok(())
        })
    }

    unsafe fn set_default_output(device_id: &str) -> windows::core::Result<()> {
        // IPolicyConfig: undocumented, stable Vista+. We CoCreateInstance it as
        // an IUnknown, manually QueryInterface for IPolicyConfig (IID below),
        // then call SetDefaultEndpoint at vtable index 13.
        const CLSID_POLICY_CONFIG: GUID =
            GUID::from_u128(0x870AF99C_171D_4F9E_AF0D_E63DF40C2BC9);
        const IID_POLICY_CONFIG: GUID =
            GUID::from_u128(0xF8679F50_850A_41CF_9C72_430F290290C8);

        let unk: windows::core::IUnknown =
            CoCreateInstance(&CLSID_POLICY_CONFIG, None, CLSCTX_ALL)?;
        let raw_unk = unk.as_raw();

        type QiFn = unsafe extern "system" fn(*mut c_void, *const GUID, *mut *mut c_void) -> HRESULT;
        let unk_vtbl = *(raw_unk as *const *const usize);
        let qi: QiFn = std::mem::transmute(*(unk_vtbl as *const usize));
        let mut pc: *mut c_void = std::ptr::null_mut();
        qi(raw_unk, &IID_POLICY_CONFIG, &mut pc).ok()?;
        if pc.is_null() {
            return Err(windows::core::Error::from(
                windows::Win32::Foundation::E_NOINTERFACE,
            ));
        }

        // Vtable layout: 3 IUnknown + 10 IPolicyConfig methods, then SetDefaultEndpoint.
        type SetDefEpFn = unsafe extern "system" fn(*mut c_void, PCWSTR, ERole) -> HRESULT;
        type ReleaseFn = unsafe extern "system" fn(*mut c_void) -> u32;
        let pc_vtbl = *(pc as *const *const usize);
        let set_def_ep: SetDefEpFn = std::mem::transmute(*((pc_vtbl as *const usize).offset(13)));
        let release: ReleaseFn = std::mem::transmute(*((pc_vtbl as *const usize).offset(2)));

        let wide: Vec<u16> = device_id
            .encode_utf16()
            .chain(std::iter::once(0))
            .collect();
        let pcwstr = PCWSTR(wide.as_ptr());

        // Windows itself sets both eConsole and eMultimedia when the user picks a
        // new default in the sound panel. Match that.
        let r1 = set_def_ep(pc, pcwstr, eConsole).ok();
        let r2 = set_def_ep(pc, pcwstr, eMultimedia).ok();

        release(pc);
        r1.and(r2)
    }

    // ── App icons ──────────────────────────────────────────────────────────
    //
    // Per-exe-path cache. Looked up by the worker thread only, but the static
    // needs Mutex anyway since rust-analyzer / strict static checks demand
    // Sync. A `None` value means a previous extraction failed — we cache the
    // miss too so we don't re-attempt once-per-emit forever.
    use std::collections::HashMap;
    use std::sync::Mutex as StdMutex;
    static ICON_CACHE: StdMutex<Option<HashMap<String, Option<String>>>> = StdMutex::new(None);
    // Per-exe cache for the version-info FileDescription. Same pattern as
    // ICON_CACHE: cache misses too so we don't re-query every emit.
    static NAME_CACHE: StdMutex<Option<HashMap<String, Option<String>>>> = StdMutex::new(None);
    /// Cap for both per-exe caches (0.9.5 leak audit): they grew one entry —
    /// including a base64 PNG for icons — per distinct exe ever seen, with no
    /// eviction. 128 distinct audio apps is far past any real session; when
    /// exceeded the map is simply cleared (re-extraction is cheap and rare)
    /// rather than carrying LRU bookkeeping for a case that never recurs.
    pub(super) const EXE_CACHE_CAP: usize = 128;

    pub fn cached_friendly_name(exe_path: &str) -> Option<String> {
        let mut guard = NAME_CACHE.lock().ok()?;
        let map = guard.get_or_insert_with(HashMap::new);
        if let Some(v) = map.get(exe_path) {
            return v.clone();
        }
        if map.len() >= EXE_CACHE_CAP {
            map.clear();
        }
        let result = unsafe { friendly_app_name(exe_path) };
        map.insert(exe_path.to_string(), result.clone());
        result
    }

    /// Read the `FileDescription` string from the exe's VERSIONINFO resource.
    /// Returns Windows' user-facing app name ("Google Chrome", "Discord").
    unsafe fn friendly_app_name(exe_path: &str) -> Option<String> {
        use windows::Win32::Storage::FileSystem::{
            GetFileVersionInfoSizeW, GetFileVersionInfoW, VerQueryValueW,
        };

        let path_wide: Vec<u16> = exe_path.encode_utf16().chain(std::iter::once(0)).collect();
        let path = PCWSTR(path_wide.as_ptr());

        let size = GetFileVersionInfoSizeW(path, None);
        if size == 0 {
            return None;
        }
        let mut buf: Vec<u8> = vec![0u8; size as usize];
        GetFileVersionInfoW(path, 0, size, buf.as_mut_ptr() as *mut c_void).ok()?;

        // Find the first translation entry (lang + codepage). The block at
        // \VarFileInfo\Translation is an array of (u16 lang, u16 codepage).
        let trans_query: Vec<u16> = "\\VarFileInfo\\Translation"
            .encode_utf16()
            .chain(std::iter::once(0))
            .collect();
        let mut trans_ptr: *mut c_void = std::ptr::null_mut();
        let mut trans_len: u32 = 0;
        let trans_ok = VerQueryValueW(
            buf.as_ptr() as *const c_void,
            PCWSTR(trans_query.as_ptr()),
            &mut trans_ptr,
            &mut trans_len,
        );
        let (lang, cp) = if trans_ok.as_bool() && !trans_ptr.is_null() && trans_len >= 4 {
            let entries = trans_ptr as *const u16;
            (*entries, *entries.offset(1))
        } else {
            // Fallback: English-US + Unicode codepage (the most common combo).
            (0x0409, 0x04B0)
        };

        let sub = format!("\\StringFileInfo\\{:04x}{:04x}\\FileDescription", lang, cp);
        let sub_wide: Vec<u16> = sub.encode_utf16().chain(std::iter::once(0)).collect();
        let mut val_ptr: *mut c_void = std::ptr::null_mut();
        let mut val_len: u32 = 0;
        let val_ok = VerQueryValueW(
            buf.as_ptr() as *const c_void,
            PCWSTR(sub_wide.as_ptr()),
            &mut val_ptr,
            &mut val_len,
        );
        if !val_ok.as_bool() || val_ptr.is_null() || val_len == 0 {
            return None;
        }
        // val_len is in characters. May or may not include trailing null —
        // strip on first null we see to be safe.
        let chars = std::slice::from_raw_parts(val_ptr as *const u16, val_len as usize);
        let end = chars.iter().position(|&c| c == 0).unwrap_or(chars.len());
        let s = String::from_utf16_lossy(&chars[..end]).trim().to_string();
        if s.is_empty() {
            None
        } else {
            Some(s)
        }
    }

    pub fn cached_icon_data_url(exe_path: &str) -> Option<String> {
        let mut guard = ICON_CACHE.lock().ok()?;
        let map = guard.get_or_insert_with(HashMap::new);
        if let Some(v) = map.get(exe_path) {
            return v.clone();
        }
        if map.len() >= EXE_CACHE_CAP {
            map.clear();
        }
        let result = unsafe { extract_icon_data_url(exe_path) };
        map.insert(exe_path.to_string(), result.clone());
        result
    }

    unsafe fn extract_icon_data_url(exe_path: &str) -> Option<String> {
        use windows::Win32::Storage::FileSystem::FILE_FLAGS_AND_ATTRIBUTES;
        use windows::Win32::UI::Shell::{
            SHGetFileInfoW, SHFILEINFOW, SHGFI_ICON, SHGFI_LARGEICON,
        };
        use windows::Win32::UI::WindowsAndMessaging::DestroyIcon;

        let wide: Vec<u16> = exe_path.encode_utf16().chain(std::iter::once(0)).collect();
        let mut shfi: SHFILEINFOW = std::mem::zeroed();
        // Pass FILE_ATTRIBUTE_NORMAL = 0x80; we don't actually want shell to
        // hit the file system — but with a real existing path, the default
        // (0) is fine and SHGetFileInfo retrieves the per-exe icon directly.
        let ret = SHGetFileInfoW(
            PCWSTR(wide.as_ptr()),
            FILE_FLAGS_AND_ATTRIBUTES(0),
            Some(&mut shfi),
            std::mem::size_of::<SHFILEINFOW>() as u32,
            SHGFI_ICON | SHGFI_LARGEICON,
        );
        if ret == 0 || shfi.hIcon.is_invalid() {
            return None;
        }
        let png_bytes = paint_icon_to_png(shfi.hIcon, 32, 32);
        let _ = DestroyIcon(shfi.hIcon);

        png_bytes.map(|bytes| {
            use base64::{engine::general_purpose::STANDARD, Engine as _};
            let b64 = STANDARD.encode(&bytes);
            format!("data:image/png;base64,{b64}")
        })
    }

    unsafe fn paint_icon_to_png(
        hicon: windows::Win32::UI::WindowsAndMessaging::HICON,
        w: i32,
        h: i32,
    ) -> Option<Vec<u8>> {
        use windows::Win32::Graphics::Gdi::{
            CreateCompatibleDC, CreateDIBSection, DeleteDC, DeleteObject, GetDC, ReleaseDC,
            SelectObject, BITMAPINFO, BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS,
        };
        use windows::Win32::UI::WindowsAndMessaging::{DrawIconEx, DI_NORMAL};

        let screen_dc = GetDC(None);
        if screen_dc.is_invalid() {
            return None;
        }
        let mem_dc = CreateCompatibleDC(screen_dc);
        if mem_dc.is_invalid() {
            ReleaseDC(None, screen_dc);
            return None;
        }

        let mut bmi: BITMAPINFO = std::mem::zeroed();
        bmi.bmiHeader.biSize = std::mem::size_of::<BITMAPINFOHEADER>() as u32;
        bmi.bmiHeader.biWidth = w;
        bmi.bmiHeader.biHeight = -h; // top-down: row 0 at top
        bmi.bmiHeader.biPlanes = 1;
        bmi.bmiHeader.biBitCount = 32;
        bmi.bmiHeader.biCompression = BI_RGB.0 as u32;

        let mut bits_ptr: *mut c_void = std::ptr::null_mut();
        let hbmp_res = CreateDIBSection(mem_dc, &bmi, DIB_RGB_COLORS, &mut bits_ptr, None, 0);
        let hbmp = match hbmp_res {
            Ok(b) if !bits_ptr.is_null() => b,
            _ => {
                let _ = DeleteDC(mem_dc);
                ReleaseDC(None, screen_dc);
                return None;
            }
        };

        let old = SelectObject(mem_dc, hbmp);
        // Clear to fully transparent so non-32bpp icons leave alpha 0 outside
        // the painted region. We patch alpha for opaque-but-zero-alpha pixels
        // below to handle older 24bpp+mask icons.
        std::ptr::write_bytes(bits_ptr as *mut u8, 0, (w * h * 4) as usize);

        let _ = DrawIconEx(mem_dc, 0, 0, hicon, w, h, 0, None, DI_NORMAL);

        let pixel_count = (w * h) as usize;
        let mut bgra = vec![0u8; pixel_count * 4];
        std::ptr::copy_nonoverlapping(bits_ptr as *const u8, bgra.as_mut_ptr(), bgra.len());

        SelectObject(mem_dc, old);
        let _ = DeleteObject(hbmp);
        let _ = DeleteDC(mem_dc);
        ReleaseDC(None, screen_dc);

        // Detect 24bpp+mask vs 32bpp ARGB. If every pixel has alpha 0, the
        // icon was painted without an alpha channel → set alpha to 255 wherever
        // any colour channel is non-zero. Modern 32bpp icons hit the else path.
        let has_any_alpha = bgra.chunks_exact(4).any(|p| p[3] != 0);

        let mut rgba = vec![0u8; bgra.len()];
        for i in 0..pixel_count {
            let b = bgra[i * 4];
            let g = bgra[i * 4 + 1];
            let r = bgra[i * 4 + 2];
            let a = bgra[i * 4 + 3];
            let alpha = if has_any_alpha {
                a
            } else if r != 0 || g != 0 || b != 0 {
                0xFF
            } else {
                0
            };
            rgba[i * 4] = r;
            rgba[i * 4 + 1] = g;
            rgba[i * 4 + 2] = b;
            rgba[i * 4 + 3] = alpha;
        }

        let mut out: Vec<u8> = Vec::new();
        {
            let mut encoder = png::Encoder::new(&mut out, w as u32, h as u32);
            encoder.set_color(png::ColorType::Rgba);
            encoder.set_depth(png::BitDepth::Eight);
            let mut writer = encoder.write_header().ok()?;
            writer.write_image_data(&rgba).ok()?;
        }
        Some(out)
    }
}

/// Core Audio device enumeration and default-output switching, backed by
/// `AudioObjectGetPropertyData`/`AudioObjectSetPropertyData` on
/// `kAudioObjectSystemObject` — the HAL-level equivalent of the Windows
/// `IMMDeviceEnumerator` calls in `winimpl` above.
///
/// Per-app volume has no public Core Audio equivalent of Windows'
/// `ISimpleAudioVolume`/session model, so this module never touches
/// `MixerSnapshot.sessions` (left empty by the caller) and doesn't implement
/// master volume/mute either (no property is wired up for it — out of scope
/// for this module; `MixerSnapshot.master` is always `None` on macOS today).
#[cfg(target_os = "macos")]
mod macimpl {
    use super::{AudioApp, MixerCmd, MixerSnapshot, OutputDevice};
    use core_foundation_sys::base::CFRelease;
    use core_foundation_sys::string::{
        kCFStringEncodingUTF8, CFStringGetCString, CFStringGetCStringPtr, CFStringRef,
    };
    use coreaudio_sys::{
        kAudioDevicePropertyDeviceUID, kAudioDevicePropertyStreamConfiguration,
        kAudioHardwareNoError,
        kAudioHardwarePropertyDefaultOutputDevice, kAudioHardwarePropertyDevices,
        kAudioObjectPropertyElementMaster, kAudioObjectPropertyName,
        kAudioObjectPropertyScopeGlobal, kAudioObjectPropertyScopeOutput, kAudioObjectSystemObject,
        AudioBuffer, AudioBufferList, AudioObjectGetPropertyData, AudioObjectGetPropertyDataSize,
        AudioObjectID, AudioObjectPropertyAddress, AudioObjectSetPropertyData,
    };
    use objc2::rc::autoreleasepool;
    use objc2_app_kit::NSRunningApplication;
    use std::collections::HashSet;
    use std::ffi::{c_void, CStr};
    use std::mem;
    use std::ptr::null;

    /// Core Audio's four-character-code selectors, big-endian packed. Same
    /// helper `audio_tap.rs` uses, and for the same reason: the two constants
    /// below were added to `<CoreAudio/AudioHardware.h>` in macOS 14.2, so
    /// whether `coreaudio-sys`'s bindgen output contains them depends on which
    /// SDK built it. The four-character code is fixed by the ABI, so spelling
    /// it out here is both stable and self-documenting.
    const fn fourcc(s: &[u8; 4]) -> u32 {
        ((s[0] as u32) << 24) | ((s[1] as u32) << 16) | ((s[2] as u32) << 8) | (s[3] as u32)
    }

    /// `kAudioHardwarePropertyProcessObjectList` on the system object.
    const K_AUDIO_HARDWARE_PROPERTY_PROCESS_OBJECT_LIST: u32 = fourcc(b"prol");
    /// `kAudioProcessPropertyPID` on one of those process objects.
    const K_AUDIO_PROCESS_PROPERTY_PID: u32 = fourcc(b"ppid");

    fn check(status: i32) -> Result<(), String> {
        if status != kAudioHardwareNoError as i32 {
            Err(format!("Core Audio error {status}"))
        } else {
            Ok(())
        }
    }

    fn global_address(selector: u32) -> AudioObjectPropertyAddress {
        AudioObjectPropertyAddress {
            mSelector: selector,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMaster,
        }
    }

    /// Reads a fixed-size scalar property (anything that fits in `T`, here
    /// always a 4-byte `AudioObjectID`) off `object`.
    unsafe fn get_scalar<T: Copy>(
        object: AudioObjectID,
        addr: &AudioObjectPropertyAddress,
        default: T,
    ) -> Result<T, String> {
        let mut value = default;
        let mut size = mem::size_of::<T>() as u32;
        let status = AudioObjectGetPropertyData(
            object,
            addr as *const _,
            0,
            null(),
            &mut size as *mut _,
            &mut value as *mut T as *mut c_void,
        );
        check(status)?;
        Ok(value)
    }

    /// The current default output device — polled every 2 s by the audio
    /// supervisor's device-follow watcher via `super::default_endpoint_id`,
    /// and used here to compute each enumerated device's `is_default`.
    pub fn default_output_device_id() -> Result<AudioObjectID, String> {
        unsafe {
            let addr = global_address(kAudioHardwarePropertyDefaultOutputDevice);
            get_scalar(kAudioObjectSystemObject, &addr, 0)
        }
    }

    /// Any CFStringRef-valued global property, converted to an owned `String`.
    /// Tries the zero-copy `CFStringGetCStringPtr` path first (only available
    /// when the string is already backed by a contiguous UTF-8-ish buffer
    /// internally); falls back to the always-correct `CFStringGetCString` copy
    /// otherwise — the exact two-step dance Core Audio client code (e.g. cpal's
    /// own coreaudio backend) uses for this.
    unsafe fn read_string_property(id: AudioObjectID, selector: u32) -> Option<String> {
        let addr = global_address(selector);
        let mut str_ref: CFStringRef = null();
        let mut size = mem::size_of::<CFStringRef>() as u32;
        let status = AudioObjectGetPropertyData(
            id,
            &addr as *const _,
            0,
            null(),
            &mut size as *mut _,
            &mut str_ref as *mut CFStringRef as *mut c_void,
        );
        if status != kAudioHardwareNoError as i32 || str_ref.is_null() {
            return None;
        }

        let ptr = CFStringGetCStringPtr(str_ref, kCFStringEncodingUTF8);
        let result = if !ptr.is_null() {
            CStr::from_ptr(ptr).to_str().ok().map(|s| s.to_string())
        } else {
            let mut buf = [0i8; 512];
            let ok = CFStringGetCString(str_ref, buf.as_mut_ptr(), buf.len() as isize, kCFStringEncodingUTF8);
            if ok != 0 {
                Some(CStr::from_ptr(buf.as_ptr()).to_string_lossy().into_owned())
            } else {
                None
            }
        };
        CFRelease(str_ref as *const c_void);
        result
    }

    /// `kAudioObjectPropertyName` — the human-readable name shown in the picker.
    unsafe fn read_device_name(id: AudioObjectID) -> Option<String> {
        read_string_property(id, kAudioObjectPropertyName)
    }

    /// Public wrapper over `read_device_uid` for the supervisor's
    /// device-follow comparison (0.8.7) — see `default_endpoint_id`.
    pub fn default_output_device_uid(id: AudioObjectID) -> Option<String> {
        unsafe { read_device_uid(id) }
    }

    /// `kAudioDevicePropertyDeviceUID` — the stable string id the HAL knows the
    /// device by, and the only way to recognize one of our own tap aggregates
    /// (their display name is user-facing text, their UID is ours by
    /// construction).
    unsafe fn read_device_uid(id: AudioObjectID) -> Option<String> {
        read_string_property(id, kAudioDevicePropertyDeviceUID)
    }

    /// Sum of `mNumberChannels` across every buffer in the device's output
    /// stream configuration — zero means the device has no output streams
    /// (e.g. an input-only mic), the filter this task's brief calls for.
    unsafe fn output_channel_count(id: AudioObjectID) -> Result<u32, String> {
        let addr = AudioObjectPropertyAddress {
            mSelector: kAudioDevicePropertyStreamConfiguration,
            mScope: kAudioObjectPropertyScopeOutput,
            mElement: kAudioObjectPropertyElementMaster,
        };
        let mut size: u32 = 0;
        let status =
            AudioObjectGetPropertyDataSize(id, &addr as *const _, 0, null(), &mut size as *mut _);
        // An input-only device (e.g. a microphone) is expected to report a
        // zero-length buffer list for the output scope. Treat a failed size
        // query the same way defensively — either way there's nothing to
        // read, and "no output streams" is the correct answer for our filter.
        if status != kAudioHardwareNoError as i32 || size == 0 {
            return Ok(0);
        }

        let mut buf: Vec<u8> = vec![0u8; size as usize];
        let status = AudioObjectGetPropertyData(
            id,
            &addr as *const _,
            0,
            null(),
            &mut size as *mut _,
            buf.as_mut_ptr() as *mut c_void,
        );
        check(status)?;

        let list = buf.as_ptr() as *const AudioBufferList;
        let n_buffers = (*list).mNumberBuffers as usize;
        if n_buffers == 0 {
            return Ok(0);
        }
        let first: *const AudioBuffer = (*list).mBuffers.as_ptr();
        let buffers = std::slice::from_raw_parts(first, n_buffers);
        Ok(buffers.iter().map(|b| b.mNumberChannels).sum())
    }

    /// All devices with at least one output stream, sorted default-first
    /// then alphabetically — mirrors `winimpl::capture`'s device sort so the
    /// UI ordering is consistent across platforms.
    pub fn devices_snapshot() -> Result<Vec<OutputDevice>, String> {
        unsafe {
            let addr = global_address(kAudioHardwarePropertyDevices);
            let mut size: u32 = 0;
            let status = AudioObjectGetPropertyDataSize(
                kAudioObjectSystemObject,
                &addr as *const _,
                0,
                null(),
                &mut size as *mut _,
            );
            check(status)?;

            let count = size as usize / mem::size_of::<AudioObjectID>();
            let mut ids: Vec<AudioObjectID> = vec![0; count];
            let status = AudioObjectGetPropertyData(
                kAudioObjectSystemObject,
                &addr as *const _,
                0,
                null(),
                &mut size as *mut _,
                ids.as_mut_ptr() as *mut c_void,
            );
            check(status)?;

            // Best-effort: if the default-device query itself fails, fall
            // back to "nothing is marked default" rather than failing the
            // whole enumeration.
            let default_id = default_output_device_id().ok();

            let mut devices = Vec::with_capacity(ids.len());
            for id in ids {
                let channels = output_channel_count(id).unwrap_or(0);
                if channels == 0 {
                    continue;
                }
                // Our own capture aggregate (audio_tap.rs) is created private,
                // but `kAudioAggregateDeviceIsPrivateKey` only hides it from
                // *other* processes — this enumeration runs in the process that
                // created it, and in the shape-(a) path it carries the default
                // output as a sub-device, so it has output streams and survives
                // the channel filter above. Left in, the user would see a
                // phantom "Second-Monitor Hub Capture" device appear and vanish
                // with every source switch, and selecting it would make a
                // private aggregate whose IOProc zeroes its output buffers the
                // system default: silence.
                if read_device_uid(id)
                    .is_some_and(|uid| uid.starts_with(crate::audio_tap::AGGREGATE_UID_PREFIX))
                {
                    continue;
                }
                let name = read_device_name(id).unwrap_or_else(|| "Unknown".to_string());
                let is_default = default_id == Some(id);
                devices.push(OutputDevice { id: id.to_string(), name, is_default });
            }
            devices.sort_by(|a, b| {
                b.is_default
                    .cmp(&a.is_default)
                    .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
            });
            Ok(devices)
        }
    }

    /// Sets the system default output device. Rejects an id that doesn't
    /// parse as an `AudioObjectID` outright rather than silently falling
    /// back to some device — a bad id here should be loud, not quietly wrong.
    pub fn set_default_output(device_id: &str) -> Result<(), String> {
        let id: AudioObjectID = device_id
            .parse()
            .map_err(|_| format!("invalid Core Audio device id: {device_id:?}"))?;
        unsafe {
            let addr = global_address(kAudioHardwarePropertyDefaultOutputDevice);
            let size = mem::size_of::<AudioObjectID>() as u32;
            let status = AudioObjectSetPropertyData(
                kAudioObjectSystemObject,
                &addr as *const _,
                0,
                null(),
                size,
                &id as *const AudioObjectID as *const c_void,
            );
            check(status)
        }
    }

    /// Every Core Audio process object the HAL currently knows about.
    ///
    /// Two-call sizing like `devices_snapshot` above, with one difference that
    /// matters: the second call may report a *smaller* size than the first (a
    /// process exited between them), so the vector is truncated to what was
    /// actually written rather than left with trailing zeros that would then be
    /// queried as object id 0.
    unsafe fn process_object_list() -> Result<Vec<AudioObjectID>, String> {
        let addr = global_address(K_AUDIO_HARDWARE_PROPERTY_PROCESS_OBJECT_LIST);
        let mut size: u32 = 0;
        let status = AudioObjectGetPropertyDataSize(
            kAudioObjectSystemObject,
            &addr as *const _,
            0,
            null(),
            &mut size as *mut _,
        );
        if status != kAudioHardwareNoError as i32 {
            // The property itself is macOS 14.2+, so this is also what an older
            // system looks like — the same vintage that has no process taps at
            // all, which is why the message names the requirement.
            return Err(format!(
                "could not list Core Audio process objects (error {status}); per-app audio \
                 capture needs macOS 14.2 or newer"
            ));
        }
        let count = size as usize / mem::size_of::<AudioObjectID>();
        if count == 0 {
            return Ok(Vec::new());
        }
        let mut ids: Vec<AudioObjectID> = vec![0; count];
        let status = AudioObjectGetPropertyData(
            kAudioObjectSystemObject,
            &addr as *const _,
            0,
            null(),
            &mut size as *mut _,
            ids.as_mut_ptr() as *mut c_void,
        );
        check(status)?;
        ids.truncate(size as usize / mem::size_of::<AudioObjectID>());
        Ok(ids)
    }

    /// `kAudioProcessPropertyPID` off one process object. `None` for anything
    /// that isn't a usable pid, including the 0 a failed read leaves behind.
    unsafe fn process_pid(object: AudioObjectID) -> Option<i32> {
        let addr = global_address(K_AUDIO_PROCESS_PROPERTY_PID);
        let pid: i32 = get_scalar(object, &addr, 0).ok()?;
        (pid > 0).then_some(pid)
    }

    /// The picker's inventory: one entry per app that has a Core Audio process
    /// object *and* is a launchable application (so it has a bundle id and a
    /// localized name). Helper daemons like `coreaudiod` own process objects too
    /// and have no `NSRunningApplication`; they drop out here, which is the
    /// macOS counterpart of the Windows side skipping the system-sounds session.
    pub fn audio_process_apps() -> Result<Vec<AudioApp>, String> {
        let objects = unsafe { process_object_list()? };
        let mut seen: HashSet<String> = HashSet::new();
        let mut out = Vec::new();
        // The lookups below hand back autoreleased temporaries; this thread is
        // the mixer/audio-supervisor worker, not an AppKit run loop, so nothing
        // else would ever drain them.
        autoreleasepool(|_| {
            for object in objects {
                let Some(pid) = (unsafe { process_pid(object) }) else {
                    continue;
                };
                // SAFETY: all three are read-only Objective-C message sends with
                // no preconditions beyond a valid pid, and none is main-thread
                // -only; the `Retained` values manage their own refcounts.
                // `runningApplicationWithProcessIdentifier` returns nil for a
                // pid that is not an application (a daemon, or one that exited
                // since the list was taken), which is the filter described above.
                let Some(app) =
                    (unsafe { NSRunningApplication::runningApplicationWithProcessIdentifier(pid) })
                else {
                    continue;
                };
                let Some(bundle) = (unsafe { app.bundleIdentifier() }) else {
                    continue;
                };
                let bundle_id = bundle.to_string().to_lowercase();
                if bundle_id.is_empty() || !seen.insert(bundle_id.clone()) {
                    continue;
                }
                let name = unsafe { app.localizedName() }
                    .map(|n| n.to_string())
                    .filter(|n| !n.is_empty())
                    .unwrap_or_else(|| bundle_id.clone());
                out.push(AudioApp { bundle_id, name, pid: pid as u32 });
            }
        });
        Ok(out)
    }

    /// Applies one queued mixer command. Only `SetDefaultOutput` does
    /// anything on macOS; the rest are master/session-volume commands with
    /// no Core Audio path wired up here (see module docs), so they're
    /// intentionally no-ops rather than errors — matching how the Windows
    /// worker just logs-and-continues on a failed command.
    pub fn apply_cmd(cmd: MixerCmd) {
        let result = match cmd {
            MixerCmd::SetDefaultOutput(id) => set_default_output(&id),
            MixerCmd::SetMasterVolume(_)
            | MixerCmd::SetMasterMute(_)
            | MixerCmd::SetSessionVolume(_, _)
            | MixerCmd::SetSessionMute(_, _)
            | MixerCmd::Refresh => Ok(()),
        };
        if let Err(e) = result {
            eprintln!("mixer cmd: {e}");
        }
    }

    /// One snapshot for the worker's periodic emit: real devices, no master
    /// state, no sessions (see module docs for why).
    pub fn capture() -> Result<MixerSnapshot, String> {
        Ok(MixerSnapshot { master: None, devices: devices_snapshot()?, sessions: vec![] })
    }
}

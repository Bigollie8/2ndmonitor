//! Per-app capture via WASAPI process loopback. Activated against the virtual
//! device VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK with an explicit format —
//! this activation path does NOT support GetMixFormat, so we pick the format
//! and Windows converts. Pushes interleaved L/R into a ring with the same
//! contract as the cpal mix backend's, so everything downstream is identical.
//!
//! Requires Windows 10 build 20348+ (Windows 11 in practice). On older builds
//! activation fails and the caller falls back to the mix — we never sniff the
//! version, we just try.

use parking_lot::Mutex;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};

/// The format we ask Windows to convert the target process's audio into.
/// The process-loopback activation path has no GetMixFormat, so this is a
/// choice, not a discovery — 48 kHz stereo float is what every modern
/// endpoint mixes at, so the conversion is usually a no-op.
pub const CAPTURE_SAMPLE_RATE: u32 = 48_000;
const CAPTURE_CHANNELS: u16 = 2;

pub struct ProcessCapture {
    stop: Arc<AtomicBool>,
    alive: Arc<AtomicBool>,
    handle: Option<std::thread::JoinHandle<()>>,
}

impl ProcessCapture {
    /// False once the pump loop has exited, for *any* reason. A process
    /// loopback client is invalidated by an endpoint change just like a
    /// regular one (`AUDCLNT_E_DEVICE_INVALIDATED`), and the pump returns on
    /// that error — after which the ring buffer simply freezes on its last
    /// samples and the visualizer locks onto a static frame. The supervisor's
    /// watcher polls this so a dead capture gets rebuilt instead of silently
    /// going stale.
    pub fn is_alive(&self) -> bool {
        self.alive.load(Ordering::Relaxed)
    }
}

impl Drop for ProcessCapture {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
        if let Some(h) = self.handle.take() {
            let _ = h.join();
        }
    }
}

/// Start capturing `pid`'s audio (or everything *but* `pid`'s, when
/// `exclude`) into `buffer`. Returns once activation has succeeded or
/// failed, so the caller can fall back to the system mix synchronously.
#[cfg(target_os = "windows")]
pub fn start(
    pid: u32,
    exclude: bool,
    buffer: Arc<Mutex<Vec<f32>>>,
    ring_cap: usize,
) -> Result<ProcessCapture, String> {
    let stop = Arc::new(AtomicBool::new(false));
    let stop_thread = stop.clone();
    let alive = Arc::new(AtomicBool::new(true));
    let alive_thread = alive.clone();
    // Channel carries the activation result back so `start` reports failure
    // synchronously — the supervisor must know immediately whether to fall
    // back to the mix.
    let (tx, rx) = std::sync::mpsc::channel::<Result<(), String>>();
    let handle = std::thread::spawn(move || {
        let r = unsafe { winimpl::pump(pid, exclude, buffer, ring_cap, stop_thread, &tx) };
        // Cleared before anything else on the way out, so `is_alive` is false
        // the moment this capture stops feeding the ring — whether that was a
        // requested stop or a mid-stream device invalidation.
        alive_thread.store(false, Ordering::Relaxed);
        if let Err(e) = r {
            // If activation already reported Ok the receiver is gone by now
            // and this send is a no-op; the eprintln is what surfaces a
            // mid-stream failure.
            eprintln!("audio: process loopback pump ended: {e}");
            let _ = tx.send(Err(e));
        }
    });
    match rx.recv_timeout(std::time::Duration::from_secs(3)) {
        Ok(Ok(())) => Ok(ProcessCapture {
            stop,
            alive,
            handle: Some(handle),
        }),
        Ok(Err(e)) => {
            stop.store(true, Ordering::Relaxed);
            let _ = handle.join();
            Err(e)
        }
        Err(_) => {
            stop.store(true, Ordering::Relaxed);
            Err("process capture activation timed out".into())
        }
    }
}

#[cfg(not(target_os = "windows"))]
pub fn start(
    _pid: u32,
    _exclude: bool,
    _b: Arc<Mutex<Vec<f32>>>,
    _c: usize,
) -> Result<ProcessCapture, String> {
    Err("process loopback is Windows-only".into())
}

// ─── Ring-buffer writes ─────────────────────────────────────────────────────
// The same interleaved contract as `push_frames` in audio.rs: the ring holds
// L/R pairs ([l0, r0, l1, r1, ...]), `ring_cap` counts FRAMES, and mono is
// derived at drain. This backend used to average every frame down to one
// sample here — inside the capture path, before anything downstream could
// see it — which is why the vectorscope drew a vertical line (L == R) for
// every per-app source, however stereo (the 0.9.4 report).

#[cfg(any(target_os = "windows", test))]
fn push_stereo(data: &[f32], channels: usize, buffer: &Arc<Mutex<Vec<f32>>>, ring_cap: usize) {
    if channels == 0 {
        return; // a stream reporting no channels never completes a frame
    }
    let mut buf = buffer.lock();
    for frame in data.chunks_exact(channels) {
        // Mono duplicates into both; anything wider contributes FL/FR, the
        // standard interleave order — the same picks audio.rs `frame_lr`
        // makes at drain time.
        buf.push(frame[0]);
        buf.push(if channels == 1 { frame[0] } else { frame[1] });
    }
    trim_frames(&mut buf, ring_cap);
}

/// AUDCLNT_BUFFERFLAGS_SILENT means the packet's memory is undefined, not
/// zeroed — we must synthesize the silence ourselves or the FFT sees junk.
#[cfg(any(target_os = "windows", test))]
fn push_silence(frames: usize, buffer: &Arc<Mutex<Vec<f32>>>, ring_cap: usize) {
    let mut buf = buffer.lock();
    buf.extend(std::iter::repeat(0.0f32).take(frames * 2));
    trim_frames(&mut buf, ring_cap);
}

/// Drop the oldest samples once the ring exceeds `ring_cap` FRAMES. Always an
/// even count — an odd drain would swap L and R for the remainder of the
/// stream: silent, permanent, and invisible until someone opened a
/// vectorscope.
#[cfg(any(target_os = "windows", test))]
fn trim_frames(buf: &mut Vec<f32>, ring_cap: usize) {
    let cap = ring_cap * 2;
    if buf.len() > cap {
        let excess = buf.len() - cap;
        let drop = ((excess + 1) & !1).min(buf.len());
        buf.drain(..drop);
    }
}

#[cfg(target_os = "windows")]
mod winimpl {
    use super::{push_silence, push_stereo, CAPTURE_CHANNELS, CAPTURE_SAMPLE_RATE};
    use parking_lot::{Condvar, Mutex};
    use std::sync::{
        atomic::{AtomicBool, Ordering},
        mpsc::Sender,
        Arc,
    };
    use std::time::{Duration, Instant};
    use windows::core::{implement, IUnknown, Interface, HRESULT};
    use windows::Win32::Foundation::{CloseHandle, HANDLE, RPC_E_CHANGED_MODE, WAIT_FAILED};
    use windows::Win32::Media::Audio::{
        ActivateAudioInterfaceAsync, IActivateAudioInterfaceAsyncOperation,
        IActivateAudioInterfaceCompletionHandler, IActivateAudioInterfaceCompletionHandler_Impl,
        IAudioCaptureClient, IAudioClient, AUDCLNT_BUFFERFLAGS_SILENT, AUDCLNT_SHAREMODE_SHARED,
        AUDCLNT_STREAMFLAGS_EVENTCALLBACK, AUDCLNT_STREAMFLAGS_LOOPBACK,
        AUDIOCLIENT_ACTIVATION_PARAMS, AUDIOCLIENT_ACTIVATION_PARAMS_0,
        AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK, AUDIOCLIENT_PROCESS_LOOPBACK_PARAMS,
        PROCESS_LOOPBACK_MODE_EXCLUDE_TARGET_PROCESS_TREE,
        PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE, VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK,
        WAVEFORMATEX,
    };
    use windows::Win32::System::Com::{CoInitializeEx, CoUninitialize, COINIT_MULTITHREADED};
    use windows::Win32::System::Threading::{CreateEventW, WaitForSingleObject};

    /// `WAVE_FORMAT_IEEE_FLOAT` lives in the `Win32_Media_Multimedia` feature,
    /// which this crate doesn't otherwise need — the value is fixed by the
    /// mmreg.h ABI, so we inline it rather than pull in the whole module.
    const WAVE_FORMAT_IEEE_FLOAT: u16 = 3;
    /// `VT_BLOB` from wtypes.h. `windows_core::PROPVARIANT` is an opaque
    /// newtype with no public blob constructor, so we build the raw variant
    /// ourselves (see `BlobPropVariant`).
    const VT_BLOB: u16 = 65;

    // ---------------------------------------------------------------------
    // PROPVARIANT
    // ---------------------------------------------------------------------

    /// A `PROPVARIANT` holding a `VT_BLOB`, laid out by hand.
    ///
    /// `windows::core::PROPVARIANT` wraps a private `imp::PROPVARIANT` and
    /// exposes no way to construct a blob variant, and it runs
    /// `PropVariantClear` on drop — which would try to free our stack blob.
    /// So we declare the prefix of the real layout (the union's blob arm) and
    /// hand `ActivateAudioInterfaceAsync` a pointer to it. The callee only
    /// reads the variant; it never takes ownership.
    ///
    /// The const assertions below pin this to the real type's size/alignment
    /// so a layout change can't silently turn into memory corruption.
    #[repr(C)]
    #[derive(Clone, Copy)]
    struct Blob {
        cb_size: u32,
        p_blob_data: *mut u8,
    }

    #[repr(C)]
    #[derive(Clone, Copy)]
    struct BlobPropVariant {
        vt: u16,
        reserved1: u16,
        reserved2: u16,
        reserved3: u16,
        blob: Blob,
    }

    const _: () = assert!(
        std::mem::size_of::<BlobPropVariant>()
            == std::mem::size_of::<windows::core::PROPVARIANT>(),
        "BlobPropVariant no longer matches PROPVARIANT's size"
    );
    const _: () = assert!(
        std::mem::align_of::<BlobPropVariant>()
            == std::mem::align_of::<windows::core::PROPVARIANT>(),
        "BlobPropVariant no longer matches PROPVARIANT's alignment"
    );

    // ---------------------------------------------------------------------
    // Completion handler
    // ---------------------------------------------------------------------

    /// `ActivateAudioInterfaceAsync` completes on a COM-owned thread; this
    /// handler just flips a flag and wakes the pump thread, which then reads
    /// the real result out of `GetActivateResult`.
    #[implement(IActivateAudioInterfaceCompletionHandler)]
    struct ActivationHandler {
        done: Arc<(Mutex<bool>, Condvar)>,
    }

    // windows-rs 0.58 generates a wrapper type `<Name>_Impl` and requires the
    // `_Impl` trait on *that* type (it derefs to the inner struct). Later
    // releases moved the impl target back to the plain struct.
    impl IActivateAudioInterfaceCompletionHandler_Impl for ActivationHandler_Impl {
        fn ActivateCompleted(
            &self,
            _op: Option<&IActivateAudioInterfaceAsyncOperation>,
        ) -> windows::core::Result<()> {
            let (lock, cv) = &*self.done;
            *lock.lock() = true;
            cv.notify_all();
            Ok(())
        }
    }

    // ---------------------------------------------------------------------
    // Pump
    // ---------------------------------------------------------------------

    pub unsafe fn pump(
        pid: u32,
        exclude: bool,
        buffer: Arc<Mutex<Vec<f32>>>,
        ring_cap: usize,
        stop: Arc<AtomicBool>,
        tx: &Sender<Result<(), String>>,
    ) -> Result<(), String> {
        // MTA: the activation completion callback is delivered on a COM
        // worker thread and we block this one waiting for it, which would
        // deadlock an STA. Same RPC_E_CHANGED_MODE handling as mixer.rs —
        // that code means COM is already up on this thread and we took no
        // reference, so we must not pair it with CoUninitialize.
        let hr = CoInitializeEx(None, COINIT_MULTITHREADED);
        if hr.is_err() && hr != RPC_E_CHANGED_MODE {
            return Err(format!("CoInitializeEx: {}", hr.message()));
        }
        let owns_com = hr.is_ok();
        let result = capture_loop(pid, exclude, buffer, ring_cap, stop, tx);
        if owns_com {
            CoUninitialize();
        }
        result
    }

    unsafe fn capture_loop(
        pid: u32,
        exclude: bool,
        buffer: Arc<Mutex<Vec<f32>>>,
        ring_cap: usize,
        stop: Arc<AtomicBool>,
        tx: &Sender<Result<(), String>>,
    ) -> Result<(), String> {
        let client = activate(pid, exclude)?;

        let fmt = WAVEFORMATEX {
            wFormatTag: WAVE_FORMAT_IEEE_FLOAT,
            nChannels: CAPTURE_CHANNELS,
            nSamplesPerSec: CAPTURE_SAMPLE_RATE,
            wBitsPerSample: 32,
            nBlockAlign: CAPTURE_CHANNELS * 4,
            nAvgBytesPerSec: CAPTURE_SAMPLE_RATE * CAPTURE_CHANNELS as u32 * 4,
            cbSize: 0,
        };
        client
            .Initialize(
                AUDCLNT_SHAREMODE_SHARED,
                AUDCLNT_STREAMFLAGS_LOOPBACK | AUDCLNT_STREAMFLAGS_EVENTCALLBACK,
                2_000_000, // 200 ms buffer, in 100-ns units
                0,
                &fmt,
                None,
            )
            .map_err(|e| format!("IAudioClient::Initialize: {e}"))?;

        let event: HANDLE = CreateEventW(None, false, false, None)
            .map_err(|e| format!("CreateEventW: {e}"))?;
        // From here on `event` must be closed on every exit path, so the rest
        // runs inside a closure whose result we handle below.
        let r = (|| -> Result<(), String> {
            client
                .SetEventHandle(event)
                .map_err(|e| format!("SetEventHandle: {e}"))?;
            let capture: IAudioCaptureClient = client
                .GetService()
                .map_err(|e| format!("GetService(IAudioCaptureClient): {e}"))?;
            client.Start().map_err(|e| format!("IAudioClient::Start: {e}"))?;

            // Activation and initialization both succeeded — release `start`.
            let _ = tx.send(Ok(()));

            let channels = CAPTURE_CHANNELS as usize;
            while !stop.load(Ordering::Relaxed) {
                // A silent target process never signals the event, so the
                // 200 ms timeout is also what makes `stop` responsive.
                let wait = WaitForSingleObject(event, 200);
                if wait == WAIT_FAILED {
                    return Err(format!(
                        "WaitForSingleObject: {}",
                        windows::core::Error::from_win32()
                    ));
                }
                // Drain on the timeout path too, not just on the event. If the
                // endpoint ever stops signaling, polling every 200 ms still
                // keeps the WASAPI buffer from overflowing; when the event is
                // working this costs one extra GetNextPacketSize while idle.
                loop {
                    let frames_avail = capture
                        .GetNextPacketSize()
                        .map_err(|e| format!("GetNextPacketSize: {e}"))?;
                    if frames_avail == 0 {
                        break;
                    }
                    let mut data: *mut u8 = std::ptr::null_mut();
                    let mut frames: u32 = 0;
                    let mut flags: u32 = 0;
                    capture
                        .GetBuffer(&mut data, &mut frames, &mut flags, None, None)
                        .map_err(|e| format!("IAudioCaptureClient::GetBuffer: {e}"))?;
                    if frames > 0 {
                        if flags & AUDCLNT_BUFFERFLAGS_SILENT.0 as u32 != 0 {
                            push_silence(frames as usize, &buffer, ring_cap);
                        } else if !data.is_null() {
                            let samples = std::slice::from_raw_parts(
                                data as *const f32,
                                frames as usize * channels,
                            );
                            push_stereo(samples, channels, &buffer, ring_cap);
                        }
                    }
                    capture
                        .ReleaseBuffer(frames)
                        .map_err(|e| format!("IAudioCaptureClient::ReleaseBuffer: {e}"))?;
                }
            }
            Ok(())
        })();

        let _ = client.Stop();
        let _ = CloseHandle(event);
        r
    }

    /// Activate `IAudioClient` against the process-loopback virtual device.
    ///
    /// The call itself almost always returns S_OK — the real error (including
    /// "this Windows build has no process loopback") arrives via
    /// `GetActivateResult`, which is why that HRESULT is checked separately.
    unsafe fn activate(pid: u32, exclude: bool) -> Result<IAudioClient, String> {
        let mut params = AUDIOCLIENT_ACTIVATION_PARAMS {
            ActivationType: AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK,
            Anonymous: AUDIOCLIENT_ACTIVATION_PARAMS_0 {
                ProcessLoopbackParams: AUDIOCLIENT_PROCESS_LOOPBACK_PARAMS {
                    TargetProcessId: pid,
                    ProcessLoopbackMode: if exclude {
                        PROCESS_LOOPBACK_MODE_EXCLUDE_TARGET_PROCESS_TREE
                    } else {
                        PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE
                    },
                },
            },
        };
        let prop = BlobPropVariant {
            vt: VT_BLOB,
            reserved1: 0,
            reserved2: 0,
            reserved3: 0,
            blob: Blob {
                cb_size: std::mem::size_of::<AUDIOCLIENT_ACTIVATION_PARAMS>() as u32,
                p_blob_data: &mut params as *mut _ as *mut u8,
            },
        };

        let done = Arc::new((Mutex::new(false), Condvar::new()));
        let handler: IActivateAudioInterfaceCompletionHandler = ActivationHandler {
            done: done.clone(),
        }
        .into();

        let op = ActivateAudioInterfaceAsync(
            VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK,
            &IAudioClient::IID,
            Some(&prop as *const BlobPropVariant as *const windows::core::PROPVARIANT),
            &handler,
        )
        .map_err(|e| format!("ActivateAudioInterfaceAsync: {e}"))?;

        {
            let deadline = Instant::now() + Duration::from_secs(2);
            let mut g = done.0.lock();
            while !*g {
                if done.1.wait_until(&mut g, deadline).timed_out() {
                    break;
                }
            }
            if !*g {
                return Err("process loopback activation did not complete".into());
            }
        }

        let mut hr = HRESULT(0);
        let mut unknown: Option<IUnknown> = None;
        op.GetActivateResult(&mut hr, &mut unknown)
            .map_err(|e| format!("GetActivateResult: {e}"))?;
        hr.ok()
            .map_err(|e| format!("process loopback activation failed: {e}"))?;
        let unknown = unknown.ok_or_else(|| {
            "process loopback activation returned no interface".to_string()
        })?;
        unknown
            .cast::<IAudioClient>()
            .map_err(|e| format!("QueryInterface(IAudioClient): {e}"))
    }
}



#[cfg(test)]
mod tests {
    use super::*;

    fn ring() -> Arc<Mutex<Vec<f32>>> {
        Arc::new(Mutex::new(Vec::new()))
    }

    // The 0.9.4 stereo bug: this backend averaged every frame to mono before
    // the ring, so the vectorscope saw L == R for every per-app source. The
    // ring now carries the same interleaved contract as audio.rs push_frames.

    #[test]
    fn stereo_input_keeps_distinct_left_and_right() {
        let buf = ring();
        push_stereo(&[0.5, -0.5, 0.25, -0.25], 2, &buf, 16);
        assert_eq!(*buf.lock(), vec![0.5, -0.5, 0.25, -0.25]);
    }

    #[test]
    fn mono_input_duplicates_into_both_channels() {
        let buf = ring();
        push_stereo(&[0.3, -0.7], 1, &buf, 16);
        assert_eq!(*buf.lock(), vec![0.3, 0.3, -0.7, -0.7]);
    }

    #[test]
    fn surround_uses_the_first_two_channels() {
        let buf = ring();
        push_stereo(&[1.0, 2.0, 3.0, 4.0, 5.0, 6.0], 6, &buf, 16);
        assert_eq!(*buf.lock(), vec![1.0, 2.0]);
    }

    #[test]
    fn a_torn_trailing_frame_is_dropped_not_misaligned() {
        let buf = ring();
        push_stereo(&[0.1, 0.2, 0.9], 2, &buf, 16);
        assert_eq!(*buf.lock(), vec![0.1, 0.2]);
    }

    #[test]
    fn cap_counts_frames_and_trims_whole_frames_from_the_front() {
        let buf = ring();
        // Cap of 2 frames = 4 samples; 3 frames pushed → oldest frame gone,
        // and the drain is even so L/R stay aligned.
        push_stereo(&[0.1, -0.1, 0.2, -0.2, 0.3, -0.3], 2, &buf, 2);
        assert_eq!(*buf.lock(), vec![0.2, -0.2, 0.3, -0.3]);
    }

    #[test]
    fn silence_pushes_whole_stereo_frames() {
        let buf = ring();
        push_silence(3, &buf, 16);
        assert_eq!(*buf.lock(), vec![0.0; 6]);
    }

    #[test]
    fn zero_channels_pushes_nothing() {
        let buf = ring();
        push_stereo(&[0.5], 0, &buf, 16);
        assert!(buf.lock().is_empty());
    }
}

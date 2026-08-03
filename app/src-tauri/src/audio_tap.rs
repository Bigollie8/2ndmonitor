//! Per-app (and whole-system) capture via Core Audio process taps — the macOS
//! sibling of `audio_loopback.rs`.
//!
//! A tap is described by an Objective-C `CATapDescription` (macOS 14.2+),
//! turned into an `AudioObjectID` by `AudioHardwareCreateProcessTap`, and then
//! made readable by wrapping it in a *private* aggregate device that we install
//! an IOProc on. The IOProc downmixes to mono f32 and pushes into the same ring
//! buffer the cpal mix backend writes, so everything downstream — FFT, the 64
//! log bands, the `audio:spectrum` event, every visualizer — is identical
//! regardless of which backend is live.
//!
//! Structural differences from the Windows sibling, and why:
//!
//! * There is no pump thread. Core Audio owns the IO thread and calls our
//!   IOProc; `start` does all of its work synchronously on the caller's thread,
//!   so it already reports activation failure synchronously without needing a
//!   channel to carry the result back. The *contract* `audio.rs`'s supervisor
//!   depends on (fail fast, fall back to the mix) is the same.
//! * `is_alive` therefore can't key off "the pump returned". It keys off
//!   IOProc progress instead: Core Audio clocks the IO cycle off the aggregate
//!   device's main sub-device, so callbacks keep arriving whether or not the
//!   tapped processes are making noise, and callbacks *stopping* is what a dead
//!   device looks like from here.
//!
//! Two things in here would be catastrophic to get wrong and are called out at
//! their use sites: the tap's mute behaviour (a muted tap silences the user's
//! playback while we capture it) and the reported sample rate (`audio.rs`
//! derives its log band edges from it, so a wrong value silently misplaces
//! every frequency band).
//!
//! Everything below the FFI boundary is unverified at runtime by CI — CI only
//! proves this compiles and links. The tone test at the bottom is the thing
//! that proves capture actually works, and it is `#[ignore]`d so it only runs
//! when a human asks for it on a real Mac.

// `audio.rs`'s supervisor drives this module for both of its sources on macOS
// (a global tap for the mix, a per-process tap for an app), so `start`,
// `TapTarget`, `sample_rate` and `is_alive` are all live. The blanket allow
// stays for the FFI scaffolding underneath them — declared entry points and
// status constants that exist to document the ABI we depend on, whether or not
// every one is reached on a given path.
#![allow(dead_code)]

use core_foundation_sys::array::{kCFTypeArrayCallBacks, CFArrayCreate, CFArrayRef};
use core_foundation_sys::base::{kCFAllocatorDefault, CFIndex, CFRelease, CFTypeRef};
use core_foundation_sys::dictionary::{
    kCFTypeDictionaryKeyCallBacks, kCFTypeDictionaryValueCallBacks, CFDictionaryCreate,
    CFDictionaryRef,
};
use core_foundation_sys::number::{kCFNumberSInt32Type, CFNumberCreate, CFNumberRef};
use core_foundation_sys::string::{
    kCFStringEncodingUTF8, CFStringCreateWithCString, CFStringGetCString, CFStringGetCStringPtr,
    CFStringRef,
};
use coreaudio_sys::{
    kAudioDevicePropertyDeviceUID, kAudioDevicePropertyNominalSampleRate,
    kAudioHardwareNoError, kAudioHardwarePropertyDefaultOutputDevice,
    kAudioObjectPropertyElementMaster, kAudioObjectPropertyScopeGlobal, kAudioObjectSystemObject,
    AudioBuffer, AudioBufferList, AudioObjectGetPropertyData, AudioObjectID,
    AudioObjectPropertyAddress, AudioStreamBasicDescription, AudioTimeStamp,
};
use objc2::rc::{autoreleasepool, Retained};
use objc2::runtime::{AnyClass, AnyObject};
use objc2::{msg_send, sel};
use parking_lot::Mutex;
use std::ffi::{c_char, c_void, CStr, CString};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

// ---------------------------------------------------------------------------
// Raw Core Audio entry points
// ---------------------------------------------------------------------------
//
// `coreaudio-sys` runs bindgen over `<CoreAudio/CoreAudio.h>` in plain C mode.
// The tap API lives in `AudioHardwareTapping.h` behind `#if defined(__OBJC__)`
// (its first parameter is an Objective-C object), so those two functions are
// not in the generated bindings and we declare them ourselves. The aggregate
// and IOProc calls *are* generated, but bindgen's exact spelling of
// `AudioDeviceIOProcID` is an implementation detail of whichever SDK the CI
// runner has; declaring the whole family here keeps one reviewable list of the
// signatures we actually depend on, all taken from `<CoreAudio/AudioHardware.h>`.

/// `AudioDeviceIOProc` — the plain C callback form. The brief suggested
/// `AudioDeviceCreateIOProcIDWithBlock`, but that takes an Objective-C block,
/// which from Rust means pulling in `block2` and trusting a second ABI. The
/// function-pointer + `void*` form is the same HAL facility with a `void*`
/// context Rust can carry natively, so we use it and add no dependency.
type AudioDeviceIOProc = unsafe extern "C" fn(
    in_device: AudioObjectID,
    in_now: *const AudioTimeStamp,
    in_input_data: *const AudioBufferList,
    in_input_time: *const AudioTimeStamp,
    out_output_data: *mut AudioBufferList,
    in_output_time: *const AudioTimeStamp,
    in_client_data: *mut c_void,
) -> i32;

/// `typedef AudioDeviceIOProc AudioDeviceIOProcID;` — nullable, so `Option`,
/// which is ABI-identical to a nullable function pointer.
type AudioDeviceIOProcID = Option<AudioDeviceIOProc>;

#[link(name = "CoreAudio", kind = "framework")]
extern "C" {
    fn AudioHardwareCreateProcessTap(
        in_description: *mut AnyObject,
        out_tap_id: *mut AudioObjectID,
    ) -> i32;
    fn AudioHardwareDestroyProcessTap(in_tap_id: AudioObjectID) -> i32;
    fn AudioHardwareCreateAggregateDevice(
        in_description: CFDictionaryRef,
        out_device_id: *mut AudioObjectID,
    ) -> i32;
    fn AudioHardwareDestroyAggregateDevice(in_device_id: AudioObjectID) -> i32;
    fn AudioDeviceCreateIOProcID(
        in_device: AudioObjectID,
        in_proc: AudioDeviceIOProcID,
        in_client_data: *mut c_void,
        out_io_proc_id: *mut AudioDeviceIOProcID,
    ) -> i32;
    fn AudioDeviceDestroyIOProcID(
        in_device: AudioObjectID,
        in_io_proc_id: AudioDeviceIOProcID,
    ) -> i32;
    fn AudioDeviceStart(in_device: AudioObjectID, in_proc_id: AudioDeviceIOProcID) -> i32;
    fn AudioDeviceStop(in_device: AudioObjectID, in_proc_id: AudioDeviceIOProcID) -> i32;
}

/// Core Audio's four-character-code selectors, big-endian packed.
const fn fourcc(s: &[u8; 4]) -> u32 {
    ((s[0] as u32) << 24) | ((s[1] as u32) << 16) | ((s[2] as u32) << 8) | (s[3] as u32)
}

/// `kAudioTapPropertyFormat` — the tap object's `AudioStreamBasicDescription`.
/// Declared in the ObjC-only tapping header, so it isn't in the bindgen output
/// either; the selector value is fixed by the ABI.
const K_AUDIO_TAP_PROPERTY_FORMAT: u32 = fourcc(b"tfmt");

/// `kAudioFormatFlagIsFloat`.
const FORMAT_FLAG_IS_FLOAT: u32 = 1 << 0;

/// `kAudioHardwareIllegalOperationError` — the HAL's "you are not allowed to do
/// that", and so the status a denied audio-capture permission surfaces as.
const K_AUDIO_HARDWARE_ILLEGAL_OPERATION_ERROR: i32 = fourcc(b"nope") as i32;

// Aggregate-device description keys. These are `#define`d string literals in
// `<CoreAudio/AudioHardware.h>`, not enum constants, so no binding generator
// produces them — the strings themselves are the ABI.
const KEY_NAME: &str = "name"; // kAudioAggregateDeviceNameKey
const KEY_UID: &str = "uid"; // kAudioAggregateDeviceUIDKey
const KEY_MAIN_SUBDEVICE: &str = "master"; // kAudioAggregateDeviceMainSubDeviceKey
const KEY_IS_PRIVATE: &str = "private"; // kAudioAggregateDeviceIsPrivateKey
const KEY_IS_STACKED: &str = "stacked"; // kAudioAggregateDeviceIsStackedKey
const KEY_TAP_AUTO_START: &str = "tapautostart"; // kAudioAggregateDeviceTapAutoStartKey
const KEY_SUBDEVICE_LIST: &str = "subdevices"; // kAudioAggregateDeviceSubDeviceListKey
const KEY_SUBDEVICE_UID: &str = "uid"; // kAudioSubDeviceUIDKey
const KEY_TAP_LIST: &str = "taps"; // kAudioAggregateDeviceTapListKey
const KEY_SUBTAP_UID: &str = "uid"; // kAudioSubTapUIDKey
const KEY_SUBTAP_DRIFT: &str = "drift"; // kAudioSubTapDriftCompensationKey

/// Prefix of every UID this module gives one of its aggregate devices (the rest
/// is pid/timestamp/tap-id, to keep two live captures from colliding).
///
/// `mixer::devices_snapshot` filters on it: `kAudioAggregateDeviceIsPrivateKey`
/// hides the aggregate from *other* processes, not from the one that created
/// it, and in the shape-(a) path below the aggregate carries the default output
/// as a sub-device — so it presents output streams and would otherwise appear
/// in our own output-device picker while a capture is live. Selecting it there
/// would make a private aggregate whose IOProc zeroes its output buffers the
/// system default, i.e. silence.
pub const AGGREGATE_UID_PREFIX: &str = "com.secondmonitorhub.tap.";

/// Fallback when neither the tap nor the aggregate device will tell us its
/// rate. Only ever used after both queries have failed, and logged when it is.
const FALLBACK_SAMPLE_RATE: u32 = 48_000;

/// How long the IOProc may go without firing before `is_alive` calls the
/// capture dead. The supervisor watches on a 2 s tick, so this is two to three
/// polls — long enough to ride out a device format change, short enough that a
/// frozen visualizer gets rebuilt before it reads as broken.
const STALE_AFTER: Duration = Duration::from_secs(5);

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/// What the tap should listen to. `i32` is `pid_t`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TapTarget {
    /// The whole system mix. Expressed as a global tap that excludes nothing —
    /// there is no separate "tap everything" constructor, and a tap excluding
    /// the empty set *is* the system mix.
    AllProcesses,
    /// Only these processes — one tap for the whole `Source::Apps` include
    /// list. Core Audio mixes them for us, which is why macOS needs one tap
    /// where Windows needs one process-loopback client per app.
    Only(Vec<i32>),
    /// Everything except these processes.
    ///
    /// NOT reachable from the product model: 0.6.6 replaced
    /// `Source::{Only,Except}` with a strict include list, and `audio.rs`
    /// never constructs this. It stays because it is this module's own
    /// vocabulary — `AllProcesses` *is* `Except([])` at the Core Audio
    /// layer (see `create_tap`) — and because the hardware tone test uses it
    /// to prove the exclusion axis of the selector actually works. Do not
    /// resurface it as a user-facing source without a product decision.
    Except(Vec<i32>),
}

/// State the IOProc reads. Reached through a raw pointer handed to Core Audio
/// as the IOProc's client data; `TapCapture` holds the owning `Arc`, and its
/// `Drop` destroys the IOProc before the `Arc` is released, so the pointer can
/// never dangle. Moving the `Arc` into `TapCapture` does not move this
/// allocation, which is why taking the pointer before the move is sound.
struct Shared {
    buffer: Arc<Mutex<Vec<f32>>>,
    ring_cap: usize,
    /// Bumped once per IOProc invocation. The only thing the callback writes
    /// besides the ring, and the only evidence `is_alive` has.
    callbacks: AtomicU64,
}

pub struct TapCapture {
    shared: Arc<Shared>,
    /// Cleared first thing in `Drop`, mirroring the Windows sibling's ordering
    /// discipline: nothing may report this capture as live once teardown has
    /// begun.
    alive: AtomicBool,
    /// `(last observed callback count, when it last changed)`. Keeping the
    /// clock read here rather than in the IOProc leaves the audio callback
    /// doing one relaxed increment and nothing else.
    liveness: Mutex<(u64, Instant)>,
    sample_rate: u32,
    tap_id: AudioObjectID,
    aggregate_id: AudioObjectID,
    proc_id: AudioDeviceIOProcID,
}

impl TapCapture {
    /// The rate Core Audio actually chose for this tap — **not** an assumption.
    /// `audio.rs` derives its 64 log band edges from this, so reporting 48 kHz
    /// for a 44.1 kHz tap would silently misplace every band.
    pub fn sample_rate(&self) -> u32 {
        self.sample_rate
    }

    /// False once the IOProc has stopped feeding the ring, for any reason.
    ///
    /// Core Audio does not hand us an error channel for a device that dies
    /// underneath us (the tapped process quitting, the default output changing,
    /// the aggregate device being torn down by the HAL), and a dead device
    /// leaves the ring frozen on its last samples with the visualizer locked to
    /// a static frame. Callback progress is the signal we do have.
    ///
    /// This rests on an assumption we have not been able to verify on hardware:
    /// that the IO cycle is clocked by the aggregate's main sub-device and so
    /// keeps firing through silence, making a *stopped* callback mean a stopped
    /// device rather than a quiet one. If that turns out to be wrong the
    /// symptom is specific and recognisable — the supervisor rebuilding the
    /// capture every few seconds while nothing is playing — and the fix is to
    /// pin this to the `alive` flag alone.
    pub fn is_alive(&self) -> bool {
        if !self.alive.load(Ordering::Relaxed) {
            return false;
        }
        let n = self.shared.callbacks.load(Ordering::Relaxed);
        let mut seen = self.liveness.lock();
        if n != seen.0 {
            *seen = (n, Instant::now());
            return true;
        }
        seen.1.elapsed() < STALE_AFTER
    }
}

/// The supervisor in `audio.rs` moves its live backend between threads, so a
/// `TapCapture` that stopped being `Send` would fail there rather than here.
/// Nothing in it is thread-affine — the raw pointer Core Audio holds lives in
/// Core Audio, not in this struct — so pin that in at compile time.
const _: () = {
    fn assert_send_sync<T: Send + Sync>() {}
    fn assertion() {
        assert_send_sync::<TapCapture>();
    }
};

impl Drop for TapCapture {
    fn drop(&mut self) {
        // Order matters and is the mirror image of construction. Note that
        // nothing here touches the ring buffer's lock: the IOProc takes it on
        // every callback, so taking it here — while callbacks may still be in
        // flight — is the deadlock the Windows sibling documents. The `Arc` in
        // `shared` is released after this function returns, which is after
        // `AudioDeviceDestroyIOProcID` has guaranteed no callback can run.
        self.alive.store(false, Ordering::Relaxed);
        unsafe {
            if self.proc_id.is_some() {
                let st = AudioDeviceStop(self.aggregate_id, self.proc_id);
                if st != kAudioHardwareNoError as i32 {
                    eprintln!("audio: AudioDeviceStop failed ({})", status_text(st));
                }
                let st = AudioDeviceDestroyIOProcID(self.aggregate_id, self.proc_id);
                if st != kAudioHardwareNoError as i32 {
                    eprintln!(
                        "audio: AudioDeviceDestroyIOProcID failed ({})",
                        status_text(st)
                    );
                    // Destroying the IOProc is what guarantees no further
                    // callback can run. If that genuinely failed, the IOProc is
                    // still registered against `Shared` — releasing it here
                    // would hand Core Audio a pointer to freed memory. Leak an
                    // extra strong reference so the allocation outlives the
                    // process instead. A few hundred bytes lost on a path that
                    // should never happen is the cheap side of this trade.
                    std::mem::forget(self.shared.clone());
                }
            }
            if self.aggregate_id != 0 {
                let st = AudioHardwareDestroyAggregateDevice(self.aggregate_id);
                if st != kAudioHardwareNoError as i32 {
                    eprintln!(
                        "audio: AudioHardwareDestroyAggregateDevice failed ({})",
                        status_text(st)
                    );
                }
            }
            if self.tap_id != 0 {
                let st = AudioHardwareDestroyProcessTap(self.tap_id);
                if st != kAudioHardwareNoError as i32 {
                    eprintln!(
                        "audio: AudioHardwareDestroyProcessTap failed ({})",
                        status_text(st)
                    );
                }
            }
        }
    }
}

/// Build a tap for `target` and start feeding `buffer`. Returns once the tap,
/// the aggregate device and the IOProc all exist and are running, or with the
/// first failure — the supervisor needs to know synchronously whether to fall
/// back to the system mix.
pub fn start(
    target: TapTarget,
    buffer: Arc<Mutex<Vec<f32>>>,
    ring_cap: usize,
) -> Result<TapCapture, String> {
    // `Except(vec![])` is meaningful — it's the system mix, and `AllProcesses`
    // is spelled that way internally. `Only(vec![])` is not: it would build a
    // tap that captures nothing and looks alive doing it.
    if matches!(&target, TapTarget::Only(pids) if pids.is_empty()) {
        return Err("a tap on an empty process list would capture nothing".to_string());
    }
    unsafe {
        let tap_id = create_tap(&target)?;

        let aggregate_id = match create_aggregate_device(tap_id) {
            Ok(id) => id,
            Err(e) => {
                AudioHardwareDestroyProcessTap(tap_id);
                return Err(e);
            }
        };

        let sample_rate = match resolve_sample_rate(tap_id, aggregate_id) {
            Ok(rate) => rate,
            Err(e) => {
                AudioHardwareDestroyAggregateDevice(aggregate_id);
                AudioHardwareDestroyProcessTap(tap_id);
                return Err(e);
            }
        };

        let shared = Arc::new(Shared {
            buffer,
            ring_cap,
            callbacks: AtomicU64::new(0),
        });
        // Taken *before* `shared` moves into `TapCapture`. An `Arc`'s payload
        // lives on the heap, so moving the handle leaves this pointer valid.
        let client_data = Arc::as_ptr(&shared) as *mut c_void;

        let mut proc_id: AudioDeviceIOProcID = None;
        let st = AudioDeviceCreateIOProcID(
            aggregate_id,
            Some(io_proc),
            client_data,
            &mut proc_id as *mut _,
        );
        if st != kAudioHardwareNoError as i32 || proc_id.is_none() {
            AudioHardwareDestroyAggregateDevice(aggregate_id);
            AudioHardwareDestroyProcessTap(tap_id);
            return Err(format!(
                "AudioDeviceCreateIOProcID failed ({})",
                status_text(st)
            ));
        }

        let st = AudioDeviceStart(aggregate_id, proc_id);
        if st != kAudioHardwareNoError as i32 {
            AudioDeviceDestroyIOProcID(aggregate_id, proc_id);
            AudioHardwareDestroyAggregateDevice(aggregate_id);
            AudioHardwareDestroyProcessTap(tap_id);
            return Err(format!("AudioDeviceStart failed ({})", status_text(st)));
        }

        Ok(TapCapture {
            shared,
            alive: AtomicBool::new(true),
            liveness: Mutex::new((0, Instant::now())),
            sample_rate,
            tap_id,
            aggregate_id,
            proc_id,
        })
    }
}

// ---------------------------------------------------------------------------
// Ring-buffer writes
// ---------------------------------------------------------------------------

/// Most planes we'll read out of one `AudioBufferList`. A tap gives us one
/// interleaved buffer in practice; the cap only exists so the IOProc never
/// allocates. Anything beyond it is ignored rather than mishandled.
const MAX_PLANES: usize = 8;

/// Mono downmix + ring push, byte-for-byte the same contract as `push_mono` in
/// `audio.rs`: average the channels of each frame, append, and drain from the
/// front once the buffer is longer than the cap. A trailing partial frame is
/// dropped, exactly as `push_mono`'s `count == channels` gate drops it.
///
/// `planes` is `(samples, channels_in_that_plane)`. One plane with N channels
/// is the interleaved case and reduces to `push_mono` term for term; N planes
/// of one channel each is the non-interleaved case; the general loop covers
/// both without the callback having to branch on layout.
fn push_mono(planes: &[(&[f32], usize)], buffer: &Arc<Mutex<Vec<f32>>>, ring_cap: usize) {
    let total_channels: usize = planes.iter().map(|(_, ch)| *ch).sum();
    if total_channels == 0 {
        return;
    }
    let frames = planes
        .iter()
        .map(|(samples, ch)| samples.len() / ch)
        .min()
        .unwrap_or(0);
    if frames == 0 {
        return;
    }

    let mut buf = buffer.lock();
    for f in 0..frames {
        let mut pending = 0.0f32;
        for (samples, ch) in planes {
            let base = f * ch;
            for k in 0..*ch {
                pending += samples[base + k];
            }
        }
        buf.push(pending / total_channels as f32);
    }
    if buf.len() > ring_cap {
        let drop = buf.len() - ring_cap;
        buf.drain(..drop);
    }
}

/// Zero every buffer in an output `AudioBufferList`. Unlike the input path this
/// reads no channel counts and makes no layout assumptions — `mDataByteSize` is
/// the authority on how much memory is ours to clear, whatever is in it.
unsafe fn silence_output(list: *mut AudioBufferList) {
    if list.is_null() {
        return;
    }
    let n = (*list).mNumberBuffers as usize;
    if n == 0 {
        return;
    }
    let first: *mut AudioBuffer = (*list).mBuffers.as_mut_ptr();
    for i in 0..n {
        let b = &*first.add(i);
        if !b.mData.is_null() && b.mDataByteSize > 0 {
            std::ptr::write_bytes(b.mData as *mut u8, 0, b.mDataByteSize as usize);
        }
    }
}

/// The IO callback. Runs on Core Audio's real-time thread, so it allocates
/// nothing, blocks on nothing but the ring's (uncontended, microsecond-scale)
/// lock, and never unwinds.
unsafe extern "C" fn io_proc(
    _in_device: AudioObjectID,
    _in_now: *const AudioTimeStamp,
    in_input_data: *const AudioBufferList,
    _in_input_time: *const AudioTimeStamp,
    out_output_data: *mut AudioBufferList,
    _in_output_time: *const AudioTimeStamp,
    in_client_data: *mut c_void,
) -> i32 {
    // The aggregate device contains the default output as a sub-device, so it
    // carries that device's *output* streams and hands us buffers for them on
    // every cycle. We have nothing to play, and an IOProc that leaves output
    // buffers untouched is relying on the HAL to have zeroed them — if it has
    // not, whatever was in that memory goes to the speakers. Zero them
    // ourselves; it is a memset of a few hundred bytes per cycle and it makes
    // "the visualizer made a noise" impossible by construction.
    silence_output(out_output_data);

    if in_client_data.is_null() {
        return kAudioHardwareNoError as i32;
    }
    // SAFETY: `TapCapture` owns the `Arc` this points into and destroys the
    // IOProc before releasing it, so it is live for every call.
    let shared = &*(in_client_data as *const Shared);
    // Bumped even for an empty buffer list: the point is that the IO cycle is
    // still turning, which is exactly what `is_alive` asks.
    shared.callbacks.fetch_add(1, Ordering::Relaxed);

    if in_input_data.is_null() {
        return kAudioHardwareNoError as i32;
    }

    let n_buffers = (*in_input_data).mNumberBuffers as usize;
    if n_buffers == 0 {
        return kAudioHardwareNoError as i32;
    }
    let first: *const AudioBuffer = (*in_input_data).mBuffers.as_ptr();
    let buffers = std::slice::from_raw_parts(first, n_buffers.min(MAX_PLANES));

    let mut planes: [(&[f32], usize); MAX_PLANES] = [(&[][..], 0); MAX_PLANES];
    let mut count = 0usize;
    for b in buffers {
        let channels = b.mNumberChannels as usize;
        if channels == 0 || b.mData.is_null() {
            continue;
        }
        let samples = b.mDataByteSize as usize / std::mem::size_of::<f32>();
        if samples < channels {
            continue;
        }
        planes[count] = (
            std::slice::from_raw_parts(b.mData as *const f32, samples),
            channels,
        );
        count += 1;
    }
    if count > 0 {
        push_mono(&planes[..count], &shared.buffer, shared.ring_cap);
    }
    kAudioHardwareNoError as i32
}

// ---------------------------------------------------------------------------
// Tap creation (Objective-C)
// ---------------------------------------------------------------------------

/// `CATapMuteBehavior.CATapUnmuted`.
///
/// **This is the single most damaging constant in the file.** The other values
/// (`CATapMuted`, `CATapMutedWhenTapped`) silence the tapped processes' output
/// to the speakers while we capture — i.e. the visualizer would mute the user's
/// music. Unmuted is also the default, but we set it explicitly so a future
/// edit has to be deliberate.
const CA_TAP_UNMUTED: isize = 0;

/// Build the `CATapDescription` and hand it to `AudioHardwareCreateProcessTap`.
unsafe fn create_tap(target: &TapTarget) -> Result<AudioObjectID, String> {
    // Objective-C convenience constructors return autoreleased objects; without
    // a pool on this thread they would leak (and log about it).
    autoreleasepool(|_| {
        let cls = AnyClass::get("CATapDescription").ok_or_else(|| {
            "CATapDescription is unavailable — Core Audio process taps need macOS 14.2 or newer"
                .to_string()
        })?;

        // Empty list for AllProcesses: a global tap that excludes nothing is
        // the system mix.
        let pids: &[i32] = match target {
            TapTarget::AllProcesses => &[],
            TapTarget::Only(pids) => pids,
            TapTarget::Except(pids) => pids,
        };

        // `CATapDescription.processes` holds `AudioObjectID`s of Core Audio
        // *process objects*, not `pid_t`s. Both are NSNumbers in an NSArray, so
        // nothing — not the type system, not `responds_to` — catches the
        // difference; a raw PID just fails with '!obj' or, worse, matches
        // nothing at all, and then `Only` captures silence while `Except`
        // excludes no one. Translate first.
        //
        // A process with no audio object (`Ok(None)`) is not an error, it is an
        // app that is not currently playing — and the two targets want opposite
        // things from that:
        //
        //   Only  — an empty list would tap nothing, so this must fail and let
        //           the supervisor fall back to the mix.
        //   Except — dropping the pid excludes nothing, which is the same
        //           audio a mix fallback would give, except we keep the tap and
        //           will exclude the app the moment it starts playing again.
        //           Failing instead would be strictly worse: the user asks for
        //           "everything except Spotify" while Spotify is paused, we
        //           error, and the mix they land on *includes* Spotify as soon
        //           as it resumes.
        //
        // A translation call that actually fails is still fatal on every path —
        // that means the property read is wrong, and hiding it behind a log
        // line is how a broken selector survives to ship.
        let mut objects: Vec<AudioObjectID> = Vec::with_capacity(pids.len());
        for pid in pids {
            match translate_pid(*pid)? {
                Some(object) => objects.push(object),
                None if matches!(target, TapTarget::Only(_)) => {
                    return Err(format!(
                        "pid {pid} has no Core Audio process object — it is not playing (or has \
                         never played) any audio, so there is nothing to capture"
                    ));
                }
                None => eprintln!(
                    "audio: pid {pid} has no Core Audio process object (it is not playing right \
                     now), so it is not in the tap's exclusion list"
                ),
            }
        }

        let mut arena = CfArena::default();
        let numbers: Vec<CFTypeRef> = objects
            .iter()
            .map(|id| arena.number_i32(*id as i32) as CFTypeRef)
            .collect();
        let array = arena.array(&numbers)?;
        // CFArray and NSArray are toll-free bridged, and CFNumber/NSNumber
        // likewise, so this *is* the `NSArray<NSNumber *> *` the selectors want.
        let processes = array as *const AnyObject;

        let selector = match target {
            TapTarget::Only(_) => sel!(initStereoMixdownOfProcesses:),
            _ => sel!(initStereoGlobalTapButExcludeProcesses:),
        };
        if !cls.responds_to(selector) {
            // We cannot verify these selector names without a Mac, so if one is
            // wrong say so loudly and print what the class does have — that
            // turns a mystery failure on a user's machine into a one-line fix.
            log_init_selectors(cls);
            return Err(format!(
                "CATapDescription does not respond to -{} — this macOS version's tap API differs \
                 from the one we build against",
                selector.name()
            ));
        }
        if !cls.responds_to(sel!(setMuteBehavior:)) {
            return Err("CATapDescription does not respond to -setMuteBehavior:, so we cannot \
                        guarantee capturing will not mute playback — refusing to create the tap"
                .to_string());
        }

        let allocated: *mut AnyObject = msg_send![cls, alloc];
        let raw: *mut AnyObject = match target {
            TapTarget::Only(_) => msg_send![allocated, initStereoMixdownOfProcesses: processes],
            _ => msg_send![allocated, initStereoGlobalTapButExcludeProcesses: processes],
        };
        // Takes ownership of the +1 the init family returns, so the description
        // is released when `desc` goes out of scope — after the tap is made,
        // which is the only point it is needed for.
        let desc = Retained::from_raw(raw)
            .ok_or_else(|| "CATapDescription initialisation returned nil".to_string())?;

        // Do not mute the tapped processes. See CA_TAP_UNMUTED.
        let _: () = msg_send![&*desc, setMuteBehavior: CA_TAP_UNMUTED];
        if cls.responds_to(sel!(setName:)) {
            let name = arena.string("Second-Monitor Hub Capture");
            let _: () = msg_send![&*desc, setName: name as *const AnyObject];
        }

        let mut tap_id: AudioObjectID = 0;
        let st =
            AudioHardwareCreateProcessTap(&*desc as *const AnyObject as *mut AnyObject, &mut tap_id);
        if st != kAudioHardwareNoError as i32 || tap_id == 0 {
            // Only 'nope' actually means "the system refused you", which is what
            // a denied audio-capture permission looks like. Blaming permission
            // for *every* status was actively misleading — a bad-object error
            // from a malformed process list would have been reported as a
            // permission denial, sending the user to a settings pane that was
            // never the problem. `status_text` renders the fourcc either way.
            if st == K_AUDIO_HARDWARE_ILLEGAL_OPERATION_ERROR {
                return Err(format!(
                    "AudioHardwareCreateProcessTap was refused ({}). This is what a denied audio \
                     capture permission looks like — allow it under System Settings > Privacy & \
                     Security > Audio Recording (a reset with `tccutil reset AudioCapture` makes \
                     macOS ask again), then re-select the source.",
                    status_text(st)
                ));
            }
            return Err(format!(
                "AudioHardwareCreateProcessTap failed ({})",
                status_text(st)
            ));
        }
        Ok(tap_id)
    })
}

/// `pid_t` → the `AudioObjectID` of that process's Core Audio process object,
/// via `kAudioHardwarePropertyTranslatePIDToProcessObject` ('id2p') on the
/// system object.
///
/// **This is the only property read in the file that passes qualifier data.**
/// Every other one passes `0, null()`; here the PID goes in as the qualifier
/// and the object id comes back as the value, so do not pattern-match this off
/// the others.
///
/// `Ok(None)` means the translation worked and the answer was "this process has
/// no audio object" — a normal state for an app that is not playing, which the
/// caller interprets differently for `Only` than for `Except`. `Err` is
/// reserved for the property read itself failing.
unsafe fn translate_pid(pid: i32) -> Result<Option<AudioObjectID>, String> {
    let addr = global_address(fourcc(b"id2p"));
    let mut object: AudioObjectID = 0;
    let mut size = std::mem::size_of::<AudioObjectID>() as u32;
    let st = AudioObjectGetPropertyData(
        kAudioObjectSystemObject,
        &addr as *const _,
        std::mem::size_of::<i32>() as u32,
        &pid as *const i32 as *const c_void,
        &mut size as *mut _,
        &mut object as *mut AudioObjectID as *mut c_void,
    );
    if st != kAudioHardwareNoError as i32 {
        return Err(format!(
            "could not translate pid {pid} to a Core Audio process object ({})",
            status_text(st)
        ));
    }
    if object == 0 {
        return Ok(None);
    }
    Ok(Some(object))
}

/// Dump the class's `init...` selectors to stderr. Only called when an expected
/// selector is missing, which is a situation we cannot reproduce locally.
fn log_init_selectors(cls: &AnyClass) {
    let names: Vec<String> = cls
        .instance_methods()
        .iter()
        .map(|m| m.name().name().to_string())
        .filter(|n| n.starts_with("init"))
        .collect();
    eprintln!("audio: CATapDescription initialisers present: {names:?}");
}

// ---------------------------------------------------------------------------
// Aggregate device
// ---------------------------------------------------------------------------

/// Wrap `tap_id` in a private aggregate device so an IOProc can read it.
///
/// Private (`kAudioAggregateDeviceIsPrivateKey = 1`) means the device is
/// visible only to this process: it never shows up in the user's Sound settings
/// or in any other app's device list, and it disappears with us.
unsafe fn create_aggregate_device(tap_id: AudioObjectID) -> Result<AudioObjectID, String> {
    let tap_uid = read_tap_uid(tap_id)?;
    let mut arena = CfArena::default();

    // Every CF object is built into a local first: `arena.dictionary(..)` takes
    // `&mut self`, and evaluating the receiver before the arguments would
    // overlap with any `arena.string(..)` written inline in them.

    // The sub-tap entry: which tap, and let the HAL drift-compensate it against
    // the aggregate's clock.
    let k_subtap_uid = arena.string(KEY_SUBTAP_UID) as CFTypeRef;
    let v_subtap_uid = arena.string(&tap_uid) as CFTypeRef;
    let k_subtap_drift = arena.string(KEY_SUBTAP_DRIFT) as CFTypeRef;
    let v_subtap_drift = arena.number_i32(1) as CFTypeRef;
    let sub_tap = arena.dictionary(&[
        (k_subtap_uid, v_subtap_uid),
        (k_subtap_drift, v_subtap_drift),
    ])? as CFTypeRef;
    let tap_list = arena.array(&[sub_tap])? as CFTypeRef;

    // A unique UID per aggregate, so two captures (or a stale one the HAL
    // hasn't reaped yet) can never collide on the same device. The shared
    // prefix is what `mixer::devices_snapshot` filters on — see
    // AGGREGATE_UID_PREFIX.
    let uid = format!(
        "{AGGREGATE_UID_PREFIX}{}.{}.{tap_id}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0),
    );

    let k_name = arena.string(KEY_NAME) as CFTypeRef;
    let v_name = arena.string("Second-Monitor Hub Capture") as CFTypeRef;
    let k_uid = arena.string(KEY_UID) as CFTypeRef;
    let v_uid = arena.string(&uid) as CFTypeRef;
    let k_private = arena.string(KEY_IS_PRIVATE) as CFTypeRef;
    let v_private = arena.number_i32(1) as CFTypeRef;
    let k_stacked = arena.string(KEY_IS_STACKED) as CFTypeRef;
    let v_stacked = arena.number_i32(0) as CFTypeRef;
    let k_auto_start = arena.string(KEY_TAP_AUTO_START) as CFTypeRef;
    let v_auto_start = arena.number_i32(1) as CFTypeRef;
    let k_taps = arena.string(KEY_TAP_LIST) as CFTypeRef;

    let mut entries: Vec<(CFTypeRef, CFTypeRef)> = vec![
        (k_name, v_name),
        (k_uid, v_uid),
        (k_private, v_private),
        (k_stacked, v_stacked),
        (k_auto_start, v_auto_start),
        (k_taps, tap_list),
    ];

    // Two shapes are known to work, and they are not interchangeable in halves:
    //
    //   a) main sub-device = the default output's UID, *and* that same device
    //      present in the sub-device list — the aggregate contains a real
    //      device, which clocks the IO cycle;
    //   b) tap list only — no main sub-device and no sub-device list at all,
    //      leaving the tap itself to drive the cycle.
    //
    // Naming a main sub-device that is not in the sub-device list is neither,
    // and the HAL is entitled to reject it or to build a device with no clock
    // that never fires a callback. Take (a) when the default output's UID is
    // readable and fall back to (b) — whole — when it is not.
    match read_default_output_uid() {
        Some(device_uid) => {
            let k_main = arena.string(KEY_MAIN_SUBDEVICE) as CFTypeRef;
            let v_main = arena.string(&device_uid) as CFTypeRef;
            let k_sub_uid = arena.string(KEY_SUBDEVICE_UID) as CFTypeRef;
            let v_sub_uid = arena.string(&device_uid) as CFTypeRef;
            let sub_device = arena.dictionary(&[(k_sub_uid, v_sub_uid)])? as CFTypeRef;
            let sub_devices = arena.array(&[sub_device])? as CFTypeRef;
            let k_subdevices = arena.string(KEY_SUBDEVICE_LIST) as CFTypeRef;
            entries.push((k_main, v_main));
            entries.push((k_subdevices, sub_devices));
        }
        None => eprintln!(
            "audio: could not read the default output device's UID; building the tap's aggregate \
             device with no sub-devices and letting the tap clock it"
        ),
    }

    let description = arena.dictionary(&entries)?;
    let mut device_id: AudioObjectID = 0;
    let st = AudioHardwareCreateAggregateDevice(description, &mut device_id as *mut _);
    if st != kAudioHardwareNoError as i32 || device_id == 0 {
        return Err(format!(
            "AudioHardwareCreateAggregateDevice failed ({})",
            status_text(st)
        ));
    }
    Ok(device_id)
}

/// `kAudioTapPropertyUID` — the string an aggregate device's tap list uses to
/// name this tap. Another four-character selector that only exists in the
/// Objective-C-only tapping header, hence the literal.
unsafe fn read_tap_uid(tap_id: AudioObjectID) -> Result<String, String> {
    let addr = global_address(fourcc(b"tuid"));
    let mut uid: CFStringRef = std::ptr::null();
    let mut size = std::mem::size_of::<CFStringRef>() as u32;
    let st = AudioObjectGetPropertyData(
        tap_id,
        &addr as *const _,
        0,
        std::ptr::null(),
        &mut size as *mut _,
        &mut uid as *mut CFStringRef as *mut c_void,
    );
    if st != kAudioHardwareNoError as i32 || uid.is_null() {
        return Err(format!(
            "could not read the tap's UID ({}) — it cannot be attached to an aggregate device",
            status_text(st)
        ));
    }
    let s = cf_string_to_rust(uid);
    CFRelease(uid as CFTypeRef);
    s.ok_or_else(|| "the tap's UID was not decodable as UTF-8".to_string())
}

/// UID of the current default output device. Used twice by the aggregate
/// description — as the main sub-device *and* as the single entry in the
/// sub-device list — because those two keys have to agree. `None` on any
/// failure, which makes the caller switch to the tap-list-only shape rather
/// than emit half of this one.
unsafe fn read_default_output_uid() -> Option<String> {
    let addr = global_address(kAudioHardwarePropertyDefaultOutputDevice);
    let mut device: AudioObjectID = 0;
    let mut size = std::mem::size_of::<AudioObjectID>() as u32;
    let st = AudioObjectGetPropertyData(
        kAudioObjectSystemObject,
        &addr as *const _,
        0,
        std::ptr::null(),
        &mut size as *mut _,
        &mut device as *mut AudioObjectID as *mut c_void,
    );
    if st != kAudioHardwareNoError as i32 || device == 0 {
        return None;
    }

    let addr = global_address(kAudioDevicePropertyDeviceUID);
    let mut uid: CFStringRef = std::ptr::null();
    let mut size = std::mem::size_of::<CFStringRef>() as u32;
    let st = AudioObjectGetPropertyData(
        device,
        &addr as *const _,
        0,
        std::ptr::null(),
        &mut size as *mut _,
        &mut uid as *mut CFStringRef as *mut c_void,
    );
    if st != kAudioHardwareNoError as i32 || uid.is_null() {
        return None;
    }
    let s = cf_string_to_rust(uid);
    CFRelease(uid as CFTypeRef);
    s
}

// ---------------------------------------------------------------------------
// Format and sample rate
// ---------------------------------------------------------------------------

/// Read the tap's `AudioStreamBasicDescription`, **require** it to be 32-bit
/// float, and derive the sample rate from it.
///
/// The format check is not optional and has no fallback, because `io_proc`
/// unconditionally reinterprets `mData` as `*const f32`. If we cannot prove the
/// tap produces float32 we must not read it at all — the reads stay in bounds
/// either way (`mDataByteSize` bounds them), but integer samples reinterpreted
/// as floats are denormal noise, and noise in the FFT is far harder to diagnose
/// than a refusal at startup that the supervisor turns into a fall-back-to-mix
/// with a printed reason.
///
/// Only the *rate* has a fallback, and only once the format is known good.
/// That matters: `audio.rs` computes its 64 log-spaced band edges from whatever
/// rate we report, so a wrong number breaks nothing visibly — it just puts
/// every band at the wrong frequency.
unsafe fn resolve_sample_rate(
    tap_id: AudioObjectID,
    aggregate_id: AudioObjectID,
) -> Result<u32, String> {
    let addr = global_address(K_AUDIO_TAP_PROPERTY_FORMAT);
    let mut asbd = AudioStreamBasicDescription::default();
    let mut size = std::mem::size_of::<AudioStreamBasicDescription>() as u32;
    let st = AudioObjectGetPropertyData(
        tap_id,
        &addr as *const _,
        0,
        std::ptr::null(),
        &mut size as *mut _,
        &mut asbd as *mut AudioStreamBasicDescription as *mut c_void,
    );
    if st != kAudioHardwareNoError as i32 {
        return Err(format!(
            "could not read the tap's stream format ({}), so there is no way to know how to \
             interpret its samples",
            status_text(st)
        ));
    }
    // Both conditions are positive assertions rather than "not obviously
    // wrong". An earlier version skipped the check when `mFormatFlags == 0`,
    // which is exactly what a packed-integer descriptor reports — the hole let
    // through the one case the check existed for.
    if asbd.mFormatFlags & FORMAT_FLAG_IS_FLOAT == 0 {
        return Err(format!(
            "the tap's format is not floating point (flags {:#x}); this backend only reads \
             32-bit float",
            asbd.mFormatFlags
        ));
    }
    if asbd.mBitsPerChannel != 32 {
        return Err(format!(
            "the tap's format is {} bits per channel; this backend only reads 32-bit float",
            asbd.mBitsPerChannel
        ));
    }

    if asbd.mSampleRate > 0.0 {
        return Ok(asbd.mSampleRate.round() as u32);
    }

    let addr = global_address(kAudioDevicePropertyNominalSampleRate);
    let mut rate: f64 = 0.0;
    let mut size = std::mem::size_of::<f64>() as u32;
    let st = AudioObjectGetPropertyData(
        aggregate_id,
        &addr as *const _,
        0,
        std::ptr::null(),
        &mut size as *mut _,
        &mut rate as *mut f64 as *mut c_void,
    );
    if st == kAudioHardwareNoError as i32 && rate > 0.0 {
        eprintln!(
            "audio: the tap reported no sample rate; using the aggregate device's nominal rate \
             of {rate} Hz"
        );
        return Ok(rate.round() as u32);
    }

    eprintln!(
        "audio: neither the tap nor its aggregate device reported a sample rate; assuming \
         {FALLBACK_SAMPLE_RATE} Hz, so the spectrum's band frequencies may be wrong"
    );
    Ok(FALLBACK_SAMPLE_RATE)
}

// ---------------------------------------------------------------------------
// Core Foundation helpers
// ---------------------------------------------------------------------------

/// Everything created here is `CFRelease`d when the arena drops. `CFDictionary`
/// and `CFArray` retain what they are given, so releasing the pieces after the
/// container is built (and after the container has been handed to Core Audio,
/// which retains it in turn) is correct.
#[derive(Default)]
struct CfArena {
    owned: Vec<CFTypeRef>,
}

impl CfArena {
    fn keep(&mut self, obj: CFTypeRef) -> CFTypeRef {
        if !obj.is_null() {
            self.owned.push(obj);
        }
        obj
    }

    fn string(&mut self, s: &str) -> CFStringRef {
        let Ok(c) = CString::new(s) else {
            return std::ptr::null();
        };
        let r = unsafe {
            CFStringCreateWithCString(kCFAllocatorDefault, c.as_ptr(), kCFStringEncodingUTF8)
        };
        self.keep(r as CFTypeRef);
        r
    }

    fn number_i32(&mut self, v: i32) -> CFNumberRef {
        let r = unsafe {
            CFNumberCreate(
                kCFAllocatorDefault,
                kCFNumberSInt32Type,
                &v as *const i32 as *const c_void,
            )
        };
        self.keep(r as CFTypeRef);
        r
    }

    fn array(&mut self, values: &[CFTypeRef]) -> Result<CFArrayRef, String> {
        let r = unsafe {
            CFArrayCreate(
                kCFAllocatorDefault,
                values.as_ptr() as *const *const c_void,
                values.len() as CFIndex,
                &kCFTypeArrayCallBacks,
            )
        };
        self.keep(r as CFTypeRef);
        if r.is_null() {
            return Err("CFArrayCreate returned null".to_string());
        }
        Ok(r)
    }

    fn dictionary(&mut self, entries: &[(CFTypeRef, CFTypeRef)]) -> Result<CFDictionaryRef, String> {
        if entries.iter().any(|(k, v)| k.is_null() || v.is_null()) {
            return Err("could not build the aggregate device description".to_string());
        }
        let keys: Vec<*const c_void> = entries.iter().map(|(k, _)| *k).collect();
        let values: Vec<*const c_void> = entries.iter().map(|(_, v)| *v).collect();
        let r = unsafe {
            CFDictionaryCreate(
                kCFAllocatorDefault,
                keys.as_ptr(),
                values.as_ptr(),
                entries.len() as CFIndex,
                &kCFTypeDictionaryKeyCallBacks,
                &kCFTypeDictionaryValueCallBacks,
            )
        };
        self.keep(r as CFTypeRef);
        if r.is_null() {
            return Err("CFDictionaryCreate returned null".to_string());
        }
        Ok(r)
    }
}

impl Drop for CfArena {
    fn drop(&mut self) {
        for obj in self.owned.drain(..) {
            unsafe { CFRelease(obj) };
        }
    }
}

/// Same two-step CFString read `mixer.rs` uses: try the zero-copy pointer, fall
/// back to the always-correct copy.
unsafe fn cf_string_to_rust(s: CFStringRef) -> Option<String> {
    if s.is_null() {
        return None;
    }
    let ptr = CFStringGetCStringPtr(s, kCFStringEncodingUTF8);
    if !ptr.is_null() {
        return CStr::from_ptr(ptr).to_str().ok().map(|s| s.to_string());
    }
    let mut buf = [0 as c_char; 512];
    let ok = CFStringGetCString(
        s,
        buf.as_mut_ptr(),
        buf.len() as CFIndex,
        kCFStringEncodingUTF8,
    );
    if ok != 0 {
        Some(CStr::from_ptr(buf.as_ptr()).to_string_lossy().into_owned())
    } else {
        None
    }
}

fn global_address(selector: u32) -> AudioObjectPropertyAddress {
    AudioObjectPropertyAddress {
        mSelector: selector,
        mScope: kAudioObjectPropertyScopeGlobal,
        mElement: kAudioObjectPropertyElementMaster,
    }
}

/// Core Audio's `OSStatus` values are usually four-character codes, which are
/// far easier to look up than the signed integer they print as. Render both.
fn status_text(status: i32) -> String {
    let bytes = (status as u32).to_be_bytes();
    if bytes.iter().all(|b| (0x20..0x7f).contains(b)) {
        format!("OSStatus {status} '{}'", String::from_utf8_lossy(&bytes))
    } else {
        format!("OSStatus {status}")
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    /// Guards the one thing every backend must agree on. `audio.rs`'s cpal
    /// `push_mono` averages a frame's channels, appends, and drains from the
    /// front over the cap; this reimplements it for `AudioBufferList` layouts,
    /// so it has to agree term for term. Unlike the tone test below, this runs
    /// on CI.
    #[test]
    fn downmix_matches_the_cpal_backend() {
        // One interleaved stereo plane: each frame is the mean of its pair.
        let samples = [1.0f32, 0.0, 0.5, 0.5, -1.0, 1.0];
        let buffer = Arc::new(Mutex::new(Vec::new()));
        push_mono(&[(&samples[..], 2)], &buffer, 64);
        assert_eq!(*buffer.lock(), vec![0.5, 0.5, 0.0]);

        // Two mono planes (non-interleaved) must give the same answer as the
        // interleaved form of the same audio.
        let left = [1.0f32, 0.5, -1.0];
        let right = [0.0f32, 0.5, 1.0];
        let buffer = Arc::new(Mutex::new(Vec::new()));
        push_mono(&[(&left[..], 1), (&right[..], 1)], &buffer, 64);
        assert_eq!(*buffer.lock(), vec![0.5, 0.5, 0.0]);

        // A trailing partial frame is dropped, as `push_mono`'s
        // `count == channels` gate drops it.
        let odd = [1.0f32, 1.0, 1.0];
        let buffer = Arc::new(Mutex::new(Vec::new()));
        push_mono(&[(&odd[..], 2)], &buffer, 64);
        assert_eq!(*buffer.lock(), vec![1.0]);

        // Over the cap, the *oldest* samples go.
        let buffer = Arc::new(Mutex::new(vec![9.0f32; 4]));
        let mono = [1.0f32, 2.0, 3.0];
        push_mono(&[(&mono[..], 1)], &buffer, 4);
        assert_eq!(*buffer.lock(), vec![9.0, 1.0, 2.0, 3.0]);
    }

    /// The empty-`Only` guard rejects before any FFI happens, so this is safe
    /// to run on a CI runner with no audio hardware and no tap permission.
    #[test]
    fn a_tap_on_no_processes_is_rejected() {
        let buffer = Arc::new(Mutex::new(Vec::new()));
        // Not `unwrap_err`: `TapCapture` is deliberately not `Debug` (it holds
        // opaque Core Audio handles), so match the result instead.
        match start(TapTarget::Only(vec![]), buffer, 1024) {
            Ok(_) => panic!("a tap on an empty process list was accepted"),
            Err(e) => assert!(e.contains("capture nothing"), "unexpected error: {e}"),
        }
    }

    /// A 440 Hz sine at 0.25 amplitude out of the default output device, from
    /// *this* process — the signal the tap is supposed to find (and, in the
    /// second half of the test, supposed to miss).
    fn play_tone() -> Result<cpal::Stream, String> {
        use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};

        let device = cpal::default_host()
            .default_output_device()
            .ok_or_else(|| "no default output device".to_string())?;
        let supported = device
            .default_output_config()
            .map_err(|e| format!("default_output_config: {e}"))?;
        if supported.sample_format() != cpal::SampleFormat::F32 {
            return Err(format!(
                "this test only emits f32; the default output is {:?}",
                supported.sample_format()
            ));
        }
        let config: cpal::StreamConfig = supported.config();
        let channels = config.channels as usize;
        let step = 2.0 * std::f32::consts::PI * 440.0 / config.sample_rate.0 as f32;
        let mut phase = 0.0f32;

        let stream = device
            .build_output_stream(
                &config,
                move |data: &mut [f32], _: &cpal::OutputCallbackInfo| {
                    for frame in data.chunks_mut(channels) {
                        let s = phase.sin() * 0.25;
                        phase += step;
                        for sample in frame.iter_mut() {
                            *sample = s;
                        }
                    }
                },
                |e| eprintln!("tone stream error: {e}"),
                None,
            )
            .map_err(|e| format!("build_output_stream: {e}"))?;
        stream.play().map_err(|e| format!("play: {e}"))?;
        Ok(stream)
    }

    /// The self-proving test: does a tap actually capture what it says it will?
    ///
    /// **Keep this.** CI compiles this file but can never run it — the runner
    /// has no audio device and no way to grant audio-capture permission — so
    /// this is the only thing that can tell you the backend works. Run it on a
    /// Mac, with the volume up, after granting the permission:
    ///
    /// ```text
    /// cargo test --lib audio_tap -- --ignored --nocapture
    /// ```
    ///
    /// Note what the second half does *not* assert. "Except us" is not silence:
    /// Spotify, a browser tab, a notification chime may all legitimately be
    /// playing, so the *contents* of that buffer prove nothing either way. The
    /// assertion is only that *our* 0.25-amplitude tone is absent — which is
    /// why the same threshold is used for both directions.
    ///
    /// What it does assert is that samples arrived at all. That check has to be
    /// on the ring, not on `is_alive()`: `is_alive` reports true for the first
    /// `STALE_AFTER` (5 s) after `start` regardless of whether a single
    /// callback has fired, and this test measures at 1.2 s — so it would have
    /// returned true in both the working and the broken case. A live tap pushes
    /// digital silence as real zero *samples*, so a non-empty ring is the
    /// signal that actually distinguishes "quiet" from "dead".
    #[test]
    #[ignore = "needs a real Mac with audio-capture permission granted; run with --ignored"]
    fn tap_hears_our_tone_and_the_exclusion_does_not() {
        const RING: usize = 48_000;
        let own_pid = std::process::id() as i32;

        let _tone = play_tone().expect("could not emit the test tone");
        std::thread::sleep(Duration::from_millis(500));

        // Only us: our tone must be there.
        let buffer = Arc::new(Mutex::new(Vec::<f32>::new()));
        let capture = start(TapTarget::Only(vec![own_pid]), buffer.clone(), RING)
            .expect("could not start a tap on our own process");
        std::thread::sleep(Duration::from_millis(500));
        buffer.lock().clear();
        std::thread::sleep(Duration::from_millis(700));
        let (inclusive_peak, inclusive_samples) = {
            let buf = buffer.lock();
            (
                buf.iter().fold(0.0f32, |m, s| m.max(s.abs())),
                buf.len(),
            )
        };
        println!(
            "tap sample rate: {} Hz, {inclusive_samples} samples in 700 ms, peak with our \
             process included: {inclusive_peak}",
            capture.sample_rate()
        );
        drop(capture);
        assert!(
            inclusive_samples > 0,
            "a tap on our own process delivered no samples at all in 700 ms — the IOProc never \
             fired, so nothing below this line would have meant anything"
        );
        assert!(
            inclusive_peak > 0.15,
            "a tap on our own process did not hear our 0.25-amplitude tone (peak {inclusive_peak})"
        );

        // Everything but us: our tone must not be there.
        let buffer = Arc::new(Mutex::new(Vec::<f32>::new()));
        let capture = start(TapTarget::Except(vec![own_pid]), buffer.clone(), RING)
            .expect("could not start a tap excluding our own process");
        std::thread::sleep(Duration::from_millis(500));
        buffer.lock().clear();
        std::thread::sleep(Duration::from_millis(700));
        // The sample count is what makes the peak assertion mean anything. A
        // tap that produces nothing at all — the exact failure this test exists
        // to catch — satisfies `peak < 0.15` vacuously, and `is_alive()` cannot
        // rule it out this early (see the doc comment). The inclusive half is
        // self-protecting because it asserts a peak is *present*; this half has
        // to check the ring directly.
        let (exclusive_peak, exclusive_samples) = {
            let buf = buffer.lock();
            (
                buf.iter().fold(0.0f32, |m, s| m.max(s.abs())),
                buf.len(),
            )
        };
        println!(
            "{exclusive_samples} samples in 700 ms, peak with our process excluded: \
             {exclusive_peak}"
        );
        drop(capture);
        assert!(
            exclusive_samples > 0,
            "the excluding tap delivered no samples at all in 700 ms, so a low peak proves \
             nothing — it was not capturing"
        );
        assert!(
            exclusive_peak < 0.15,
            "a tap excluding our own process still heard our tone (peak {exclusive_peak}) — \
             stop any other audio and re-run if something else was playing"
        );
    }
}

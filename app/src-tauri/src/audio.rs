//! WASAPI loopback capture → FFT → log-spaced spectrum bands → Tauri events.
//!
//! On Windows, `cpal::Device::build_input_stream` on the default *output*
//! device transparently switches to WASAPI loopback mode, which captures the
//! mix that's currently being sent to speakers. No extra setup or virtual
//! cable required.
//!
//! The capture callback (driven by the OS audio thread) downmixes to mono
//! and pushes samples into a shared ring buffer. A separate processor loop
//! pulls fixed-size FFT windows out of the buffer at ~60 Hz, applies a Hann
//! window + rustfft, bins the magnitudes into 64 log-spaced frequency bands,
//! smooths each band with peak-hold + decay, and emits an `audio:spectrum`
//! event for the frontend visualizers.
//!
//! What fills that FFT ring is swappable at runtime: either the system mix
//! (cpal loopback, above, which writes the ring directly) or a STRICT
//! include list of up to `audio_source::MAX_APPS` apps — one WASAPI
//! process-loopback capture per selected exe (`audio_loopback`), each with
//! its own ring, drained and summed sample-wise into the FFT ring at every
//! hop by [`mix_rings`]. A supervisor thread owns whichever backend set is
//! live — see [`supervisor`] — and the frontend drives it with the
//! `audio_set_source` command.
//!
//! macOS has no cpal equivalent of WASAPI loopback — `build_input_stream` on
//! an output device opens the *microphone* there — so on macOS **both** roles
//! are served by Core Audio process taps (`audio_tap`): the system mix is a
//! global tap that excludes nothing, and the app include list is ONE tap
//! whose `TapTarget::Only` names every resolved pid at once. That single tap
//! writes a single ring, published as the sole entry in [`APP_RINGS`], so
//! [`mix_rings`] passes it through unchanged and everything above the backend
//! seam — the silence hop, the sticky flag, the watcher, the events — is
//! literally the same code on both platforms. Core Audio mixes the selected
//! processes for us where Windows sums them in `mix_rings`; that is the whole
//! difference. The cpal path below is compiled out entirely on macOS so it
//! cannot be reached by accident.
//!
//! The supervisor also *watches*: every two seconds it attaches a capture
//! for a selected app that has gained an audio session, rebuilds captures
//! the OS invalidated, and (in mix mode) follows a change of default
//! playback device. It NEVER changes which source is live on its own — a
//! selected app that isn't running simply contributes silence, and all
//! selected apps silent means the visualizer idles. The 0.6.4 auto-fallback
//! state machine is gone. See [`Supervisor::tick`].

#[cfg(not(target_os = "macos"))]
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use parking_lot::Mutex;
use rustfft::{num_complex::Complex32, FftPlanner};
use serde::Serialize;
#[cfg(not(target_os = "macos"))]
use std::sync::atomic::AtomicBool;
use std::{
    f32::consts::PI,
    sync::{atomic::Ordering, mpsc, Arc},
    thread,
    time::Duration,
};
use tauri::{AppHandle, Emitter, Runtime};

use crate::audio_source::{match_sessions, Source};

const FFT_SIZE: usize = 2048;
const SPECTRUM_BANDS: usize = 64;

/// Quietest band level that still maps above zero, in dBFS.
///
/// This is the floor of the whole visualizer pipeline and it is applied HERE,
/// before the frontend's sensitivity multiplier — so anything below it is
/// clamped to exactly 0.0 and `raw * sensitivity` can never recover it. At the
/// previous -60 dB the app effectively required near-full playback volume:
/// with a source at ~50% (perceptual sliders are roughly cubic, so ≈ -18 dB)
/// most of the 64 log-spaced bands fell under the floor and the visualizer sat
/// dead no matter how far sensitivity was raised.
///
/// -80 dB buys ~20 dB of headroom, which covers a half-volume source, while
/// staying above the dither/noise floor of a normal desktop mix. Widening it
/// does make mid-level content read slightly hotter — that is the deliberate
/// trade, and sensitivity can be turned DOWN, which previously it could not be
/// turned up enough to matter.
const SPECTRUM_FLOOR_DB: f32 = -80.0;

/// Map a tilted band level in dBFS onto 0..1: SPECTRUM_FLOOR_DB → 0, 0 dB → 1.
fn normalize_db(db_tilted: f32) -> f32 {
    let range = -SPECTRUM_FLOOR_DB;
    ((db_tilted - SPECTRUM_FLOOR_DB) / range).clamp(0.0, 1.0)
}

// ─── Stereo (0.8.4) ─────────────────────────────────────────────────────────
// The capture ring holds INTERLEAVED L/R pairs: [l0, r0, l1, r1, ...]. It used
// to hold pre-mixed mono, which destroyed the stereo field inside the realtime
// callback — nothing downstream could recover it, and the vectorscope and the
// correlation/width meters need both channels.
//
// ONE ring rather than two, deliberately: a second Mutex in the WASAPI capture
// callback is contention on a realtime thread, which is audible glitching for
// every user rather than a visual bug. Mono is derived at drain instead, which
// costs one add and one multiply per frame off the realtime path.

/// Pick left/right out of one interleaved frame.
///
/// A mono source duplicates its single channel into both, so it reads as
/// perfectly correlated — the honest display for mono, not a bug. Sources with
/// more than two channels use the first two, the standard interleave order
/// (FL, FR, ...).
fn frame_lr(frame: &[f32]) -> (f32, f32) {
    match frame.len() {
        0 => (0.0, 0.0),
        1 => (frame[0], frame[0]),
        _ => (frame[0], frame[1]),
    }
}

/// Average interleaved L/R pairs down to mono, appending to `out`.
/// A trailing odd sample (a torn frame at a buffer edge) is ignored.
fn pairs_to_mono(pairs: &[f32], out: &mut Vec<f32>) {
    for p in pairs.chunks_exact(2) {
        out.push((p[0] + p[1]) * 0.5);
    }
}
/// How often we re-emit a spectrum frame to the frontend. Atomic so the
/// frontend can dial it down via the `set_audio_emit_hz` command tied to
/// the perf-mode tweak — at 60Hz the FFT thread is a real CPU/IPC cost
/// when audio is actively playing.
static EMIT_HZ: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(30);

#[tauri::command]
pub fn set_audio_emit_hz(hz: u64) {
    let clamped = hz.clamp(5, 120);
    EMIT_HZ.store(clamped, std::sync::atomic::Ordering::Relaxed);
}

/// Butterchurn consumes 1024 time-domain samples per frame (its AudioProcessor
/// fftSize), as unsigned bytes matching Web Audio's getByteTimeDomainData.
const WAVEFORM_LEN: usize = 1024;
/// Waveform emission is opt-in: only the MilkDrop viz consumes it, so other
/// styles pay zero extra IPC. Toggled by the `set_waveform_enabled` command.
static WAVEFORM_ENABLED: std::sync::atomic::AtomicBool =
    std::sync::atomic::AtomicBool::new(false);

#[tauri::command]
pub fn set_waveform_enabled(enabled: bool) {
    WAVEFORM_ENABLED.store(enabled, std::sync::atomic::Ordering::Relaxed);
}

/// Stereo waveform is opted into SEPARATELY (0.8.7): its payload is ~2x the
/// mono one and only bundles whose manifest declares "stereo": true consume
/// it — tying it to the mono flag made every bundle surface pay the IPC for
/// the two stereo meters' benefit.
static STEREO_WAVEFORM_ENABLED: std::sync::atomic::AtomicBool =
    std::sync::atomic::AtomicBool::new(false);

#[tauri::command]
pub fn set_stereo_waveform_enabled(enabled: bool) {
    STEREO_WAVEFORM_ENABLED.store(enabled, std::sync::atomic::Ordering::Relaxed);
}

/// f32 [-1,1] → u8 centered at 128 (Web Audio getByteTimeDomainData convention).
fn sample_to_byte(s: f32) -> u8 {
    ((s.clamp(-1.0, 1.0) * 127.0) + 128.0) as u8
}
/// Most we'll ever buffer (samples). Caps memory if the processor stalls.
const RING_CAP: usize = FFT_SIZE * 8;

/// De-interleaved time-domain bytes, same convention as the mono waveform
/// (0-255 centred at 128). Sent as two arrays so the frontend does no
/// unpacking (0.8.4).
#[derive(Debug, Clone, Serialize)]
pub struct StereoWaveform {
    pub left: Vec<u8>,
    pub right: Vec<u8>,
}

#[derive(Debug, Clone, Serialize)]
pub struct AudioFrame {
    /// 64 log-spaced magnitudes, normalized to [0, 1].
    pub bands: Vec<f32>,
    /// Overall RMS-derived level [0, 1] — handy for ambient/particle modes.
    pub level: f32,
}

pub fn spawn<R: Runtime>(app: AppHandle<R>) {
    thread::spawn(move || {
        if let Err(e) = run(app) {
            eprintln!("audio capture disabled: {e}");
        }
    });
}

fn run<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    let buffer = Arc::new(Mutex::new(Vec::<f32>::with_capacity(RING_CAP)));

    // The capture backend gets its own thread: cpal's Stream is !Send on
    // Windows, so it must be created *and dropped* on one thread, and a
    // source swap can block for a second or two (COM session enumeration,
    // activation, joining the old pump) — none of which the FFT loop should
    // ever stall on.
    let (tx, rx) = mpsc::channel::<CaptureCmd>();
    *CMD_TX.lock() = Some(tx);
    let sup_app = app.clone();
    let sup_buffer = buffer.clone();
    thread::spawn(move || supervisor(sup_app, sup_buffer, rx));

    process_loop(app, buffer)
}

// ---------------------------------------------------------------------------
// Capture supervisor
// ---------------------------------------------------------------------------

/// Sample rate of whichever capture is currently live. The supervisor stores
/// it on every swap; `process_loop` recomputes its band edges when it changes,
/// because the mix backend's rate is whatever the endpoint runs at (often
/// 44.1 kHz) while process loopback is pinned to 48 kHz.
static SAMPLE_RATE: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(48_000);

enum CaptureCmd {
    SetSource(Source),
}

/// Set once the supervisor thread is up. `None` before that (and this is a
/// process-lifetime static, so it never goes back to `None`).
static CMD_TX: Mutex<Option<mpsc::Sender<CaptureCmd>>> = Mutex::new(None);

/// Point the visualizer at the system mix or a strict include list of apps.
/// Returns as soon as the request is queued — the swap itself happens on the
/// supervisor thread and its outcome (which selected apps actually have live
/// captures) arrives as an `audio:source` event. Async per the repo rule for
/// new/changed commands: never block the main thread from a command.
#[tauri::command]
pub async fn audio_set_source(source: Source) -> Result<(), String> {
    let guard = CMD_TX.lock();
    let tx = guard.as_ref().ok_or("audio capture not running")?;
    tx.send(CaptureCmd::SetSource(source))
        .map_err(|e| e.to_string())
}

/// What the frontend is told about the capture after every swap. Mirrored by
/// `AudioSourceState` in `app/src/state/useAudioSource.ts`.
#[derive(Clone, Serialize)]
pub struct AudioSourceState {
    pub requested: Source,
    /// "mix" | "apps" — which backend family is feeding the FFT ring. If the
    /// mix itself could not be opened this still reads "mix" (nothing is
    /// feeding the ring) and `reason` says why.
    pub active: &'static str,
    /// Selected exes with a live capture attached right now. A requested exe
    /// missing from this list is contributing silence — it has no audio
    /// session ("not running" in the UI). Always empty in mix mode.
    pub live_exes: Vec<String>,
    /// False once a process activation has failed — usually a Windows build
    /// without process loopback. Not a permanent verdict: an explicit
    /// `audio_set_source`, or a watcher rebuild triggered by real change (a
    /// dead capture, a session appearing or moving), re-arms it and tries
    /// again, since the same `Err` covers transient failures too.
    pub supported: bool,
    pub reason: Option<String>,
}

/// Last state emitted on `audio:source`, so it can be *asked for* as well as
/// listened to. The startup emit almost certainly beats the webview's
/// listener registration, and polling `audio_set_source(Mix)` to find out
/// where things stand would clobber a persisted per-app source.
static LAST_STATE: Mutex<Option<AudioSourceState>> = Mutex::new(None);

/// The per-app capture rings while `Source::Apps` is live — what
/// `process_loop` drains and sums into the FFT ring at every hop. A non-empty
/// list is also how `process_loop` knows it is in apps mode and must keep the
/// window sliding with synthesized silence when nothing plays. Empty in mix
/// mode, where the mix backend writes the FFT ring directly. Only Arc handles
/// are cloned out — the lock is held for microseconds.
///
/// How many entries depends on the backend, and nothing downstream cares:
/// `mix_rings` sums whatever it is given.
///
/// * Windows — one entry per SELECTED exe, capture attached or not (a
///   writer-less ring just reads as silence), because each app is its own
///   WASAPI process-loopback client.
/// * macOS — exactly ONE entry regardless of how many apps are selected, and
///   present even when no tap could be built. A Core Audio tap takes the whole
///   pid list and mixes them itself, so there is one ring; publishing it
///   unconditionally is what keeps `process_loop` in apps mode (and the
///   spectrum decaying to zero rather than freezing) when nothing is playing.
static APP_RINGS: Mutex<Vec<Arc<Mutex<Vec<f32>>>>> = Mutex::new(Vec::new());

/// Current capture state. Pure read — never touches the capture.
///
/// Before the supervisor's first swap (a window of a few ms at startup) this
/// reports the state it is about to establish: the system mix, nothing wrong.
#[tauri::command]
pub async fn audio_get_source() -> AudioSourceState {
    LAST_STATE.lock().clone().unwrap_or(AudioSourceState {
        requested: Source::Mix,
        active: "mix",
        live_exes: Vec::new(),
        supported: true,
        reason: None,
    })
}

/// One selected exe's slot in apps mode. The ring exists for the slot's whole
/// life; `cap` is `None` while the app has no audio session, in which case
/// the ring stays empty and the hop mix reads that as silence — attaching
/// later is the watcher's job, switching source is nobody's.
#[cfg(not(target_os = "macos"))]
struct AppCapture {
    exe: String,
    ring: Arc<Mutex<Vec<f32>>>,
    cap: Option<(u32, crate::audio_loopback::ProcessCapture)>,
    /// Session pid observed for this exe at the last build or watcher pass —
    /// tracked whether or not a capture is attached. This is what lets the
    /// watcher tell "the same session is still there" (no evidence, no retry)
    /// from "a session appeared or moved" (evidence of change, which re-arms
    /// a failed `supported` for exactly one rebuild attempt). Bounds retries
    /// on an unsupported OS to one per session transition, never per tick.
    seen_pid: Option<u32>,
}

/// One selected app's slot in macOS apps mode. Carries no capture of its own:
/// a Core Audio tap takes the whole pid list at once, so the *set* of slots
/// with a pid is what gets built into one `TapTarget::Only`, and there is no
/// per-slot ring to hold either (see [`TapApps::ring`]).
#[cfg(target_os = "macos")]
struct AppSlot {
    exe: String,
    /// The pid this slot contributed to the live tap, or `None` if it was not
    /// in it (no process object at build time, or the build failed). This is
    /// the macOS analogue of `AppCapture::cap` — what `emit` reports as live
    /// and what the watcher compares against the current session.
    tapped_pid: Option<u32>,
    /// Same role, same rules, same rationale as `AppCapture::seen_pid`.
    seen_pid: Option<u32>,
}

/// macOS apps mode: N selected apps, one tap, one ring.
#[cfg(target_os = "macos")]
struct TapApps {
    /// One per selected exe, in request order, capped at
    /// `audio_source::MAX_APPS` by the `Source` deserializer.
    slots: Vec<AppSlot>,
    /// The single ring the tap writes — Core Audio has already mixed the
    /// tapped processes into it. Created and published for the whole life of
    /// apps mode *whether or not a tap exists*, because a non-empty
    /// `APP_RINGS` is how `process_loop` knows to keep the window sliding
    /// with synthesized silence. With no tap it simply stays empty, which is
    /// exactly what a Windows slot with `cap: None` looks like.
    ring: Arc<Mutex<Vec<f32>>>,
    /// `None` when no selected app had a process object to tap, or when the
    /// tap could not be created. Held purely for its `Drop` — hence the allow
    /// on `Live`.
    tap: Option<crate::audio_tap::TapCapture>,
}

/// Whichever backend set currently feeds the FFT. Never leaves the supervisor
/// thread — on Windows it *cannot*, since `cpal::Stream` is `!Send`; on macOS
/// the payload is a `TapCapture`, which `audio_tap` statically asserts is
/// `Send + Sync`, so there the confinement is a design choice (one owner, one
/// teardown ordering) rather than a type-system guarantee. The backend payload
/// is held purely for its `Drop` — hence the allow.
#[allow(dead_code)]
enum Live {
    None,
    /// The stream, plus the flag `err_fn` clears when the endpoint dies. cpal
    /// keeps handing back a `Stream` object that feeds nothing, so the object's
    /// existence is not evidence that anything is being captured.
    #[cfg(not(target_os = "macos"))]
    Mix(cpal::Stream, Arc<AtomicBool>),
    /// The macOS mix: a global tap that excludes nothing. `TapCapture` carries
    /// its own liveness (callback progress), so there is no separate flag.
    #[cfg(target_os = "macos")]
    Mix(crate::audio_tap::TapCapture),
    /// One entry per selected exe, in request order, capped at
    /// `audio_source::MAX_APPS` by the `Source` deserializer.
    #[cfg(not(target_os = "macos"))]
    Apps(Vec<AppCapture>),
    #[cfg(target_os = "macos")]
    Apps(TapApps),
}

struct Supervisor<R: Runtime> {
    app: AppHandle<R>,
    /// The FFT ring. Mix mode: cpal writes it directly. Apps mode: only the
    /// hop mix in `process_loop` writes it (via `APP_RINGS`).
    buffer: Arc<Mutex<Vec<f32>>>,
    live: Live,
    requested: Source,
    supported: bool,
    reason: Option<String>,
    /// Id of the default render endpoint as of the last swap — what a live
    /// mix capture is bound to. `None` when it could not be read (no audio
    /// device, COM unavailable), which the watcher compares like any value.
    endpoint_id: Option<String>,
}

/// How often the watcher looks for an app to (re)attach to, a dead backend to
/// rebuild, or a new default endpoint. Also the supervisor's `recv` timeout, so
/// a command is still serviced the instant it arrives. Two seconds is the
/// slowest the reattach can feel without seeming broken, and the cheapest tick
/// (mix requested, mix healthy) is one endpoint query.
const WATCH_INTERVAL: Duration = Duration::from_secs(2);

fn supervisor<R: Runtime>(
    app: AppHandle<R>,
    buffer: Arc<Mutex<Vec<f32>>>,
    rx: mpsc::Receiver<CaptureCmd>,
) {
    let mut sup = Supervisor {
        app,
        buffer,
        live: Live::None,
        requested: Source::Mix,
        supported: true,
        reason: None,
        endpoint_id: None,
    };
    // Startup goes through the same path as any later change, so the frontend
    // has a state event before it asks for anything.
    sup.apply(Source::Mix);

    loop {
        match rx.recv_timeout(WATCH_INTERVAL) {
            Ok(CaptureCmd::SetSource(s)) => {
                // An explicit request re-arms per-app capture. `supported` is
                // a hint learned from one failed activation, and `start`
                // returns Err for plenty of transient reasons that have
                // nothing to do with the Windows build lacking process
                // loopback. The sticky bit only suppresses *automatic*
                // re-attempts (a watcher tick), never a user asking again —
                // which is also why the watcher calls `sup.apply` directly
                // instead of posting to this channel: a tick routed through
                // here would re-arm the flag every two seconds and retry
                // activation forever on a machine that cannot do it.
                sup.supported = true;
                sup.apply(s);
            }
            Err(mpsc::RecvTimeoutError::Timeout) => sup.tick(),
            // Every sender lives in a process-lifetime static, so this only
            // happens at shutdown. Stop rather than spin.
            Err(mpsc::RecvTimeoutError::Disconnected) => break,
        }
    }
}

impl<R: Runtime> Supervisor<R> {
    /// Tear down whatever is live and build what `requested` calls for.
    /// Deliberately NOT incremental: attaching one app rebuilds all of them.
    /// A rebuild costs a sub-second gap in the spectrum at most once per
    /// watcher tick, and one build path means one teardown ordering to get
    /// right. It never falls back: a selected app that can't be captured
    /// stays selected and silent.
    fn apply(&mut self, requested: Source) {
        self.requested = requested;
        self.reason = None;

        // Teardown ordering matters:
        // 1. Unpublish the rings so the hop mix stops draining them.
        // 2. Drop every old backend completely — `ProcessCapture::drop`
        //    joins a pump thread that takes its ring lock, so no ring lock
        //    may be held here, and Windows will not hand out a second
        //    loopback client for a target while the first lives.
        // 3. Clear the FFT ring while nothing is writing it, so the first
        //    window after the swap can't straddle two backends at two rates.
        APP_RINGS.lock().clear();
        drop(std::mem::replace(&mut self.live, Live::None));
        {
            self.buffer.lock().clear();
        }

        match self.requested.clone() {
            Source::Mix => {
                let (live, rate) = open_mix_or_none(&self.buffer, &mut self.reason);
                SAMPLE_RATE.store(rate, Ordering::Relaxed);
                self.live = live;
            }
            Source::Apps { exes } => {
                let sessions = session_pairs();
                let pids = match_sessions(&exes, &sessions);
                // Snapshot the sticky flag for this whole build: one exe's
                // failed activation must never skip its sibling slots in the
                // same build. The bit set inside governs *future automatic*
                // attempts, not this one.
                let can_try = self.supported;
                let (live, rings, rate) = self.build_apps(exes, pids, can_try);
                // Publish EVERY selected ring, attached or not — a non-empty
                // list is also how process_loop knows it's in apps mode (see
                // APP_RINGS).
                *APP_RINGS.lock() = rings;
                SAMPLE_RATE.store(rate, Ordering::Relaxed);
                self.live = live;
            }
        }

        // Read *after* the backends are up, so a device switch that raced
        // this build is seen as a difference on the next tick instead of
        // being baked in as "what we're bound to".
        self.endpoint_id = crate::mixer::default_endpoint_id().ok();
        self.emit();
    }

    /// Build the apps-mode backend for `exes` / their currently-resolved
    /// `pids`. Returns the live backend, the rings to publish (one per
    /// selected exe on Windows, exactly one shared tap ring on macOS) and the
    /// sample rate to pin. Sets `self.supported` / `self.reason` on failure —
    /// `can_try` is the caller's snapshot of the flag so one failing slot can
    /// never skip its siblings in the same build.
    ///
    /// Windows: one WASAPI process-loopback client per selected exe, summed
    /// by `mix_rings` at every hop.
    #[cfg(not(target_os = "macos"))]
    fn build_apps(
        &mut self,
        exes: Vec<String>,
        pids: Vec<Option<u32>>,
        can_try: bool,
    ) -> (Live, Vec<Arc<Mutex<Vec<f32>>>>, u32) {
        let mut caps: Vec<AppCapture> = Vec::with_capacity(exes.len());
        for (exe, pid) in exes.into_iter().zip(pids) {
            let ring = Arc::new(Mutex::new(Vec::with_capacity(RING_CAP)));
            let cap = match pid {
                Some(pid) if can_try => {
                    match crate::audio_loopback::start(pid, false, ring.clone(), RING_CAP) {
                        Ok(c) => {
                            eprintln!("audio: process loopback on {exe} (pid {pid})");
                            Some((pid, c))
                        }
                        Err(e) => {
                            eprintln!("audio: process capture for {exe} failed: {e}");
                            // Suppresses the watcher's *attach* trigger until
                            // an explicit audio_set_source or a
                            // change-triggered rebuild re-arms it (see `tick`
                            // and the note in `supervisor`). NO fallback: the
                            // exe just stays silent.
                            self.supported = false;
                            // First failure wins — later slots in the same
                            // build must not clobber the reason the user is
                            // shown.
                            if self.reason.is_none() {
                                self.reason = Some(e);
                            }
                            None
                        }
                    }
                }
                // No session (app not running / not playing): the slot
                // contributes silence until the watcher sees a session and
                // rebuilds. This is a fact, not an error.
                _ => None,
            };
            caps.push(AppCapture { exe, ring, cap, seen_pid: pid });
        }
        let rings = caps.iter().map(|c| c.ring.clone()).collect();
        // Pin the FFT rate: process loopback always delivers at
        // CAPTURE_SAMPLE_RATE regardless of the endpoint.
        (
            Live::Apps(caps),
            rings,
            crate::audio_loopback::CAPTURE_SAMPLE_RATE,
        )
    }

    /// macOS: a Core Audio tap takes the whole pid list at once, so the entire
    /// include list is ONE tap, one ring, one Core-Audio-side mix. The ring is
    /// created and published whether or not the tap could be built, so
    /// `process_loop` stays in apps mode and keeps the window sliding with
    /// synthesized silence — the same thing a Windows build of nothing but
    /// unattached slots produces.
    #[cfg(target_os = "macos")]
    fn build_apps(
        &mut self,
        exes: Vec<String>,
        pids: Vec<Option<u32>>,
        can_try: bool,
    ) -> (Live, Vec<Arc<Mutex<Vec<f32>>>>, u32) {
        use crate::audio_tap::TapTarget;

        let ring = Arc::new(Mutex::new(Vec::with_capacity(RING_CAP)));
        let mut slots: Vec<AppSlot> = exes
            .into_iter()
            .zip(pids.iter().copied())
            .map(|(exe, seen_pid)| AppSlot { exe, tapped_pid: None, seen_pid })
            .collect();

        // Which slots have something tappable right now. Converted fallibly
        // rather than with `as`: the wrap `as` would do turns an out-of-range
        // value into a *negative* pid_t, which names a process group — a tap
        // on the wrong thing is far worse than a slot that stays silent.
        let targets: Vec<(usize, u32, i32)> = pids
            .iter()
            .enumerate()
            .filter_map(|(i, p)| p.map(|pid| (i, pid)))
            .filter_map(|(i, pid)| match i32::try_from(pid) {
                Ok(t) => Some((i, pid, t)),
                Err(_) => {
                    eprintln!("audio: pid {pid} is not a valid pid_t, skipping");
                    None
                }
            })
            .collect();

        let mut tap = None;
        // Keep the previous rate when nothing is capturing, so process_loop
        // doesn't churn its band edges over a ring carrying only silence —
        // same reasoning as `open_mix_or_none`'s failure arm.
        let mut rate = SAMPLE_RATE.load(Ordering::Relaxed);
        if can_try && !targets.is_empty() {
            let pid_ts: Vec<i32> = targets.iter().map(|(_, _, t)| *t).collect();
            match crate::audio_tap::start(TapTarget::Only(pid_ts), ring.clone(), RING_CAP) {
                Ok(cap) => {
                    rate = cap.sample_rate();
                    // Read back what the tap was ACTUALLY built with, never
                    // what we asked for. `create_tap` drops a pid whose app
                    // stopped playing in the race window between
                    // `session_pairs()` above and the translation inside — so
                    // assuming every requested pid made it would report an app
                    // as live in `live_exes` when it is contributing nothing.
                    let included = cap.included_pids();
                    for (i, pid, pid_t) in &targets {
                        if included.contains(pid_t) {
                            slots[*i].tapped_pid = Some(*pid);
                            eprintln!(
                                "audio: Core Audio tap includes {} (pid {pid})",
                                slots[*i].exe
                            );
                        } else {
                            // Not an error and not sticky: the slot simply
                            // contributes silence, and the watcher reattaches
                            // it when a session reappears — the same thing a
                            // Windows slot with no session does.
                            eprintln!(
                                "audio: {} (pid {pid}) stopped playing before the tap was built; \
                                 it contributes silence until it starts again",
                                slots[*i].exe
                            );
                        }
                    }
                    eprintln!(
                        "audio: Core Audio tap on {} of {} selected app(s) @ {rate} Hz",
                        included.len(),
                        targets.len()
                    );
                    tap = Some(cap);
                }
                Err(e) => {
                    eprintln!("audio: process tap failed: {e}");
                    // One tap covers every selected app, so a failure here is
                    // the whole include list going silent — but it is still
                    // only a *hint*, cleared by an explicit audio_set_source
                    // or a change-triggered rebuild, exactly as on Windows.
                    self.supported = false;
                    if self.reason.is_none() {
                        self.reason = Some(e);
                    }
                }
            }
        }

        // Rings are read back off the built value rather than tracked
        // alongside it, mirroring the Windows arm's
        // `caps.iter().map(|c| c.ring.clone())` — one owner of the truth.
        let apps = TapApps { slots, ring, tap };
        let rings = vec![apps.ring.clone()];
        (Live::Apps(apps), rings, rate)
    }

    /// One watcher pass, every `WATCH_INTERVAL`, on the supervisor thread.
    /// Attach / rebuild ONLY — it never changes which source family is live
    /// (no fallback, ever), and it calls `apply` directly rather than posting
    /// a `SetSource`, which would re-arm the sticky `supported` flag on every
    /// quiet tick and retry a hopeless activation forever. Re-arming here
    /// happens only on real evidence of change (a dead capture, a session
    /// appearing or moving) — see the `stale` handling below.
    fn tick(&mut self) {
        let stale = if matches!(self.live, Live::Apps(_)) {
            self.apps_stale()
        } else {
            // Mix mode (or nothing open): follow the default endpoint and
            // rebuild a dead stream — unchanged 0.6.4 behavior. The
            // `Live::None` guard means a machine with no audio device
            // stays quiet instead of failing to open the mix every 2 s.
            let now_id = crate::mixer::default_endpoint_id().ok();
            let endpoint_moved = now_id != self.endpoint_id;
            let mix_died = self.mix_died();
            if endpoint_moved {
                eprintln!("audio: default output device changed, rebinding capture");
            }
            if mix_died {
                eprintln!("audio: mix capture stopped, rebuilding");
            }
            endpoint_moved || mix_died
        };
        if stale {
            // A rebuild triggered by real evidence of change (a dead capture,
            // a session appearing or moving) is a fresh start for per-app
            // activation: re-arm the sticky flag so a transient failure is
            // retried on this pass instead of sticking until the user
            // re-touches the picker. Bounded on a truly unsupported OS: the
            // rebuilt slots record `seen_pid`, so an unchanged session
            // produces no further evidence and no further retries.
            if matches!(self.live, Live::Apps(_)) {
                self.supported = true;
            }
            self.apply(self.requested.clone());
        }
    }

    /// Is a live mix backend dead? cpal keeps handing back a `Stream` object
    /// that feeds nothing, so on Windows the answer is the `err_fn` flag; on
    /// macOS it is the tap's own callback-progress liveness. `Live::None`
    /// (nothing opened at all) answers `false` on both — see the guard's
    /// rationale in `tick`.
    #[cfg(not(target_os = "macos"))]
    fn mix_died(&self) -> bool {
        matches!(&self.live, Live::Mix(_, alive) if !alive.load(Ordering::Relaxed))
    }

    #[cfg(target_os = "macos")]
    fn mix_died(&self) -> bool {
        matches!(&self.live, Live::Mix(cap) if !cap.is_alive())
    }

    /// Apps-mode staleness. Rebuild when reality drifted from what we built: a
    /// capture died (an endpoint change kills per-app captures too), a session
    /// moved to a new pid (app restarted), or a silent slot's app now has a
    /// session. One session snapshot for all slots. Anything else must produce
    /// no churn and no event.
    #[cfg(not(target_os = "macos"))]
    fn apps_stale(&mut self) -> bool {
        let sessions = session_pairs();
        let Live::Apps(caps) = &mut self.live else { return false };
        let exes: Vec<String> = caps.iter().map(|c| c.exe.clone()).collect();
        let pids = match_sessions(&exes, &sessions);
        let supported = self.supported;
        let mut stale = false;
        for (c, now_pid) in caps.iter_mut().zip(pids) {
            // Session-transition EVIDENCE, computed before (and independent
            // of) the `supported` gate — a new or moved session must count
            // exactly once even after a failed activation, or
            // `supported = false` becomes circular: no rebuild, so no re-arm,
            // so no rebuild.
            let changed = now_pid != c.seen_pid;
            stale |= match &c.cap {
                Some((pid, cap)) => !cap.is_alive() || now_pid != Some(*pid),
                // A silent slot warrants a build when a session is there and
                // either activation is believed to work, or the session is NEW
                // evidence (appeared / moved) — the transition that re-arms a
                // failed `supported` below.
                None => now_pid.is_some() && (supported || changed),
            };
            // Track even when nothing rebuilds, so "the same session still
            // sitting there" never reads as evidence twice: on an unsupported
            // OS a continuously-running app yields `changed == false` on every
            // later tick, bounding retries to one per genuine session
            // transition.
            c.seen_pid = now_pid;
        }
        stale
    }

    /// Same question on macOS, asked of one tap covering every slot. Two
    /// differences from the Windows arm, both forced by the mechanism:
    ///
    /// * liveness is a property of the tap, not of a slot, so a dead tap makes
    ///   every attached slot stale at once;
    /// * a default-output change has to be checked *here* as well as in mix
    ///   mode, because the tap's aggregate device names the current default
    ///   output as its main sub-device. Windows doesn't need this — its
    ///   process-loopback clients are invalidated by the switch and show up as
    ///   `!is_alive()` — but a tap on a stale aggregate can keep firing.
    #[cfg(target_os = "macos")]
    fn apps_stale(&mut self) -> bool {
        let sessions = session_pairs();
        // Only an Ok read counts as a device switch, and only against a
        // baseline we actually have. The mix-mode branch compares
        // `.ok()` Options because that is what main does and Windows must not
        // change; here a spurious Err would be *compounding* — each false hit
        // both rebuilds the tap and re-arms the sticky `supported` flag — so
        // an unreadable endpoint is treated as "no news", not as a switch.
        let endpoint_moved = match (crate::mixer::default_endpoint_id(), &self.endpoint_id) {
            (Ok(now), Some(prev)) => &now != prev,
            _ => false,
        };
        let Live::Apps(apps) = &mut self.live else { return false };
        let exes: Vec<String> = apps.slots.iter().map(|s| s.exe.clone()).collect();
        let pids = match_sessions(&exes, &sessions);
        let supported = self.supported;
        let tap_dead = apps.tap.as_ref().is_some_and(|t| !t.is_alive());
        let mut stale = tap_dead;
        for (s, now_pid) in apps.slots.iter_mut().zip(pids) {
            let changed = now_pid != s.seen_pid;
            stale |= match s.tapped_pid {
                Some(pid) => now_pid != Some(pid),
                None => now_pid.is_some() && (supported || changed),
            };
            s.seen_pid = now_pid;
        }
        if tap_dead {
            eprintln!("audio: process tap stopped, rebuilding");
        }
        if endpoint_moved {
            eprintln!("audio: default output device changed, rebuilding the process tap");
            stale = true;
        }
        stale
    }

    #[cfg(not(target_os = "macos"))]
    fn live_exes(&self) -> Vec<String> {
        match &self.live {
            Live::Apps(caps) => caps
                .iter()
                .filter(|c| c.cap.is_some())
                .map(|c| c.exe.clone())
                .collect(),
            _ => Vec::new(),
        }
    }

    /// A slot is live when it made it into the tap — the macOS analogue of
    /// `cap.is_some()`. `tapped_pid` is only ever set for slots the tap was
    /// actually built with, so a failed tap reports nothing live, exactly as a
    /// Windows build whose every activation failed does.
    #[cfg(target_os = "macos")]
    fn live_exes(&self) -> Vec<String> {
        match &self.live {
            Live::Apps(apps) => apps
                .slots
                .iter()
                .filter(|s| s.tapped_pid.is_some())
                .map(|s| s.exe.clone())
                .collect(),
            _ => Vec::new(),
        }
    }

    fn emit(&self) {
        let (active, live_exes): (&'static str, Vec<String>) = match &self.live {
            Live::Apps(_) => ("apps", self.live_exes()),
            _ => ("mix", Vec::new()),
        };
        let state = AudioSourceState {
            requested: self.requested.clone(),
            active,
            live_exes,
            supported: self.supported,
            reason: self.reason.clone(),
        };
        // Recorded before it is emitted, so `audio_get_source` can never
        // report something older than what a listener has already seen.
        *LAST_STATE.lock() = Some(state.clone());
        let _ = self.app.emit("audio:source", state);
    }
}

/// (exe, pid) pairs for every session that has an executable, lowercased —
/// the shape `match_sessions` consumes. One COM snapshot per call (a few ms,
/// paid at most once per watcher tick / apply).
#[cfg(not(target_os = "macos"))]
fn session_pairs() -> Vec<(String, u32)> {
    crate::mixer::sessions_snapshot()
        .unwrap_or_default()
        .into_iter()
        .filter_map(|s| s.exe.map(|e| (e.to_lowercase(), s.pid)))
        .collect()
}

/// The macOS inventory `match_sessions` reduces: (lowercased bundle id, pid)
/// for every app holding a Core Audio *process object*. That list plays
/// exactly the role a Windows session snapshot does — see
/// `mixer::AudioApp` for why it is not an `NSWorkspace` scan — so
/// "absent from here" means "not playing yet, keep watching", never an error.
#[cfg(target_os = "macos")]
fn session_pairs() -> Vec<(String, u32)> {
    crate::mixer::audio_process_apps()
        .unwrap_or_default()
        .into_iter()
        .map(|a| (a.bundle_id, a.pid))
        .collect()
}

/// Open the system-mix capture, or give up and leave the ring unfed. Failing
/// to open the mix is not fatal — the endpoint may come back, and a later
/// source change re-tries from scratch — so it degrades to `Live::None` with
/// an explanation rather than killing the audio threads.
#[cfg(not(target_os = "macos"))]
fn open_mix_or_none(
    buffer: &Arc<Mutex<Vec<f32>>>,
    reason: &mut Option<String>,
) -> (Live, u32) {
    match open_mix(buffer.clone()) {
        Ok((stream, rate, alive)) => (Live::Mix(stream, alive), rate),
        Err(e) => {
            eprintln!("audio: mix capture unavailable: {e}");
            *reason = Some(match reason.take() {
                Some(prev) => format!("{prev}; mix capture unavailable: {e}"),
                None => format!("mix capture unavailable: {e}"),
            });
            // Rate is meaningless with nothing capturing; keep the last one so
            // process_loop doesn't churn its band edges over a dead ring.
            (Live::None, SAMPLE_RATE.load(Ordering::Relaxed))
        }
    }
}

/// The macOS mix: a global tap that excludes nothing. Same contract as the
/// cpal version above — including degrading to `Live::None` with an appended
/// reason rather than failing the swap — because `apply` treats the two
/// identically. The difference is only in what the failure usually *means*
/// here: a refused tap is most often a denied audio-capture permission, and
/// `audio_tap` spells that out in the error the UI ends up showing.
#[cfg(target_os = "macos")]
fn open_mix_or_none(
    buffer: &Arc<Mutex<Vec<f32>>>,
    reason: &mut Option<String>,
) -> (Live, u32) {
    match crate::audio_tap::start(
        crate::audio_tap::TapTarget::AllProcesses,
        buffer.clone(),
        RING_CAP,
    ) {
        Ok(cap) => {
            let rate = cap.sample_rate();
            eprintln!("audio: Core Audio tap on the system mix @ {rate} Hz");
            (Live::Mix(cap), rate)
        }
        Err(e) => {
            eprintln!("audio: mix capture unavailable: {e}");
            *reason = Some(match reason.take() {
                Some(prev) => format!("{prev}; mix capture unavailable: {e}"),
                None => format!("mix capture unavailable: {e}"),
            });
            // Rate is meaningless with nothing capturing; keep the last one so
            // process_loop doesn't churn its band edges over a dead ring.
            (Live::None, SAMPLE_RATE.load(Ordering::Relaxed))
        }
    }
}

/// Build and start the cpal loopback stream on the *current* default output
/// device. Re-queried on every call so a default-device change is picked up by
/// the next swap. The returned flag is the stream's liveness — see `build_stream`.
#[cfg(not(target_os = "macos"))]
fn open_mix(buffer: Arc<Mutex<Vec<f32>>>) -> Result<(cpal::Stream, u32, Arc<AtomicBool>), String> {
    let host = cpal::default_host();
    let device = host
        .default_output_device()
        .ok_or_else(|| "no default output device".to_string())?;
    let supported = device
        .default_output_config()
        .map_err(|e| format!("default_output_config: {e}"))?;
    let config: cpal::StreamConfig = supported.config();
    let channels = config.channels as usize;
    let sample_rate = config.sample_rate.0;
    let sample_format = supported.sample_format();

    eprintln!(
        "audio: WASAPI loopback @ {} Hz, {} ch, {:?}",
        sample_rate, channels, sample_format
    );

    // cpal recognizes "input on the default output device" as a request for
    // WASAPI loopback on Windows.
    let alive = Arc::new(AtomicBool::new(true));
    let stream = build_stream(
        &device,
        &config,
        sample_format,
        channels,
        buffer,
        alive.clone(),
    )?;
    stream.play().map_err(|e| format!("stream.play: {e}"))?;
    Ok((stream, sample_rate, alive))
}

/// `alive` is cleared the first time cpal reports a stream error. WASAPI's run
/// loop stops processing once it errors — a `DeviceNotAvailable` from a default
/// -device change ends the stream for good — but the `Stream` object stays
/// perfectly alive, so this flag is the only way to tell a capturing stream
/// from a dead one. The supervisor checks it before deciding it has nothing to
/// do; without it, an invalidated endpoint freezes the ring permanently.
#[cfg(not(target_os = "macos"))]
fn build_stream(
    device: &cpal::Device,
    config: &cpal::StreamConfig,
    sample_format: cpal::SampleFormat,
    channels: usize,
    buffer: Arc<Mutex<Vec<f32>>>,
    alive: Arc<AtomicBool>,
) -> Result<cpal::Stream, String> {
    let err_fn = move |err| {
        eprintln!("audio stream error: {err}");
        alive.store(false, Ordering::Relaxed);
    };

    /// Push interleaved L/R pairs into the ring (0.8.4).
    ///
    /// Runs on the OS audio thread. It takes ONE lock and does no allocation,
    /// which is the whole reason the ring carries stereo rather than a second
    /// ring being added alongside the mono one: a second mutex here is
    /// contention on a realtime thread, and that is audible for every user.
    fn push_frames<I, F>(samples: I, channels: usize, buffer: &Arc<Mutex<Vec<f32>>>, to_f32: F)
    where
        I: IntoIterator,
        F: Fn(I::Item) -> f32,
    {
        if channels == 0 {
            return; // a device that reports no channels would never complete a frame
        }
        let mut buf = buffer.lock();
        let mut frame: [f32; 2] = [0.0, 0.0];
        let mut count: usize = 0;
        for s in samples {
            let v = to_f32(s);
            if count < 2 {
                frame[count] = v;
            }
            count += 1;
            if count == channels {
                let used = if channels == 1 { &frame[..1] } else { &frame[..2] };
                let (l, r) = frame_lr(used);
                buf.push(l);
                buf.push(r);
                count = 0;
            }
        }
        // RING_CAP counts FRAMES; the ring stores two samples per frame.
        let cap = RING_CAP * 2;
        if buf.len() > cap {
            // Drain an EVEN count so L/R stay aligned. An odd drain would swap
            // the two channels for the entire remainder of the stream — silent,
            // permanent, and invisible until someone looked at a vectorscope.
            let excess = buf.len() - cap;
            let drop = ((excess + 1) & !1).min(buf.len());
            buf.drain(..drop);
        }
    }

    match sample_format {
        cpal::SampleFormat::F32 => device
            .build_input_stream(
                config,
                move |data: &[f32], _| {
                    push_frames(data.iter().copied(), channels, &buffer, |s| s);
                },
                err_fn,
                None,
            )
            .map_err(|e| format!("build_input_stream f32: {e}")),
        cpal::SampleFormat::I16 => device
            .build_input_stream(
                config,
                move |data: &[i16], _| {
                    push_frames(data.iter().copied(), channels, &buffer, |s| {
                        s as f32 / i16::MAX as f32
                    });
                },
                err_fn,
                None,
            )
            .map_err(|e| format!("build_input_stream i16: {e}")),
        cpal::SampleFormat::U16 => device
            .build_input_stream(
                config,
                move |data: &[u16], _| {
                    push_frames(data.iter().copied(), channels, &buffer, |s| {
                        (s as f32 - u16::MAX as f32 / 2.0) / (u16::MAX as f32 / 2.0)
                    });
                },
                err_fn,
                None,
            )
            .map_err(|e| format!("build_input_stream u16: {e}")),
        other => Err(format!("unsupported sample format: {other:?}")),
    }
}

fn process_loop<R: Runtime>(
    app: AppHandle<R>,
    buffer: Arc<Mutex<Vec<f32>>>,
) -> Result<(), String> {
    let mut planner = FftPlanner::<f32>::new();
    let fft = planner.plan_fft_forward(FFT_SIZE);
    let hann: Vec<f32> = (0..FFT_SIZE)
        .map(|i| 0.5 - 0.5 * ((2.0 * PI * i as f32 / FFT_SIZE as f32).cos()))
        .collect();

    // Both derived from the live capture's sample rate, and both recomputed
    // below whenever the supervisor swaps a backend with a different one.
    // 0.0 forces the first iteration to build them.
    let mut current_rate = 0f32;
    let mut band_edges: Vec<(usize, usize)> = Vec::new();
    let mut band_tilt: Vec<f32> = Vec::new();
    let mut workspace = vec![Complex32::default(); FFT_SIZE];
    let mut samples = vec![0f32; FFT_SIZE];
    let mut smoothed = vec![0f32; SPECTRUM_BANDS];
    // Reused per hop so the FFT path stays allocation-free (0.8.4): the mono
    // mixdown the FFT consumes, and the raw interleaved tail the stereo
    // waveform emit needs.
    let mut mono_scratch: Vec<f32> = Vec::with_capacity(FFT_SIZE);
    let mut stereo_tail: Vec<f32> = Vec::with_capacity(FFT_SIZE * 2);

    // Initial interval; recomputed each iteration so a runtime change in
    // EMIT_HZ takes effect on the next tick.

    loop {
        let hz = EMIT_HZ.load(std::sync::atomic::Ordering::Relaxed);
        let frame_interval = Duration::from_millis(1000 / hz.max(1));
        thread::sleep(frame_interval);

        let rate = SAMPLE_RATE.load(Ordering::Relaxed) as f32;
        if rate != current_rate {
            current_rate = rate;
            band_edges = log_band_edges(SPECTRUM_BANDS, FFT_SIZE / 2, rate, 30.0, 16_000.0);
            // Per-band perceptual tilt: music has a natural pink-noise spectrum
            // (~-3 dB/oct roll-off in PSD), so without compensation every
            // visualizer reads bass-heavy and mids/treble feel inert. We boost
            // +3 dB/octave above 1 kHz (and cut below) so kick, vocals, and
            // hi-hats all compete for visual attention. Capped at [-15, +12] so
            // an idle high-band noise floor (~-90 dB on WASAPI loopback) still
            // clamps to zero.
            band_tilt = band_tilt_db(SPECTRUM_BANDS, FFT_SIZE / 2, rate, 30.0, 16_000.0);
            smoothed.iter_mut().for_each(|v| *v = 0.0); // stale peaks belong to the old rate
        }

        // Apps mode: one hop of mixing. Drain whatever every per-app capture
        // pushed since the last tick and append the sample-wise sum to the
        // FFT ring. When nothing arrived at all — every selected app silent,
        // paused, or not running — append one hop of synthesized silence
        // instead, so the window keeps sliding and the spectrum decays to
        // zero; a frozen ring would replay the last real window forever.
        // Empty list = mix mode (cpal writes the ring directly): this whole
        // block then costs one uncontended lock.
        let rings: Vec<Arc<Mutex<Vec<f32>>>> = APP_RINGS.lock().clone();
        if !rings.is_empty() {
            let drained: Vec<Vec<f32>> = rings
                .iter()
                .map(|r| std::mem::take(&mut *r.lock()))
                .collect();
            let mixed = mix_rings(&drained);
            let mut buf = buffer.lock();
            // Per-app capture is ALREADY mono by the time it reaches here —
            // Windows sums the app rings in mix_rings, macOS's single tap mixes
            // the selected processes for us. So each sample is written to both
            // channels to keep the ring's interleaved shape (0.8.4).
            //
            // The consequence is real and worth stating: with a per-app source
            // selected the vectorscope shows a vertical line and correlation
            // reads exactly 1.00. That is the honest display of a mono source,
            // not a bug — only the default-device loopback path can carry a
            // true stereo image.
            if mixed.is_empty() {
                let hop = ((rate / hz.max(1) as f32) as usize).max(1);
                buf.extend(std::iter::repeat(0.0f32).take(hop * 2));
            } else {
                for s in &mixed {
                    buf.push(*s);
                    buf.push(*s);
                }
            }
            let cap = RING_CAP * 2;
            if buf.len() > cap {
                // Even drain only — see push_frames.
                let excess = buf.len() - cap;
                let drop_n = ((excess + 1) & !1).min(buf.len());
                buf.drain(..drop_n);
            }
        }

        // Snapshot the most-recent FFT_SIZE samples without holding the lock
        // across the FFT itself — keeps capture-callback contention minimal.
        // The ring is interleaved L/R, so an FFT_SIZE window of MONO needs
        // twice that many ring samples. Both the mono mixdown and the stereo
        // copy are taken under the same single lock (0.8.4).
        let need = FFT_SIZE * 2;
        let have_window = {
            let buf = buffer.lock();
            if buf.len() < need {
                false
            } else {
                let tail = &buf[buf.len() - need..];
                mono_scratch.clear();
                pairs_to_mono(tail, &mut mono_scratch);
                samples.copy_from_slice(&mono_scratch);
                stereo_tail.clear();
                stereo_tail.extend_from_slice(tail);
                true
            }
        };
        if !have_window {
            continue;
        }

        // Apply window + load into complex workspace.
        for i in 0..FFT_SIZE {
            workspace[i] = Complex32::new(samples[i] * hann[i], 0.0);
        }
        fft.process(&mut workspace);

        // Magnitudes (positive-frequency half).
        let mut bands = vec![0f32; SPECTRUM_BANDS];
        for b in 0..SPECTRUM_BANDS {
            let (start, end) = band_edges[b];
            if end <= start {
                continue;
            }
            let mut sum_sq = 0f32;
            for bin in start..end {
                let c = workspace[bin];
                sum_sq += c.re * c.re + c.im * c.im;
            }
            let avg = (sum_sq / (end - start) as f32).sqrt();
            // Convert to dB-ish, apply perceptual tilt, then normalize -60 dB → 0, 0 dB → 1.
            let db = 20.0 * (avg + 1e-10).log10() - 20.0 * (FFT_SIZE as f32).log10();
            let db_tilted = db + band_tilt[b];
            let n = normalize_db(db_tilted);
            // Peak-hold with exponential decay — the look most viz folks expect.
            let prev = smoothed[b];
            let next = if n > prev { n } else { prev * 0.86 + n * 0.14 };
            smoothed[b] = next;
            bands[b] = next;
        }

        // RMS for the ambient/particles "bass energy" use case.
        let mut sum_sq = 0f32;
        for s in samples.iter() {
            sum_sq += s * s;
        }
        let rms = (sum_sq / FFT_SIZE as f32).sqrt();
        let level = (rms * 4.0).clamp(0.0, 1.0);

        let _ = app.emit("audio:spectrum", AudioFrame { bands, level });

        // Stereo waveform (0.8.4) — the vectorscope and the correlation/width
        // meters need both channels, de-interleaved so the frontend does no
        // unpacking. Since 0.8.7 it rides its OWN opt-in flag: only bundles
        // declaring "stereo": true consume it, and riding the mono flag made
        // every waveform consumer pay double the event traffic.
        if STEREO_WAVEFORM_ENABLED.load(std::sync::atomic::Ordering::Relaxed)
            && stereo_tail.len() >= WAVEFORM_LEN * 2
        {
            let tail = &stereo_tail[stereo_tail.len() - WAVEFORM_LEN * 2..];
            let mut left = Vec::with_capacity(WAVEFORM_LEN);
            let mut right = Vec::with_capacity(WAVEFORM_LEN);
            for p in tail.chunks_exact(2) {
                left.push(sample_to_byte(p[0]));
                right.push(sample_to_byte(p[1]));
            }
            let _ = app.emit("audio:waveform_stereo", StereoWaveform { left, right });
        }

        if WAVEFORM_ENABLED.load(std::sync::atomic::Ordering::Relaxed) {
            let wave: Vec<u8> = samples[FFT_SIZE - WAVEFORM_LEN..]
                .iter()
                .map(|s| sample_to_byte(*s))
                .collect();
            let _ = app.emit("audio:waveform", wave);
        }
    }
}

/// Per-band tilt in dB, applied additively before normalization. Centered at 1 kHz
/// so mid-range music sits at the original normalization, with bass attenuated and
/// treble boosted at +3 dB/octave. Clamped to [-15, +12] dB to keep an idle noise
/// floor below the displayable range.
fn band_tilt_db(bands: usize, _max_bin: usize, _sample_rate: f32, fmin: f32, fmax: f32) -> Vec<f32> {
    let log_min = fmin.log10();
    let log_max = fmax.log10();
    (0..bands)
        .map(|b| {
            let center = 10f32.powf(log_min + (log_max - log_min) * (b as f32 + 0.5) / bands as f32);
            (3.0 * (center / 1000.0).log2()).clamp(-15.0, 12.0)
        })
        .collect()
}

fn log_band_edges(bands: usize, max_bin: usize, sample_rate: f32, fmin: f32, fmax: f32) -> Vec<(usize, usize)> {
    let log_min = fmin.log10();
    let log_max = fmax.log10();
    let bin_hz = sample_rate / (2.0 * max_bin as f32);
    let mut edges = Vec::with_capacity(bands);
    for b in 0..bands {
        let f0 = 10f32.powf(log_min + (log_max - log_min) * (b as f32) / bands as f32);
        let f1 = 10f32.powf(log_min + (log_max - log_min) * (b as f32 + 1.0) / bands as f32);
        let s = (f0 / bin_hz).floor() as usize;
        let e = (f1 / bin_hz).ceil() as usize;
        let s = s.min(max_bin);
        let e = e.min(max_bin).max(s + 1);
        edges.push((s, e));
    }
    edges
}

/// Sample-wise sum of the per-app captures for one FFT hop. Each input Vec is
/// everything one capture pushed since the last hop, already mono and all at
/// one common rate — `audio_loopback::CAPTURE_SAMPLE_RATE` (48 kHz) on
/// Windows, where every process-loopback client is pinned to it; on macOS
/// there is only ever ONE input, running at whatever rate the tap negotiated
/// with the current output device (often 44.1 kHz), so "common" is trivially
/// true and this degenerates to a clamped pass-through. Whatever the rate,
/// `SAMPLE_RATE` carries it and `process_loop` derives its band edges from
/// that, never from a constant here.
///
/// Runs are aligned at the front and shorter runs are padded with silence, so
/// an app that produced nothing (paused, muted, not running) simply
/// contributes zeros. Clamped to [-1, 1] so four loud apps can't blow past
/// full scale into the FFT. Pure — the caller drains each capture's ring and
/// hands the drained Vecs here.
///
/// Cross-app alignment is deliberately loose: packet timing can skew apps by
/// up to one hop (~30 ms) relative to each other, which is invisible in a
/// spectrum display and avoids per-capture timestamp bookkeeping.
pub fn mix_rings(drained: &[Vec<f32>]) -> Vec<f32> {
    let len = drained.iter().map(|d| d.len()).max().unwrap_or(0);
    let mut out = vec![0.0f32; len];
    for d in drained {
        for (i, s) in d.iter().enumerate() {
            out[i] += *s;
        }
    }
    for s in out.iter_mut() {
        *s = s.clamp(-1.0, 1.0);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::{mix_rings, sample_to_byte};

    #[test]
    fn silence_maps_to_center() {
        assert_eq!(sample_to_byte(0.0), 128);
    }

    #[test]
    fn full_scale_clamps() {
        assert_eq!(sample_to_byte(1.5), 255);
        assert_eq!(sample_to_byte(-1.5), 1);
        assert_eq!(sample_to_byte(1.0), 255);
        assert_eq!(sample_to_byte(-1.0), 1);
    }

    // -- mix_rings: the per-hop sample-wise sum of the per-app captures ----
    // Values are chosen to be exact in binary floating point (quarters and
    // halves) so equality assertions are legitimate.

    #[test]
    fn mix_sums_two_runs_sample_wise() {
        assert_eq!(mix_rings(&[vec![0.25, 0.5], vec![0.25, -0.25]]), vec![0.5, 0.25]);
    }

    #[test]
    fn mix_pads_shorter_runs_with_silence() {
        // The app that produced less audio this hop contributes silence for
        // the remainder — never stretched, never resampled.
        assert_eq!(mix_rings(&[vec![0.5, 0.5, 0.5], vec![0.5]]), vec![1.0, 0.5, 0.5]);
    }

    #[test]
    fn mix_clamps_to_unit_range() {
        assert_eq!(mix_rings(&[vec![0.75], vec![0.75]]), vec![1.0]);
        assert_eq!(mix_rings(&[vec![-0.75], vec![-0.75]]), vec![-1.0]);
    }

    #[test]
    fn mix_of_single_run_passes_through() {
        assert_eq!(mix_rings(&[vec![0.25, -0.5]]), vec![0.25, -0.5]);
    }

    #[test]
    fn mix_of_nothing_is_nothing() {
        assert_eq!(mix_rings(&[]), Vec::<f32>::new());
        assert_eq!(mix_rings(&[vec![], vec![]]), Vec::<f32>::new());
    }

    #[test]
    fn frame_lr_picks_channels() {
        // Mono duplicates: a mono source must read as perfectly correlated,
        // which is the honest vectorscope display for it.
        assert_eq!(super::frame_lr(&[0.5]), (0.5, 0.5));
        assert_eq!(super::frame_lr(&[0.25, -0.75]), (0.25, -0.75));
        // 5.1 and friends: the first two are FL/FR by interleave convention.
        assert_eq!(super::frame_lr(&[1.0, 2.0, 3.0, 4.0, 5.0, 6.0]), (1.0, 2.0));
        // Degenerate input must not panic.
        assert_eq!(super::frame_lr(&[]), (0.0, 0.0));
    }

    #[test]
    fn pairs_to_mono_averages_and_ignores_a_torn_frame() {
        let mut out = Vec::new();
        super::pairs_to_mono(&[1.0, -1.0, 0.5, 0.5, 2.0, 0.0], &mut out);
        assert_eq!(out, vec![0.0, 0.5, 1.0]);

        // An odd trailing sample is a frame torn at a buffer edge — drop it
        // rather than pairing it with whatever arrives next, which would swap
        // L and R for the rest of the stream.
        let mut odd = Vec::new();
        super::pairs_to_mono(&[1.0, 1.0, 9.0], &mut odd);
        assert_eq!(odd, vec![1.0]);

        let mut empty = Vec::new();
        super::pairs_to_mono(&[], &mut empty);
        assert!(empty.is_empty());
    }

    #[test]
    fn mono_source_round_trips_unchanged_through_the_stereo_ring() {
        // Regression guard for the whole point of the change: making the ring
        // stereo must not alter what the FFT sees for a mono source.
        let mono_in = [0.3f32, -0.2, 0.9, -0.9];
        let mut ring = Vec::new();
        for s in mono_in {
            let (l, r) = super::frame_lr(&[s]);
            ring.push(l);
            ring.push(r);
        }
        let mut back = Vec::new();
        super::pairs_to_mono(&ring, &mut back);
        assert_eq!(back, mono_in.to_vec());
    }

    #[test]
    fn normalize_db_anchors() {
        // Full scale saturates, the floor is exactly zero, halfway is halfway.
        assert_eq!(super::normalize_db(0.0), 1.0);
        assert_eq!(super::normalize_db(super::SPECTRUM_FLOOR_DB), 0.0);
        assert!((super::normalize_db(-40.0) - 0.5).abs() < 1e-6);
        // Below the floor still clamps rather than going negative.
        assert_eq!(super::normalize_db(-200.0), 0.0);
        assert_eq!(super::normalize_db(12.0), 1.0);
    }

    #[test]
    fn quiet_content_survives_for_sensitivity_to_amplify() {
        // The 0.8.3 bug: the floor is applied BEFORE the frontend's
        // sensitivity multiplier, so anything clamped to 0 here is gone for
        // good - `0.0 * 3.0` is still 0.0. A source at roughly half volume
        // (perceptual sliders are ~cubic, so about -18 dB) pushes ordinary
        // band levels into the -60s and -70s, which the old -60 dB floor
        // discarded outright and no amount of sensitivity could bring back.
        for db in [-62.0f32, -70.0, -78.0] {
            let n = super::normalize_db(db);
            assert!(n > 0.0, "{db} dB must survive the floor, got {n}");
            assert!(n * 3.0 > 0.05, "{db} dB at 3x sensitivity must be visible");
        }
    }
}

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
//! Which capture fills that ring buffer is swappable at runtime: either the
//! system mix (cpal loopback, above) or a single app via WASAPI process
//! loopback (`audio_loopback`). A supervisor thread owns whichever one is
//! live — see [`supervisor`] — so exactly one backend writes the ring at any
//! moment, and the frontend drives it with the `audio_set_source` command.

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use parking_lot::Mutex;
use rustfft::{num_complex::Complex32, FftPlanner};
use serde::Serialize;
use std::{
    f32::consts::PI,
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc, Arc,
    },
    thread,
    time::Duration,
};
use tauri::{AppHandle, Emitter, Runtime};

use crate::audio_source::{decide, target_exe, Active, Source};

const FFT_SIZE: usize = 2048;
const SPECTRUM_BANDS: usize = 64;
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

/// f32 [-1,1] → u8 centered at 128 (Web Audio getByteTimeDomainData convention).
fn sample_to_byte(s: f32) -> u8 {
    ((s.clamp(-1.0, 1.0) * 127.0) + 128.0) as u8
}
/// Most we'll ever buffer (samples). Caps memory if the processor stalls.
const RING_CAP: usize = FFT_SIZE * 8;

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

/// Point the visualizer at the system mix, one app, or everything-but-one-app.
/// Returns as soon as the request is queued — the swap itself happens on the
/// supervisor thread and its outcome arrives as an `audio:source` event,
/// because falling back to the mix (app not playing, old Windows) is a normal
/// result, not an error.
#[tauri::command]
pub fn audio_set_source(source: Source) -> Result<(), String> {
    let guard = CMD_TX.lock();
    let tx = guard.as_ref().ok_or("audio capture not running")?;
    tx.send(CaptureCmd::SetSource(source))
        .map_err(|e| e.to_string())
}

/// What the frontend is told about the capture after every swap.
#[derive(Clone, Serialize)]
pub struct AudioSourceState {
    pub requested: Source,
    /// "mix" | "process" — what is really feeding the ring buffer now. If the
    /// mix itself could not be opened this still reads "mix" (nothing is
    /// feeding the ring) and `reason` says why; the frontend contract is
    /// deliberately two-valued.
    pub active: &'static str,
    /// The app being listened to (or excluded); `None` whenever the mix is live.
    pub active_exe: Option<String>,
    /// False once a process activation has failed — usually a Windows build
    /// without process loopback, which is why the UI stops offering it. Not a
    /// permanent verdict: an explicit `audio_set_source` re-arms it and tries
    /// again, since the same `Err` covers transient failures too.
    pub supported: bool,
    pub reason: Option<String>,
}

/// Last state emitted on `audio:source`, so it can be *asked for* as well as
/// listened to. The startup emit almost certainly beats the webview's
/// listener registration, and polling `audio_set_source(Mix)` to find out
/// where things stand would clobber a persisted per-app source.
static LAST_STATE: Mutex<Option<AudioSourceState>> = Mutex::new(None);

/// Current capture state. Pure read — never touches the capture.
///
/// Before the supervisor's first swap (a window of a few ms at startup) this
/// reports the state it is about to establish: the system mix, nothing wrong.
#[tauri::command]
pub fn audio_get_source() -> AudioSourceState {
    LAST_STATE.lock().clone().unwrap_or(AudioSourceState {
        requested: Source::Mix,
        active: "mix",
        active_exe: None,
        supported: true,
        reason: None,
    })
}

/// Whichever capture currently owns the ring buffer. Exactly one may exist at
/// a time — Windows will not hand out a second loopback client for the same
/// target while the first lives — and this enum is what enforces that.
/// `cpal::Stream` is `!Send`, so `Live` never leaves the supervisor thread.
///
/// The `cpal::Stream` payload is held purely for its `Drop` — reading it is
/// never the point, staying alive (and then not) is — hence the allow.
#[allow(dead_code)]
enum Live {
    None,
    /// The stream, plus the flag `err_fn` clears when the endpoint dies. cpal
    /// keeps handing back a `Stream` object that feeds nothing, so the object's
    /// existence is not evidence that anything is being captured.
    Mix(cpal::Stream, Arc<AtomicBool>),
    Process(crate::audio_loopback::ProcessCapture),
}

struct Supervisor<R: Runtime> {
    app: AppHandle<R>,
    buffer: Arc<Mutex<Vec<f32>>>,
    live: Live,
    /// What `live` actually ended up being, which is not always what `decide`
    /// asked for — a failed activation lands on `Mix`. Compared against the
    /// new decision to keep `apply` idempotent.
    active: Option<Active>,
    requested: Source,
    active_exe: Option<String>,
    supported: bool,
    reason: Option<String>,
}

fn supervisor<R: Runtime>(
    app: AppHandle<R>,
    buffer: Arc<Mutex<Vec<f32>>>,
    rx: mpsc::Receiver<CaptureCmd>,
) {
    let mut sup = Supervisor {
        app,
        buffer,
        live: Live::None,
        active: None,
        requested: Source::Mix,
        active_exe: None,
        supported: true,
        reason: None,
    };
    // Startup goes through the same path as any later change, so the frontend
    // has a state event before it asks for anything.
    sup.apply(Source::Mix);

    while let Ok(cmd) = rx.recv() {
        match cmd {
            CaptureCmd::SetSource(s) => {
                // An explicit request re-arms per-app capture. `supported` is a
                // hint learned from one failed activation, and `start` returns
                // Err for plenty of transient reasons (Initialize against a
                // device being switched, the activation deadline, a busy
                // machine timing out) that have nothing to do with the Windows
                // build lacking process loopback. Suppressing retries forever
                // on that evidence would turn a UI hint into a permanent
                // feature lockout with no way back. So: the sticky bit only
                // suppresses *automatic* re-attempts (a watcher tick), never a
                // user asking for it again.
                sup.supported = true;
                sup.apply(s);
            }
        }
    }
}

impl<R: Runtime> Supervisor<R> {
    /// Swap to whatever `requested` implies right now, then report. Idempotent:
    /// re-applying the source that is already live and healthy re-emits the
    /// state without touching the capture, so callers may call it freely.
    fn apply(&mut self, requested: Source) {
        self.requested = requested;
        // "App not running" is decided here, by the session lookup — NOT by
        // `audio_loopback::start` failing. Activating against a stale or bogus
        // PID succeeds and then yields silence forever, so a missing session
        // must be caught before we ever try.
        let pid = target_exe(&self.requested).and_then(crate::mixer::find_pid_for_exe);
        let active = if self.supported {
            decide(&self.requested, pid)
        } else {
            // Activation failed the last time it was asked for, so automatic
            // re-attempts (a watcher tick) stop here rather than tearing down a
            // working mix stream on every poll. An explicit `audio_set_source`
            // clears this first, so the user is never locked out.
            Active::Mix
        };

        // Why we are not on the requested source, if we are not. Computed from
        // the decision rather than the swap, so the skip path below reports the
        // same thing a fresh swap would.
        let mut reason = match (&self.requested, active) {
            (Source::Mix, _) | (_, Active::Process { .. }) => None,
            (_, Active::Mix) if !self.supported => {
                Some("per-app capture could not be started on this machine".to_string())
            }
            (_, Active::Mix) => target_exe(&self.requested)
                .map(|t| format!("{t} has no audio session right now")),
        };

        if self.active == Some(active) && self.live_matches(active) {
            // Already exactly here, and the backend is still running. Emit
            // anyway: a caller re-asserting its source wants the state back.
            self.reason = reason;
            self.emit();
            return;
        }

        // Drop the old backend *first*, and completely. `ProcessCapture::drop`
        // joins a pump thread that blocks on `buffer.lock()`, so this must
        // happen while we hold no ring lock — and the new backend must not be
        // built until the old one has stopped writing. Written as an explicit
        // `drop` so the ordering survives future edits to this function.
        drop(std::mem::replace(&mut self.live, Live::None));
        self.active = None;

        {
            // Nothing is capturing at this instant, which is the only safe
            // moment to touch the ring. Clearing it stops the first FFT window
            // after the swap from straddling two backends at two sample rates.
            // Scoped so the lock is released before anything is constructed.
            let mut buf = self.buffer.lock();
            buf.clear();
        }

        let mut exe: Option<String> = None;
        let (live, settled, rate) = match active {
            Active::Mix => {
                let (live, rate) = open_mix_or_none(&self.buffer, &mut reason);
                (live, Active::Mix, rate)
            }
            Active::Process { pid, exclude } => {
                match crate::audio_loopback::start(pid, exclude, self.buffer.clone(), RING_CAP) {
                    Ok(cap) => {
                        let rate = cap.sample_rate();
                        exe = target_exe(&self.requested).map(str::to_string);
                        eprintln!(
                            "audio: process loopback on pid {pid} (exclude={exclude}) @ {rate} Hz"
                        );
                        (Live::Process(cap), active, rate)
                    }
                    Err(e) => {
                        eprintln!("audio: process capture failed, falling back to mix: {e}");
                        // Reported to the UI, and it stops *automatic* retries
                        // (see the branch above). Cleared again by the next
                        // explicit request, because this Err is not proof the
                        // machine can't do process loopback at all.
                        self.supported = false;
                        reason = Some(e);
                        let (live, rate) = open_mix_or_none(&self.buffer, &mut reason);
                        (live, Active::Mix, rate)
                    }
                }
            }
        };

        self.live = live;
        self.active = Some(settled);
        // Must happen on *every* swap, including the fallback paths: the FFT's
        // band edges are derived from this, so a stale value silently misplaces
        // every frequency band.
        SAMPLE_RATE.store(rate, Ordering::Relaxed);
        self.active_exe = exe;
        self.reason = reason;
        self.emit();
    }

    /// Is the live backend the one `active` calls for, and *still capturing*?
    ///
    /// Liveness is checked on both backends, not just the process one. Either
    /// client is invalidated by a default-device change
    /// (`AUDCLNT_E_DEVICE_INVALIDATED`); a dead one leaves the object intact
    /// and the ring frozen on its last samples. If this returned `true` for a
    /// dead stream, `apply` would take the skip path and the user re-selecting
    /// the same source — their only recovery affordance — would be a silent
    /// no-op.
    fn live_matches(&self, active: Active) -> bool {
        match (&self.live, active) {
            (Live::Mix(_, alive), Active::Mix) => alive.load(Ordering::Relaxed),
            (Live::Process(cap), Active::Process { .. }) => cap.is_alive(),
            _ => false,
        }
    }

    fn emit(&self) {
        let state = AudioSourceState {
            requested: self.requested.clone(),
            active: match self.live {
                Live::Process(_) => "process",
                _ => "mix",
            },
            active_exe: self.active_exe.clone(),
            supported: self.supported,
            reason: self.reason.clone(),
        };
        // Recorded before it is emitted, so `audio_get_source` can never report
        // something older than what a listener has already seen.
        *LAST_STATE.lock() = Some(state.clone());
        let _ = self.app.emit("audio:source", state);
    }
}

/// Open the system-mix capture, or give up and leave the ring unfed. Failing
/// to open the mix is not fatal — the endpoint may come back, and a later
/// source change re-tries from scratch — so it degrades to `Live::None` with
/// an explanation rather than killing the audio threads.
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

/// Build and start the cpal loopback stream on the *current* default output
/// device. Re-queried on every call so a default-device change is picked up by
/// the next swap. The returned flag is the stream's liveness — see `build_stream`.
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

    fn push_mono<I, F>(samples: I, channels: usize, buffer: &Arc<Mutex<Vec<f32>>>, to_f32: F)
    where
        I: IntoIterator,
        F: Fn(I::Item) -> f32,
    {
        let mut buf = buffer.lock();
        let mut pending: f32 = 0.0;
        let mut count: usize = 0;
        for s in samples {
            pending += to_f32(s);
            count += 1;
            if count == channels {
                buf.push(pending / channels as f32);
                pending = 0.0;
                count = 0;
            }
        }
        if buf.len() > RING_CAP {
            let drop = buf.len() - RING_CAP;
            buf.drain(..drop);
        }
    }

    match sample_format {
        cpal::SampleFormat::F32 => device
            .build_input_stream(
                config,
                move |data: &[f32], _| {
                    push_mono(data.iter().copied(), channels, &buffer, |s| s);
                },
                err_fn,
                None,
            )
            .map_err(|e| format!("build_input_stream f32: {e}")),
        cpal::SampleFormat::I16 => device
            .build_input_stream(
                config,
                move |data: &[i16], _| {
                    push_mono(data.iter().copied(), channels, &buffer, |s| {
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
                    push_mono(data.iter().copied(), channels, &buffer, |s| {
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

        // Snapshot the most-recent FFT_SIZE samples without holding the lock
        // across the FFT itself — keeps capture-callback contention minimal.
        let have_window = {
            let buf = buffer.lock();
            if buf.len() < FFT_SIZE {
                false
            } else {
                samples.copy_from_slice(&buf[buf.len() - FFT_SIZE..]);
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
            let n = ((db_tilted + 60.0) / 60.0).clamp(0.0, 1.0);
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

#[cfg(test)]
mod tests {
    use super::sample_to_byte;

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
}

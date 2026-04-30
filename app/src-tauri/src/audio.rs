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

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use parking_lot::Mutex;
use rustfft::{num_complex::Complex32, FftPlanner};
use serde::Serialize;
use std::{f32::consts::PI, sync::Arc, thread, time::Duration};
use tauri::{AppHandle, Emitter, Runtime};

const FFT_SIZE: usize = 2048;
const SPECTRUM_BANDS: usize = 64;
/// How often we re-emit a spectrum frame to the frontend.
const EMIT_HZ: u64 = 60;
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
    let host = cpal::default_host();
    let device = host
        .default_output_device()
        .ok_or_else(|| "no default output device".to_string())?;
    let supported = device
        .default_output_config()
        .map_err(|e| format!("default_output_config: {e}"))?;
    let config: cpal::StreamConfig = supported.config();
    let channels = config.channels as usize;
    let sample_rate = config.sample_rate.0 as f32;
    let sample_format = supported.sample_format();

    eprintln!(
        "audio: WASAPI loopback @ {} Hz, {} ch, {:?}",
        sample_rate as u32, channels, sample_format
    );

    let buffer = Arc::new(Mutex::new(Vec::<f32>::with_capacity(RING_CAP)));

    // Build the loopback stream — cpal recognizes "input on the default output
    // device" as a request for WASAPI loopback on Windows.
    let stream = build_stream(&device, &config, sample_format, channels, buffer.clone())?;
    stream.play().map_err(|e| format!("stream.play: {e}"))?;

    // The cpal Stream is !Send on Windows, so it has to live on this thread
    // for the lifetime of the program. Drop it and capture stops. Holding it
    // here in a binding keeps it alive for the duration of the loop below.
    let _stream_keepalive = stream;

    process_loop(app, buffer, sample_rate)
}

fn build_stream(
    device: &cpal::Device,
    config: &cpal::StreamConfig,
    sample_format: cpal::SampleFormat,
    channels: usize,
    buffer: Arc<Mutex<Vec<f32>>>,
) -> Result<cpal::Stream, String> {
    let err_fn = |err| eprintln!("audio stream error: {err}");

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
    sample_rate: f32,
) -> Result<(), String> {
    let mut planner = FftPlanner::<f32>::new();
    let fft = planner.plan_fft_forward(FFT_SIZE);
    let hann: Vec<f32> = (0..FFT_SIZE)
        .map(|i| 0.5 - 0.5 * ((2.0 * PI * i as f32 / FFT_SIZE as f32).cos()))
        .collect();

    let band_edges = log_band_edges(SPECTRUM_BANDS, FFT_SIZE / 2, sample_rate, 30.0, 16_000.0);
    let mut workspace = vec![Complex32::default(); FFT_SIZE];
    let mut samples = vec![0f32; FFT_SIZE];
    let mut smoothed = vec![0f32; SPECTRUM_BANDS];

    let frame_interval = Duration::from_millis(1000 / EMIT_HZ);

    loop {
        thread::sleep(frame_interval);

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
            // Convert to dB-ish then normalize -60 dB → 0, 0 dB → 1.
            let db = 20.0 * (avg + 1e-10).log10() - 20.0 * (FFT_SIZE as f32).log10();
            let n = ((db + 60.0) / 60.0).clamp(0.0, 1.0);
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
    }
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

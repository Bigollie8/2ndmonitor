//! Run: rustc -O scripts/bench-audio-ring.rs -o <temporary executable>
//! Microbenchmark of capture storage only; not a whole-app CPU measurement.
#[path = "../app/src-tauri/src/audio_ring.rs"]
mod audio_ring;
use std::{hint::black_box, time::Instant};

fn main() {
    const CAP_FRAMES: usize = 2048 * 8;
    const PACKETS: usize = 30_000;
    let packet: Vec<f32> = (0..960).map(|i| (i as f32 / 17.0).sin()).collect();
    let mut old = Vec::with_capacity(CAP_FRAMES * 2 + packet.len());
    let start = Instant::now();
    for _ in 0..PACKETS {
        old.extend_from_slice(black_box(&packet));
        if old.len() > CAP_FRAMES * 2 { old.drain(..old.len() - CAP_FRAMES * 2); }
        black_box(&old);
    }
    let old_time = start.elapsed();
    let mut ring = audio_ring::AudioRing::with_capacity(CAP_FRAMES * 2);
    let capacity = ring.capacity();
    let start = Instant::now();
    for _ in 0..PACKETS {
        audio_ring::push_interleaved(&mut ring, black_box(&packet), CAP_FRAMES);
        audio_ring::trim_frames(&mut ring, CAP_FRAMES);
        black_box(&ring);
    }
    let new_time = start.elapsed();
    assert_eq!(ring, old);
    assert_eq!(ring.capacity(), capacity);
    println!("{PACKETS} stereo packets, identical final samples; no ring growth");
    println!("Vector front-drain: {old_time:?}; circular buffer: {new_time:?}");
}

/// VecDeque is a circular buffer: evicting old samples advances the head
/// instead of moving the retained audio on every capture callback.
pub(crate) type AudioRing = std::collections::VecDeque<f32>;

/// Make room for an entire packet once, then append without per-sample cap
/// checks. Return the number of oldest incoming frames to skip for an
/// oversized packet. All evictions preserve L/R alignment.
pub(crate) fn prepare_packet(buf: &mut AudioRing, incoming_frames: usize, cap_frames: usize) -> usize {
    let keep = incoming_frames.min(cap_frames);
    let retain = (cap_frames - keep) * 2;
    if buf.len() > retain { buf.drain(..buf.len() - retain); }
    incoming_frames - keep
}

pub(crate) fn push_interleaved(buf: &mut AudioRing, samples: &[f32], cap_frames: usize) {
    let frames = samples.len() / 2;
    let skip = prepare_packet(buf, frames, cap_frames);
    buf.extend(samples[skip * 2..frames * 2].iter().copied());
}

pub(crate) fn push_silence(buf: &mut AudioRing, frames: usize, cap_frames: usize) {
    let skip = prepare_packet(buf, frames, cap_frames);
    buf.extend(std::iter::repeat(0.0).take((frames - skip) * 2));
}

/// Drop the oldest samples once a ring exceeds `cap_frames` frames. Always an
/// even count: an odd drain would swap L and R for the entire remainder of
/// the stream — silent, permanent, and invisible until someone opened a
/// vectorscope. Every ring writer (cpal `push_frames`, the apps-mode
/// `append_hop`, `audio_loopback`, `audio_tap`) trims through here so the
/// invariant has exactly one implementation.
pub(crate) fn trim_frames(buf: &mut AudioRing, cap_frames: usize) {
    let cap = cap_frames * 2;
    if buf.len() > cap {
        let excess = buf.len() - cap;
        let drop = ((excess + 1) & !1).min(buf.len());
        buf.drain(..drop);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn oversized_packet_keeps_latest_complete_frames_without_growth() {
        let mut ring = AudioRing::with_capacity(4);
        let capacity = ring.capacity();
        push_interleaved(&mut ring, &[1.0, -1.0, 2.0, -2.0, 3.0, -3.0, 99.0], 2);
        assert_eq!(ring, vec![2.0, -2.0, 3.0, -3.0]);
        assert_eq!(ring.capacity(), capacity);
        push_silence(&mut ring, 50, 2);
        assert_eq!(ring, vec![0.0; 4]);
        assert_eq!(ring.capacity(), capacity);
    }

    #[test]
    fn wrapped_tail_matches_linear_reference_across_packet_sizes() {
        let mut ring = AudioRing::with_capacity(16);
        let mut reference = Vec::new();
        for frames in [1, 7, 3, 9, 2, 8, 0, 4] {
            let packet: Vec<_> = (0..frames * 2).map(|i| i as f32).collect();
            reference.extend_from_slice(&packet);
            if reference.len() > 16 { reference.drain(..reference.len() - 16); }
            push_interleaved(&mut ring, &packet, 8);
            assert_eq!(ring, reference);
        }
    }
}

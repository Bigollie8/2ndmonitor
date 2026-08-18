# Beatgrid

Musically-synced visuals. With Spotify connected, the host hands this bundle
the current track's analysed beat/bar/section grid (`f.sync`), and everything
fires on the music's actual structure: cells flip per beat, the frame flashes
per bar, the palette rotates per section, and brightness follows each
section's mastered loudness.

Honest fallback: without a grid — Spotify not connected, nothing playing, or
the audio-analysis endpoint unavailable (Spotify deprecated it for API apps
created after Nov 2024) — the same visuals run from live onset envelopes and
the corner tag reads "live" instead of "synced".

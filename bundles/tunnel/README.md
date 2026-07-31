# Waveform Tunnel

6 layered waveform paths with per-layer blur, riding bass/mid/treble energy
and a 64-bin spectrum. Migrated from the built-in `tunnel` style. No
permissions, no network, no settings.

DOM surface (`surface: "dom"`) built from inline SVG paths. Its N=64 reader
in the original matches the host's own N=64 spectrum reader exactly, so
this is the one style in this batch with no bin-resolution gap between the
port and the original. The phase clock `t` advances scaled by `f.dt` so its
speed doesn't depend on frame rate.

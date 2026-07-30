# Oscilloscope

CRT-phosphor oscilloscope trace, spectrum-driven amplitude riding a
slow-moving carrier wave over a faint grid. Migrated from the built-in
`scope` style. No permissions, no network, no settings.

Known delta: `bass`/`mid`/`treble` are derived locally from `viz.bins(128)`
(the host's `f.bands` is computed at 64 bins and isn't valid at K=128) using
the same boundary formula the host uses, so they match the original exactly.

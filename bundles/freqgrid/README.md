# Frequency Grid

A 32x16 bar grid: 16 frequency rows scrolling across 32 columns of history,
read from a 16-bin spectrum. Migrated from the built-in `freqgrid` style.
No permissions, no network, no settings.

DOM surface (`surface: "dom"`) built from divs. Keeps a 32-column ring
buffer of 16-bin history rows, advanced by one column per rendered frame
(matching the original and the already-ported `spectrogram` bundle's
scroll-per-frame history — not `f.dt`-scaled, since it's a discrete push,
not a continuous accumulator). Row colors are cached and only rewritten
when `accent`/`accent2` change.

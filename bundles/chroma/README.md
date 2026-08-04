# Chroma wheel

The 12 pitch classes as a radial meter, naming the strongest one. Watch it
and you can see chord changes happen.

## Notes

Folds the host's log-spaced spectrum onto pitch classes (`bin i -> i % 12`).
That is an APPROXIMATION, not a constant-Q transform: it tracks sustained
notes and chord changes well and is unreliable on dense percussive material.
A real constant-Q (ShowCQTBar / Meyda) is the upgrade path.

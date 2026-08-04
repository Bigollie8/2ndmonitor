# Beat lab

Onset strength scrolling with a threshold line and beat markers, a
brightness (spectral centroid) track, and a live BPM readout.

## Notes

Spectral flux is computed in the bundle - one positive-difference pass
against the previous frame's bins. The host's own smoothed `onset` scalar is
used only to flash the BPM readout, because the point of this style is
showing the raw curve a detector actually works from. BPM uses hysteresis so
one long transient is not counted as several beats.

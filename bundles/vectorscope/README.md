# Vectorscope

The stereo field as engineers see it: a mid/side point cloud - tall means
mono, wide means spacious - with live correlation and width meters.

## Notes

Needs both channels, so it requires 0.8.4 or newer.

A mono source has left === right, so the cloud collapses to a vertical line
and correlation reads 1.00. That is the correct display of a mono signal, not
a failure. The meter says "mono source" when it detects this, so the vertical
line is never mistaken for a bug. (Before app version 0.9.4, per-app capture
was mixed to mono before it reached the host and always drew this line; every
source carries a true stereo image now.)

Negative correlation is drawn in red: it means the channels partly cancel
when summed to mono.

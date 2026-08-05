# Vectorscope

The stereo field as engineers see it: a mid/side point cloud - tall means
mono, wide means spacious - with live correlation and width meters.

## Notes

Needs both channels, so it requires 0.8.4 or newer.

A mono source has left === right, so the cloud collapses to a vertical line
and correlation reads 1.00. That is the correct display of a mono signal, not
a failure - and it includes ANY per-app audio source, because per-app capture
is mixed to mono before it reaches the host. Only the default-device source
carries a true stereo image. The meter says "mono source" when it detects
this, so the vertical line is never mistaken for a bug.

Negative correlation is drawn in red: it means the channels partly cancel
when summed to mono.

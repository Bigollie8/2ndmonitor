# Loudness console

L/R meters with peak-hold, a rolling level history, and live numbers: peak,
RMS, crest factor and correlation. For people who want the data rather than
the light show.

## Notes

Needs both channels, so it requires 0.8.4 or newer.

Labelled RMS, not LUFS, deliberately: these are plain RMS windows with no
K-weighting and no gating, so calling them LUFS would be wrong. Real loudness
metering is a later job.

Crest factor (peak minus RMS) is the dynamics readout - a heavily compressed
master sits near 6 dB, an untouched mix nearer 15.

A genuinely mono source tracks both meters together and reads 1.00
correlation. (Per-app capture carried only mono before app version 0.9.3;
every source is true stereo now.)

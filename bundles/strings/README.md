# Strings

Physically-modeled vibrating strings across a fretboard, plucked on kick/
snare/hat onset edges and continuously excited by their own spectrum bin.
Migrated from the built-in `strings` style. No permissions, no network, no
settings.

Known delta: the pluck onsets (`onset.kick/snare/hat`) are stateful and
computed by the host at 64 bins, vs. the original's 32 — pluck thresholds
were tuned against 32-bin onsets, so pluck frequency may differ slightly from
the built-in original.

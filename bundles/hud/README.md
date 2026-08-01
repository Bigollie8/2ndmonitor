# Aircraft HUD

Fictional aircraft heads-up display — altitude/speed tapes, a compass ribbon,
a pitch ladder and a bottom spectrum strip, all driven by frequency bands and
onsets. Migrated from the built-in `hud` style. No permissions, no network,
no settings.

Known delta: `bass`/`mid`/`treble` are derived locally from `viz.bins(32)`
(the host's `f.bands` is computed at 64 bins and isn't valid at K=32) using
the same boundary formula the host uses, so they match the original exactly.
`onset.kick` (the lock-indicator flash) is NOT re-derived — it's stateful and
the host computes it at 64 bins vs. the original's 32, so it may trigger a
hair earlier/later than it used to.

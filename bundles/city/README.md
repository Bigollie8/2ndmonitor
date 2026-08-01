# Neon city

Night-time skyline silhouette under a bass-pulsing moon, with foreground
building windows lighting on their assigned frequency bin. Migrated from the
built-in `city` style. No permissions, no network, no settings.

Known delta: `bass` is derived locally from `viz.bins(24)` (the host's
`f.bands.bass` is computed at 64 bins and isn't valid at K=24) using the same
boundary formula the host uses, so it matches the original exactly.

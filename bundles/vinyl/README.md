# Vinyl

A spinning record with an album-art label, a kick-reactive glow ring, and a
multi-piece SVG tonearm that parks when playback stops. Migrated from the
built-in `vinyl` style. No permissions, no network, no settings.

DOM surface (`surface: "dom"`) built from divs (disc/label/glow) plus an
inline SVG tonearm. Reads `f.playback` (defaulting to "playing" when null,
matching the original's first-paint behavior) and drives disc rotation off
`f.bands.bass` and the glow ring off `f.onset.kick`, both `f.dt`-scaled so
speed doesn't depend on frame rate. The frame contract has no album-art
field, so the label always shows the theme-gradient fallback — real cover
art from GSMTC is not reproducible in the sandbox.

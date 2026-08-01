# Minimal Dots

Three dots that size-pulse to bass/mid/treble, read from a 16-bin
spectrum. Migrated from the built-in `minimal` style. No permissions, no
network, no settings.

DOM surface (`surface: "dom"`) built from plain divs. No cross-frame
state — each dot's scale is recomputed straight from the current frame's
bins. Dot colors are cached and only rewritten when `accent`/`accent2`
change.

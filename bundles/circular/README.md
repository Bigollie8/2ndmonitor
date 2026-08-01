# Circular Pulse

96 radial spokes around a bass-reactive glowing disc, read from a 96-bin
spectrum. Migrated from the built-in `circular` style. No permissions, no
network, no settings.

DOM surface (`surface: "dom"`) built from inline SVG (`document`.
`createElementNS`) rather than divs — lines and the disc are real
namespaced SVG elements, updated per frame via `setAttribute`. The bass
envelope driving the disc radius uses `f.dt`-scaled exponential decay so its
speed doesn't depend on frame rate.

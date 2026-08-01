# Pixel LED

A 32x20 retro LED grid, colored per-cell with a heat map (accent to accent2
to red) from a 32-bin spectrum read. Migrated from the built-in `pixelled`
style. No permissions, no network, no settings.

DOM surface (`surface: "dom"`) — 640 `<div>` cells, each cell's background,
glow, and opacity rewritten every frame straight from the current bin value
(there's no steady-theme case to cache here, since a cell's color always
depends on the live audio value, not on theme alone).

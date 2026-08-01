# Ribbon

A single filled symmetric ribbon shape built from a 48-bin spectrum read.
Migrated from the built-in `ribbon` style. No permissions, no network, no
settings.

DOM surface (`surface: "dom"`) built from a single inline SVG `<path>`,
rebuilt every frame from the current bins. The gradient fill's stops are
cached and only rewritten when `accent`/`accent2` change.

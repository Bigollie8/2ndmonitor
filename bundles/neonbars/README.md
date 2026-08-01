# Neon Bars

Glowing mirrored bars, 56 across, each scaled vertically from a 56-bin
spectrum read. Migrated from the built-in `neonbars` style. No permissions,
no network, no settings.

First bundle to use the DOM surface (`surface: "dom"` in manifest.json)
instead of canvas — bars are real `<div>` elements with a CSS gradient
background and box-shadow glow, transformed with `scaleY` per frame, rather
than drawn with 2D canvas calls.

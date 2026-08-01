# Split Mirror

A glowing center line with 80 gradient bars, mirrored top and bottom, each
scaled vertically from an 80-bin spectrum read. Migrated from the built-in
`splitmirror` style. No permissions, no network, no settings.

DOM surface (`surface: "dom"`) — bars are real `<div>` elements transformed
with `scaleY` per frame, same technique as `neonbars`. Only `accent` drives
the color (the original never uses `accent2`).

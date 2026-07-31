# Kaleidoscope

12 rotating, spectrum-scaled diamonds blended with `screen`, read from a
12-bin spectrum. Migrated from the built-in `kaleidoscope` style. No
permissions, no network, no settings.

DOM surface (`surface: "dom"`) built from inline SVG polygons. Rotation
phase advances with `f.dt`-scaled time so speed doesn't depend on frame
rate. Fill colors are cached and only rewritten when `accent`/`accent2`
change.

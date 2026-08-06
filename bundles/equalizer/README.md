# Equalizer

The classic segmented LED spectrum analyzer: 20 frequency bands, 24 LED
blocks each, lit from the bottom with instant attack, slow release, and a
peak-hold cap that hangs before falling — hardware-EQ ballistics rather than
raw spectrum tracking.

Colours ramp from the theme's accent (bottom) to accent2 (top); unlit blocks
stay faintly visible so the grid reads as a device even in silence. Canvas
surface; honours the host's FPS/DPR caps and shared procedural fallback like
every official bundle.

Note for the requester: this is a *visual* equalizer (a display). It does not
modify the audio — the app only reads the system's sound to draw with; it
never processes or routes what you hear.

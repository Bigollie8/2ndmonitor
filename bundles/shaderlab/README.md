# Shader Lab

A Shadertoy-compatible GLSL host. Shaders implement the standard contract —
`void mainImage(out vec4 fragColor, in vec2 fragCoord)` — with the standard
uniforms (`iResolution`, `iTime`, `iTimeDelta`, `iFrame`, `iMouse`, `iDate`,
`iSampleRate`) and `iChannel0` bound to the classic **512×2 audio texture**:
row 0 is the FFT (the host's 64 log-spaced bins resampled to 512), row 1 is
the raw waveform. Helpers `fft(x)` and `wave(x)` are prepended for the
bundled shaders. Two optional extras carry the app's accent colors:
`iAccent` / `iAccent2`.

Eight original shaders ship built in. Click the surface to switch (the left
third goes back); the selection persists per install.

**Licence note:** Shadertoy's site default is CC BY-NC-SA — every shader
bundled here is original to this project. If you port a shader from
elsewhere, check its licence first.

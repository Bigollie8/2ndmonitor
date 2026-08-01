import { baseVals, wave, shape, type OriginalPreset } from './base';
import { vec3, type Palette } from './palette';

// "Tron City" — flying down a canyon of glowing towers; light cycles race the
// canyon floor and ships cross the sky. Fully procedural in the comp shader.
// Bass pulses the tower windows; treble drives the cycle streaks.
export function build(p: Palette): OriginalPreset {
  const A = vec3(p.a);
  const B = vec3(p.b);
  return {
    baseVals: baseVals({
      decay: 0.9,
    }),
    waves: [wave(), wave(), wave(), wave()],
    shapes: [shape(), shape(), shape(), shape()],
    init_eqs_str: '',
    frame_eqs_str: '',
    pixel_eqs_str: '',
    warp: `shader_body {
  ret = texture(sampler_main, uv).rgb * 0.9;
}`,
    comp: `float hash1(float n) { return fract(sin(n * 127.1) * 43758.5453); }
float gline(float p, float w) {
  float d = abs(fract(p) - 0.5);
  return smoothstep(w, 0.0, 0.5 - d);
}
shader_body {
  float asp = resolution.x / resolution.y;
  vec2 c = vec2((uv.x - 0.5) * asp, uv.y - 0.52);   // camera axis
  float fly = time * 3.0;
  vec3 col = vec3(0.0);

  // ── canyon walls (x = ±0.55) ──────────────────────────────────────────────
  float px = abs(c.x) + 1e-4;
  float zWall = 0.55 / px;                          // distance to wall hit
  float wy = c.y * zWall;                           // height on the wall
  float wz = zWall + fly;                           // depth along the canyon
  float wallFog = exp(-zWall * 0.09);

  // towers: blocks along the canyon with hashed heights (wy<0 is up)
  float bi = floor(wz / 2.6) + step(0.0, c.x) * 57.0;
  float bh = 0.35 + 1.1 * hash1(bi);
  float inWall = step(-bh, wy);                      // below rooftop = wall
  float roof = exp(-abs(wy + bh) * 14.0) * step(zWall, 40.0);
  // dim walls that are extremely close so they don't become neon wallpaper
  float closeFade = smoothstep(0.35, 1.3, zWall);

  if (inWall > 0.5) {
    // vertical seams where tower blocks meet
    float vseam = smoothstep(0.06, 0.0, abs(fract(wz / 2.6) - 0.5) - 0.42);
    // window grid
    vec2 wcell = floor(vec2(wz * 4.0, wy * 7.0));
    float lit = step(0.55, hash1(wcell.x * 13.7 + wcell.y * 5.1 + bi));
    float wdot = step(0.3, fract(wz * 4.0)) * step(fract(wz * 4.0), 0.7)
               * step(0.25, fract(wy * 7.0)) * step(fract(wy * 7.0), 0.75);
    vec3 wcol = mix(${A}, ${B}, step(0.86, hash1(wcell.y * 7.3 + bi)));
    col += wcol * wdot * lit * wallFog * closeFade * (0.55 + 0.35 * min(1.2, bass_att));
    col += ${A} * vseam * wallFog * closeFade * 0.5;
    // ambient wall face
    col += ${A} * 0.015 * wallFog * closeFade;
  } else {
    // sky between rooftops: stars + ships
    vec2 cell = floor(uv * vec2(asp, 1.0) * 130.0);
    float star = step(0.9985, fract(sin(dot(cell, vec2(12.9898, 78.233))) * 43758.5453));
    col += vec3(0.6, 0.85, 1.0) * star * 0.3;

    float pass_ = floor(time / 6.0);
    float sdir = sign(hash1(pass_ + 0.7) - 0.5);
    float sx = mix(-0.15, 1.15, fract(time / 6.0));
    sx = sdir > 0.0 ? sx : 1.0 - sx;
    float sy = 0.08 + 0.2 * hash1(pass_);
    vec2 sd = (uv - vec2(sx, sy)) * vec2(asp, 1.0);
    float body = exp(-(sd.y * sd.y * 9000.0 + sd.x * sd.x * 800.0));
    float behind = max(0.0, -sd.x * sdir);
    float trail = exp(-sd.y * sd.y * 15000.0) * exp(-behind * 10.0) * step(0.001, behind);
    col += mix(${A}, vec3(1.0), 0.5) * body * 1.3 + ${A} * trail * 0.45;
  }
  col += ${A} * roof * wallFog * closeFade * 0.9;

  // ── canyon floor (occlusion against the walls via step(zF, zWall)) ───────
  if (c.y > 0.015) {
    float zF = 0.09 / c.y;                          // distance to floor hit
    float fx = c.x * zF;                            // lateral position
    float fz = zF + fly;
    float fog = exp(-zF * 0.12);
    float lines = max(gline(fx * 3.2, 0.05), gline(fz * 0.9, 0.05));
    vec3 floorCol = ${A} * lines * fog * 0.5;

    // two light cycles racing down the floor, streak packets moving forward
    float lcA = exp(-pow((fx + 0.21), 2.0) * 900.0);
    float lcB = exp(-pow((fx - 0.21), 2.0) * 900.0);
    float packetA = 0.45 + 0.55 * gline(fz * 0.55 - time * 2.6, 0.3);
    float packetB = 0.45 + 0.55 * gline(fz * 0.55 - time * 3.1 + 0.5, 0.3);
    float tr = 0.7 + 0.5 * min(1.2, treb_att);
    floorCol += ${A} * lcA * packetA * fog * 1.6 * tr;
    floorCol += ${B} * lcB * packetB * fog * 1.6 * tr;

    // floor only where the wall isn't nearer than the floor hit
    float vis = step(zF, zWall);
    col = mix(col, floorCol, vis);
    col += ${A} * exp(-abs(c.y) * 60.0) * 0.25;     // glow seam at the axis
  }

  // center-of-canyon depth glow
  float dCore = length(vec2(c.x, c.y * 1.6));
  col += mix(${A}, vec3(1.0), 0.3) * exp(-dCore * 9.0) * (0.2 + 0.15 * mid_att);

  // faint feedback shimmer + scanlines + vignette
  col += texture(sampler_blur2, uv).rgb * 0.18;
  col *= 1.0 - 0.04 * sin(uv.y * resolution.y * 3.14159);
  float vig = 1.0 - 0.4 * pow(length(uv_orig - 0.5), 1.9);
  ret = col * vig;
}`,
  };
}

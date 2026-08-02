import { baseVals, wave, shape, type OriginalPreset } from './base';
import { vec3, type Palette } from './palette';

// "The Grid" — perspective floor scrolling to a glowing horizon, energy sky
// fed by a waveform drawn into the feedback buffer. Bass pulses line glow.
export function build(p: Palette): OriginalPreset {
  const A = vec3(p.a);
  const B = vec3(p.b);
  return {
    baseVals: baseVals({
      decay: 0.94,
      // basic waveform drawn into the buffer becomes the sky energy
      wave_mode: 6, wave_a: 0.55, wave_x: 0.5, wave_y: 0.72, wave_scale: 0.8,
      wave_r: p.a.r, wave_g: p.a.g, wave_b: p.a.b,
      additivewave: 1, wave_thick: 1, wave_smoothing: 0.85,
      zoom: 1.003, warp: 0,
    }),
    waves: [wave(), wave(), wave(), wave()],
    shapes: [shape(), shape(), shape(), shape()],
    init_eqs_str: '',
    frame_eqs_str: 'a.wave_a=0.35+0.4*Math.min(1,a.treb_att);',
    pixel_eqs_str: '',
    warp: `shader_body {
  ret = texture(sampler_main, uv).rgb * 0.94;
}`,
    comp: `float gline(float p, float w) {
  float d = abs(fract(p) - 0.5);
  return smoothstep(w, 0.0, 0.5 - d);
}
float hash1(float n) { return fract(sin(n * 127.1) * 43758.5453); }
shader_body {
  float asp = resolution.x / resolution.y;
  float h = 0.58;                       // horizon (uv.y grows downward)
  vec3 col = vec3(0.0);
  float pulse = 0.75 + 0.45 * min(1.5, bass_att);

  if (uv.y > h) {
    // perspective floor
    float w = 1.0 / (uv.y - h + 0.02);
    float gx = (uv.x - 0.5) * w * asp * 1.6;
    float gz = w * 1.3 + time * 2.2;
    float aa = w * 0.02 + 0.035;
    float lines = max(gline(gx, aa), gline(gz, aa));
    float fade = exp(-(w - 1.0) * 0.16);
    col += ${A} * lines * fade * pulse * 1.15;
    // faint floor haze between lines
    col += ${A} * 0.05 * fade;
  } else {
    // sky: energy clouds from the blurred feedback buffer
    float skyFade = smoothstep(h, h - 0.55, uv.y);
    vec3 sky = texture(sampler_blur2, uv).rgb;
    col += sky * 0.85 * (0.4 + 0.6 * skyFade);
    // sparse starfield
    vec2 cell = floor(uv * vec2(asp, 1.0) * 140.0);
    float star = step(0.998, fract(sin(dot(cell, vec2(12.9898, 78.233))) * 43758.5453));
    col += vec3(0.6, 0.85, 1.0) * star * (0.25 + 0.15 * sin(time * 3.0 + cell.x));

    // ship: a glowing dart crossing the sky, new pass every ~7s
    float pass_ = floor(time / 7.0);
    float sdir = sign(hash1(pass_ + 0.7) - 0.5);
    float sx = mix(-0.15, 1.15, fract(time / 7.0));
    sx = sdir > 0.0 ? sx : 1.0 - sx;
    float sy = 0.16 + 0.26 * hash1(pass_);
    vec2 sd = (uv - vec2(sx, sy)) * vec2(asp, 1.0);
    float body = exp(-(sd.y * sd.y * 9000.0 + sd.x * sd.x * 700.0));
    float behind = max(0.0, -sd.x * sdir);
    float trail = exp(-sd.y * sd.y * 14000.0) * exp(-behind * 16.0) * step(0.001, behind);
    col += mix(${A}, vec3(1.0), 0.5) * body * 1.4;
    col += ${A} * trail * 0.35;
    col += ${B} * exp(-dot(sd, sd) * 5000.0) * 0.8;
  }

  // city skyline on the horizon — two parallax layers of glowing towers
  // far layer: dense, dim
  {
    float bx = uv.x * asp * 26.0 + 3.0;
    float bi = floor(bx);
    float bh = 0.02 + 0.075 * hash1(bi) * (0.6 + 0.4 * sin(bi * 1.7));
    float top = h - bh;
    float inB = step(top, uv.y) * step(uv.y, h + 0.001);
    float roof = exp(-abs(uv.y - top) * 300.0);
    col = mix(col, col * 0.15 + ${A} * 0.045, inB);       // dark silhouette
    col += ${A} * roof * inB * 0.35;
  }
  // near layer: sparse, taller, brighter, windows
  {
    float bx = uv.x * asp * 11.0 + 40.0;
    float bi = floor(bx);
    float on = step(0.35, hash1(bi + 0.3));               // gaps between towers
    float bh = (0.05 + 0.14 * hash1(bi)) * on;
    float top = h - bh;
    float inB = step(top, uv.y) * step(uv.y, h + 0.001) * on;
    col = mix(col, vec3(0.0) + ${A} * 0.02, inB);         // near-black tower
    float roof = exp(-abs(uv.y - top) * 400.0);
    float side = smoothstep(0.5, 0.485, abs(fract(bx) - 0.5));
    col += ${A} * roof * inB * 0.9;                        // rooftop edge glow
    col += ${A} * (1.0 - side) * inB * 0.5;                // side edge glow
    // window grid, flickering with treble
    vec2 wcell = floor(vec2(bx * 6.0, uv.y * 160.0));
    float lit = step(0.72, hash1(wcell.x * 13.7 + wcell.y * 5.1));
    float wdot = step(0.35, fract(bx * 6.0)) * step(fract(bx * 6.0), 0.65)
               * step(0.3, fract(uv.y * 160.0)) * step(fract(uv.y * 160.0), 0.7);
    col += mix(${A}, ${B}, step(0.85, hash1(wcell.y * 7.3 + wcell.x)))
           * wdot * lit * inB * (0.5 + 0.3 * min(1.0, treb_att));
  }

  // horizon glow + antagonist ember line just above it
  float dh = abs(uv.y - h);
  col += ${A} * exp(-dh * 34.0) * (0.55 + 0.3 * pulse);
  col += ${B} * exp(-dh * 130.0) * 0.4;

  // portal glow on the horizon center (behind the skyline)
  float dPortal = length((uv - vec2(0.5, h)) * vec2(asp, 1.0));
  col += mix(${A}, vec3(1.0), 0.35) * exp(-dPortal * 10.0) * (0.25 + 0.2 * mid_att);

  // scanlines + vignette
  col *= 1.0 - 0.07 * sin(uv.y * resolution.y * 3.14159);
  float vig = 1.0 - 0.45 * pow(length(uv_orig - 0.5), 1.8);
  ret = col * vig;
}`,
  };
}

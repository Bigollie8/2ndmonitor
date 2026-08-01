import { baseVals, wave, shape, type OriginalPreset } from './base';
import { vec3, type Palette } from './palette';

// "Recognizer" — hollow angular frames hover and pulse over a dim grid;
// feedback zoom turns each frame into receding echo ghosts.
export function build(p: Palette): OriginalPreset {
  return {
    baseVals: baseVals({
      decay: 0.9,
      zoom: 1.012, rot: 0.0,
    }),
    waves: [wave(), wave(), wave(), wave()],
    shapes: [
      // outer cyan frame — breathes with bass
      shape(
        {
          enabled: 1, sides: 4, thickoutline: 1, additive: 1,
          x: 0.5, y: 0.48, rad: 0.34, ang: 0.785,
          a: 0, a2: 0,
          border_r: p.a.r, border_g: p.a.g, border_b: p.a.b, border_a: 0.9,
        },
        { frame: 'a.x=0.5+0.07*Math.sin(a.time*0.21);a.rad=0.30+0.07*Math.min(1.2,a.bass_att);a.ang=0.785+0.07*Math.sin(a.time*0.4);' },
      ),
      // inner orange frame — counter-rotates, mid-driven (non-additive so the
      // orange doesn't wash to yellow over the cyan haze)
      shape(
        {
          enabled: 1, sides: 4, thickoutline: 1, additive: 0,
          x: 0.5, y: 0.48, rad: 0.2, ang: 0,
          a: 0, a2: 0,
          border_r: p.b.r, border_g: p.b.g, border_b: p.b.b, border_a: 0.95,
        },
        { frame: 'a.x=0.5+0.07*Math.sin(a.time*0.21);a.rad=0.16+0.05*Math.min(1.2,a.mid_att);a.ang=-0.06*a.time;' },
      ),
      // core eye — solid, flickers with treble
      shape(
        {
          enabled: 1, sides: 24, additive: 1,
          x: 0.5, y: 0.48, rad: 0.035,
          r: 1, g: 1, b: 1, a: 0.8, r2: p.a.r, g2: p.a.g, b2: p.a.b, a2: 0.3,
          border_a: 0,
        },
        { frame: 'a.x=0.5+0.07*Math.sin(a.time*0.21);a.a=0.5+0.5*Math.min(1,a.treb_att);' },
      ),
      shape(),
    ],
    init_eqs_str: '',
    frame_eqs_str: '',
    pixel_eqs_str: '',
    warp: `shader_body {
  vec3 crisp = texture(sampler_main, uv).rgb;
  vec3 soft = texture(sampler_blur1, uv).rgb;
  ret = mix(crisp, soft, 0.18) * 0.93;
}`,
    comp: `float gline(float p, float w) {
  float d = abs(fract(p) - 0.5);
  return smoothstep(w, 0.0, 0.5 - d);
}
shader_body {
  float asp = resolution.x / resolution.y;
  vec3 col = texture(sampler_main, uv).rgb;
  col += texture(sampler_blur2, uv).rgb * 0.6;

  // dim perspective floor under the recognizer
  float h = 0.8;
  if (uv.y > h) {
    float w = 1.0 / (uv.y - h + 0.02);
    float gx = (uv.x - 0.5) * w * asp * 1.4;
    float gz = w * 1.1 + time * 0.9;
    float lines = max(gline(gx, 0.05), gline(gz, 0.05));
    col += ${vec3(p.a)} * lines * exp(-(w - 1.0) * 0.2) * 0.35;
  }

  // ambient haze so the black isn't dead
  float d = length((uv - vec2(0.5, 0.48)) * vec2(asp, 1.0));
  col += ${vec3(p.a)} * exp(-d * 5.0) * 0.05;
  col += ${vec3(p.b)} * exp(-d * 16.0) * 0.03;

  col *= 1.0 - 0.06 * sin(uv.y * resolution.y * 3.14159);
  float vig = 1.0 - 0.45 * pow(length(uv_orig - 0.5), 1.9);
  ret = col * vig;
}`,
  };
}

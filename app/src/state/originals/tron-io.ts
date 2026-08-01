import { baseVals, wave, shape, type OriginalPreset } from './base';
import { vec3, type Palette } from './palette';

// "I/O Beam" — a radial beam array reads the bands (bass center → treble rim);
// beat rings radiate outward through the zooming feedback buffer.
export function build(p: Palette): OriginalPreset {
  return {
    baseVals: baseVals({
      decay: 0.93,
      zoom: 1.03, warp: 0,
    }),
    waves: [wave(), wave(), wave(), wave()],
    shapes: [
      // beat ring: born small and bright on bass, feedback radiates it
      shape(
        {
          enabled: 1, sides: 48, thickoutline: 1, additive: 1,
          x: 0.5, y: 0.5, rad: 0.16,
          a: 0, a2: 0,
          border_r: p.a.r, border_g: p.a.g, border_b: p.a.b, border_a: 0.0,
        },
        {
          frame: 'a.border_a=Math.max(0,Math.min(1,(a.bass_att-1.05)*2.2));a.rad=0.14+0.05*Math.min(1.4,a.bass_att);',
        },
      ),
      shape(), shape(), shape(),
    ],
    init_eqs_str: '',
    frame_eqs_str: '',
    pixel_eqs_str: '',
    warp: `shader_body {
  ret = texture(sampler_main, uv).rgb * 0.945;
}`,
    comp: `shader_body {
  float asp = resolution.x / resolution.y;
  vec2 c = (uv - 0.5) * vec2(asp, 1.0);
  float d = length(c);
  float an = atan(c.y, c.x);

  vec3 col = texture(sampler_main, uv).rgb * 0.9;
  col += texture(sampler_blur2, uv).rgb * 0.5;

  // 16 beams with strongly varied per-beam levels so the burst reads as an
  // equalizer, not a uniform star
  float nBeams = 16.0;
  float beam = fract(an / 6.28318 * nBeams + 0.5) - 0.5;
  float beamId = floor(an / 6.28318 * nBeams + 0.5);
  float wob = texture(sampler_noise_lq, vec2(beamId / nBeams, time * 0.13)).r;
  float wob2 = texture(sampler_noise_lq, vec2(beamId / nBeams + 0.37, time * 0.21)).r;
  float level = mix(mid_att, treb_att, wob) * (0.25 + 0.75 * wob2);
  float len = 0.08 + 0.34 * min(1.3, abs(level));
  float along = smoothstep(len + 0.02, len - 0.06, d) * smoothstep(0.035, 0.05, d);
  float line = smoothstep(0.028, 0.0, abs(beam) * d * 6.28318 / nBeams * 6.0);
  // every 6th beam runs antagonist orange
  vec3 beamCol = mix(${vec3(p.a)}, ${vec3(p.b)}, step(0.5, fract(beamId / 6.0 + 0.08)) * 0.0 + step(4.5, mod(beamId, 6.0)));
  col += beamCol * line * along * (0.5 + 0.4 * min(1.2, vol_att * 0.5));

  // core: white-hot center pulsing with volume
  col += mix(${vec3(p.a)}, vec3(1.0), 0.55) * exp(-d * 16.0) * (0.5 + 0.5 * min(1.5, bass_att));
  // outer ring boundary
  col += ${vec3(p.a)} * smoothstep(0.015, 0.0, abs(d - 0.46)) * 0.35;

  col *= 1.0 - 0.06 * sin(uv.y * resolution.y * 3.14159);
  float vig = 1.0 - 0.4 * pow(length(uv_orig - 0.5), 2.0);
  ret = col * vig;
}`,
  };
}

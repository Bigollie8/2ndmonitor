import { baseVals, wave, shape, type OriginalPreset } from './base';
import { vec3, type Palette } from './palette';

// "Derezzed" — beat-driven zoom tunnel with chromatic edges; treble derezzes
// patches of the frame into flickering quantized blocks. The loud one.
export function build(p: Palette): OriginalPreset {
  return {
    baseVals: baseVals({
      decay: 0.962,
      // energetic centered waveform feeds the tunnel
      wave_mode: 2, wave_a: 0.55, wave_x: 0.5, wave_y: 0.5, wave_scale: 1.2,
      wave_r: p.a.r, wave_g: p.a.g, wave_b: p.a.b,
      additivewave: 1, wave_thick: 0, wave_smoothing: 0.6,
      wrap: 1,
    }),
    waves: [wave(), wave(), wave(), wave()],
    shapes: [shape(), shape(), shape(), shape()],
    init_eqs_str: '',
    frame_eqs_str: [
      'a.zoom=1.012+0.11*Math.pow(Math.min(1.4,a.bass_att),2);',
      'a.rot=0.012*Math.sin(a.time*0.31);',
      // flash to the antagonist color only on hard treble spikes
      'a.wave_r=' + p.a.r.toFixed(4) + '+(' + (p.b.r - p.a.r).toFixed(4) + ')*Math.max(0,Math.min(1,(a.treb_att-1.15)*3));',
      'a.wave_g=' + p.a.g.toFixed(4) + '+(' + (p.b.g - p.a.g).toFixed(4) + ')*Math.max(0,Math.min(1,(a.treb_att-1.15)*3));',
      'a.wave_b=' + p.a.b.toFixed(4) + '+(' + (p.b.b - p.a.b).toFixed(4) + ')*Math.max(0,Math.min(1,(a.treb_att-1.15)*3));',
    ].join(''),
    // quantized shear bands — digital, not organic swirl
    pixel_eqs_str: 'a.zoom=a.zoom+0.02*Math.sign(Math.sin(a.rad*9.0-a.time*1.4));a.rot=a.rot+0.01*Math.sign(Math.sin(a.ang*3.0+a.time*0.6));',
    warp: `shader_body {
  // subtractive decay kills the low-level fog that pure multiplicative
  // decay leaves floating in the buffer
  ret = max(vec3(0.0), texture(sampler_main, uv).rgb * 0.955 - 0.004);
}`,
    comp: `shader_body {
  float asp = resolution.x / resolution.y;
  float beat = min(1.4, bass_att);

  // chromatic aberration scaled by beat
  vec2 off = (uv - 0.5) * (0.003 + 0.008 * beat);
  vec3 col;
  col.r = texture(sampler_main, uv + off).r;
  col.g = texture(sampler_main, uv).g;
  col.b = texture(sampler_main, uv - off).b;

  // derez: treble flickers sparse cells into hard quantized blocks
  vec2 cellUv = floor(uv * vec2(28.0 * asp, 28.0)) / vec2(28.0 * asp, 28.0);
  float n = texture(sampler_noise_lq, cellUv * 3.0 + vec2(time * 0.9, time * 0.53)).r;
  float derez = step(1.0 - 0.13 * min(1.0, max(0.0, treb_att - 0.35)), n);
  vec3 blocky = texture(sampler_main, cellUv + 0.5 / vec2(28.0 * asp, 28.0)).rgb;
  col = mix(col, blocky * 1.6 + ${vec3(p.a)} * 0.15, derez);

  col += texture(sampler_blur2, uv).rgb * 0.1;

  // alignment grid, matched to the derez cell size
  vec2 gcell = fract(uv * vec2(28.0 * asp, 28.0));
  float gl = max(
    smoothstep(0.05, 0.0, abs(gcell.x - 0.5) - 0.46),
    smoothstep(0.05, 0.0, abs(gcell.y - 0.5) - 0.46));
  col += ${vec3(p.a)} * gl * 0.035;

  // tunnel core glow
  float d = length((uv - 0.5) * vec2(asp, 1.0));
  col += ${vec3(p.a)} * exp(-d * 6.5) * (0.15 + 0.3 * beat);

  col *= 1.0 - 0.05 * sin(uv.y * resolution.y * 3.14159);
  float vig = 1.0 - 0.5 * pow(length(uv_orig - 0.5), 1.7);
  ret = col * vig;
}`,
  };
}

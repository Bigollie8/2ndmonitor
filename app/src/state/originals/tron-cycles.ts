import { baseVals, wave, shape, type OriginalPreset } from './base';
import { vec3, type Palette } from './palette';

// "Light Cycles" — two glowing heads race a rectangular circuit with true
// right-angle turns, leaving hard trails through the feedback buffer.
// Treble adds speed; bass flares the trail glow.
export function build(p: Palette): OriginalPreset {
  // Walk the perimeter of a rectangle (right-angle turns) with lap-to-lap
  // inset variation so trails don't pile up on one path. `ph` offsets the two
  // cycles half a lap apart.
  // NB: locals avoid single-letter MilkDrop state names (x, y, r, g, b, a...)
  // and the walk is branchless — clamp ramps per edge instead of ternaries,
  // which the equation runner's preprocessing chokes on.
  const pathEqs = (ph: string) => `
var qspd=0.14+0.05*Math.min(1,a.treb_att);
var qtt=a.time*qspd+${ph};
var qinx=0.30+0.09*Math.abs(Math.sin(qtt*0.53));
var qiny=0.11+0.045*Math.abs(Math.sin(qtt*0.71+1.0));
var qf=(qtt%1.0)*4.0;
var qp0=Math.min(Math.max(qf,0.0),1.0);
var qp1=Math.min(Math.max(qf-1.0,0.0),1.0);
var qp2=Math.min(Math.max(qf-2.0,0.0),1.0);
var qp3=Math.min(Math.max(qf-3.0,0.0),1.0);
a.hx=0.5-qinx+2.0*qinx*(qp0-qp2);
a.hy=0.5-qiny+2.0*qiny*(qp1-qp3);
var qb=Math.max(qf-0.05,0.0);
var qq0=Math.min(Math.max(qb,0.0),1.0);
var qq1=Math.min(Math.max(qb-1.0,0.0),1.0);
var qq2=Math.min(Math.max(qb-2.0,0.0),1.0);
var qq3=Math.min(Math.max(qb-3.0,0.0),1.0);
a.tx=0.5-qinx+2.0*qinx*(qq0-qq2);
a.ty=0.5-qiny+2.0*qiny*(qq1-qq3);
`.trim().replace(/\n/g, '');

  const cycleWave = (phase: string, c: { r: number; g: number; b: number }) =>
    wave(
      {
        enabled: 1, samples: 20, usedots: 0, thick: 1, additive: 1,
        r: c.r, g: c.g, b: c.b, a: 1, smoothing: 0,
      },
      {
        frame: pathEqs(phase),
        // segment from tail to head; brightest at the head
        point: 'a.x=a.tx+(a.hx-a.tx)*a.sample;a.y=a.ty+(a.hy-a.ty)*a.sample;a.a=0.3+0.7*a.sample;',
      },
    );

  return {
    baseVals: baseVals({
      decay: 0.985,
      zoom: 1.0, warp: 0,
      gammaadj: 1.05,
    }),
    waves: [
      cycleWave('0.0', p.a),
      cycleWave('0.5', p.b),
      wave(),
      wave(),
    ],
    shapes: [shape(), shape(), shape(), shape()],
    init_eqs_str: '',
    frame_eqs_str: '',
    pixel_eqs_str: '',
    warp: `shader_body {
  // hard trails: straight decay, the faintest blur bleed for glow
  vec3 crisp = texture(sampler_main, uv).rgb;
  vec3 soft = texture(sampler_blur1, uv).rgb;
  ret = mix(crisp, soft, 0.03) * 0.975;
}`,
    comp: `shader_body {
  float asp = resolution.x / resolution.y;
  vec3 buf = texture(sampler_main, uv).rgb;
  vec3 glow = texture(sampler_blur2, uv).rgb;
  vec3 col = buf * 1.1 + glow * (0.3 + 0.3 * min(1.2, bass_att));

  // arena floor: very faint grid
  vec2 g = uv * vec2(asp, 1.0) * 16.0;
  float lines = max(
    smoothstep(0.05, 0.0, abs(fract(g.x) - 0.5) - 0.45),
    smoothstep(0.05, 0.0, abs(fract(g.y) - 0.5) - 0.45));
  col += ${vec3(p.a)} * lines * 0.03;

  // arena boundary: thin wall line, not a wash
  vec2 d2 = abs(uv - 0.5);
  float border = max(d2.x, d2.y);
  col += ${vec3(p.a)} * smoothstep(0.008, 0.0, abs(border - 0.47)) * 0.5;

  col *= 1.0 - 0.05 * sin(uv.y * resolution.y * 3.14159);
  float vig = 1.0 - 0.35 * pow(length(uv_orig - 0.5), 2.2);
  ret = col * vig;
}`,
  };
}

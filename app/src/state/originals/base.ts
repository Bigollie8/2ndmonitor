// ─────────────────────────────────────────────────────────────────────────────
// Shared scaffolding for hand-authored Butterchurn presets. Butterchurn's
// loadPreset uses the JSON as-is (no default merging), so every preset must
// carry the full baseVals key set; these helpers supply MilkDrop's defaults
// and each preset spreads its overrides on top.
//
// Conventions (from butterchurn's shader wrapper, GLES 3.00):
//  - warp/comp are `shader_body { ... }`; optional header text before it.
//  - comp locals: ret (vec3 out), uv, uv_orig, rad, ang, hue_shader.
//  - warp locals: ret, rad, ang; uv (warped) / uv_orig are varyings.
//  - uniforms: time, bass/mid/treb/vol (+_att), frame, fps, resolution,
//    aspect, texsize, sampler_main, sampler_blur1..3, noise samplers,
//    q1..q32 (set from frame_eqs via `a.q1 = ...`).
//  - equation strings are JS over the `a.` namespace.
// ─────────────────────────────────────────────────────────────────────────────

export interface OriginalPreset {
  baseVals: Record<string, number>;
  waves: object[];
  shapes: object[];
  init_eqs_str: string;
  frame_eqs_str: string;
  pixel_eqs_str: string;
  warp: string;
  comp: string;
}

/** Full MilkDrop baseVals defaults (mirrors butterchurn's built-in preset). */
export function baseVals(overrides: Record<string, number> = {}): Record<string, number> {
  return {
    rating: 5, gammaadj: 1, decay: 0.98, echo_zoom: 1, echo_alpha: 0, echo_orient: 0,
    wave_mode: 0, wave_a: 0, wave_r: 0.5, wave_g: 0.5, wave_b: 0.5, wave_x: 0.5, wave_y: 0.5,
    wave_mystery: 0, wave_scale: 1, wave_smoothing: 0.75, wave_dots: 0, wave_thick: 0,
    wave_brighten: 0, additivewave: 0, modwavealphabyvolume: 0,
    modwavealphastart: 0.75, modwavealphaend: 0.95,
    wrap: 0, zoom: 1, zoomexp: 1, rot: 0, cx: 0.5, cy: 0.5, dx: 0, dy: 0, sx: 1, sy: 1,
    warp: 0, warpanimspeed: 1, warpscale: 1, fshader: 0,
    red_blue: 0, brighten: 0, darken: 0, darken_center: 0, solarize: 0, invert: 0,
    ib_r: 0, ib_g: 0, ib_b: 0, ib_a: 0, ib_size: 0,
    ob_r: 0, ob_g: 0, ob_b: 0, ob_a: 0, ob_size: 0,
    bmotionvectorson: 0, mv_x: 12, mv_y: 9, mv_dx: 0, mv_dy: 0, mv_a: 0,
    mv_r: 0.5, mv_g: 0.5, mv_b: 0.5, mv_l: 0,
    ...overrides,
  };
}

/** A wave slot; disabled unless overridden. */
export function wave(
  overrides: Record<string, number> = {},
  eqs: { init?: string; frame?: string; point?: string } = {},
): object {
  return {
    baseVals: {
      enabled: 0, samples: 512, sep: 0, scaling: 1, smoothing: 0.5,
      r: 1, g: 1, b: 1, a: 1, spectrum: 0, usedots: 0, thick: 0, additive: 0,
      ...overrides,
    },
    init_eqs_str: eqs.init ?? '',
    frame_eqs_str: eqs.frame ?? '',
    point_eqs_str: eqs.point ?? '',
  };
}

/** A shape slot; disabled unless overridden. */
export function shape(
  overrides: Record<string, number> = {},
  eqs: { init?: string; frame?: string } = {},
): object {
  return {
    baseVals: {
      enabled: 0, sides: 4, additive: 0, thickoutline: 0, textured: 0, num_inst: 1,
      x: 0.5, y: 0.5, rad: 0.1, ang: 0, tex_ang: 0, tex_zoom: 1,
      r: 1, g: 1, b: 1, a: 1, r2: 0, g2: 0, b2: 0, a2: 0,
      border_r: 1, border_g: 1, border_b: 1, border_a: 0.5,
      ...overrides,
    },
    init_eqs_str: eqs.init ?? '',
    frame_eqs_str: eqs.frame ?? '',
  };
}

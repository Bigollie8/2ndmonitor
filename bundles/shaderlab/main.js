// Shader Lab — a Shadertoy-compatible GLSL host (0.9.10).
//
// Compiles fragment shaders written against the standard Shadertoy contract:
//   void mainImage(out vec4 fragColor, in vec2 fragCoord)
// with the standard uniforms (iResolution, iTime, iTimeDelta, iFrame, iMouse,
// iDate, iSampleRate) plus iChannel0 as the standard 512x2 AUDIO texture —
// row 0 = FFT (the host's 64 log-spaced bins resampled to 512), row 1 = raw
// waveform — exactly the layout Shadertoy's SoundCloud input uses, so most
// audio-reactive shaders port by paste. Two friendly extras (iAccent,
// iAccent2, the app's accent colors) are declared but never required.
//
// Eight original shaders ship built in; click the surface (or the ‹ › zones)
// to switch, and the choice persists via viz.settings.
//
// Licence note (deliberate): everything below is authored for this bundle.
// Shadertoy's site default is CC BY-NC-SA — ship only original or
// permissively-licensed shaders here.

// preserveDrawingBuffer: reading a WebGL canvas outside its own rAF (the
// preview harness, any screenshot path) sees a cleared backbuffer without
// it — the classic black-capture trap. The copy cost is negligible here.
var gl = viz.canvas.getContext('webgl2', { alpha: false, antialias: false, preserveDrawingBuffer: true });
// Feature-detect a REAL WebGL2 context: environments without one (WebGL
// blocked, or the node test harness whose canvas hands back a recording
// stub for any context type — where every property LOOKS like a function)
// fall through to the 2D spectrum fallback below. instanceof against the
// real constructor is the only check a proxy stub can't satisfy.
if (typeof WebGL2RenderingContext === 'undefined' || !(gl instanceof WebGL2RenderingContext)) gl = null;

var HEADER =
  '#version 300 es\n' +
  'precision highp float;\n' +
  'uniform vec3 iResolution;\n' +
  'uniform float iTime;\n' +
  'uniform float iTimeDelta;\n' +
  'uniform int iFrame;\n' +
  'uniform vec4 iMouse;\n' +
  'uniform vec4 iDate;\n' +
  'uniform float iSampleRate;\n' +
  'uniform sampler2D iChannel0;\n' +
  'uniform vec3 iAccent;\n' +
  'uniform vec3 iAccent2;\n' +
  'out vec4 outColor;\n';

var FOOTER =
  '\nvoid main(){ vec4 c = vec4(0.0,0.0,0.0,1.0); mainImage(c, gl_FragCoord.xy); outColor = vec4(c.rgb, 1.0); }\n';

// fft(x): FFT magnitude at x in 0..1 (row 0). wave(x): waveform -1..1 (row 1).
var AUDIO_HELPERS =
  'float fft(float x){ return texture(iChannel0, vec2(x, 0.25)).r; }\n' +
  'float wave(float x){ return texture(iChannel0, vec2(x, 0.75)).r * 2.0 - 1.0; }\n';

var SHADERS = [
  {
    name: 'Spectrum Tunnel',
    src: AUDIO_HELPERS +
      'void mainImage(out vec4 o, in vec2 fc){\n' +
      '  vec2 uv = (fc - 0.5 * iResolution.xy) / iResolution.y;\n' +
      '  float a = atan(uv.y, uv.x);\n' +
      '  float r = length(uv) + 1e-4;\n' +
      '  float band = fract(a / 6.28318 + 0.5);\n' +
      '  float f = fft(band * 0.7);\n' +
      '  float z = 0.25 / r + iTime * 1.4;\n' +
      '  float ring = smoothstep(0.5, 0.0, abs(fract(z) - 0.5) - f * 0.35);\n' +
      '  vec3 col = mix(iAccent, iAccent2, fract(z * 0.15));\n' +
      '  col *= ring * (0.35 + f * 1.5) * smoothstep(1.4, 0.25, r);\n' +
      '  o = vec4(col, 1.0);\n' +
      '}\n',
  },
  {
    name: 'Waveform Ribbon',
    src: AUDIO_HELPERS +
      'void mainImage(out vec4 o, in vec2 fc){\n' +
      '  vec2 uv = fc / iResolution.xy;\n' +
      '  vec3 col = vec3(0.0);\n' +
      '  for (int i = 0; i < 3; i++){\n' +
      '    float fi = float(i);\n' +
      '    float y = 0.5 + wave(uv.x) * (0.22 - fi * 0.05) + sin(uv.x * 9.0 + iTime * (1.0 + fi)) * 0.02;\n' +
      '    float d = abs(uv.y - y);\n' +
      '    col += mix(iAccent, iAccent2, fi * 0.5) * (0.006 / max(d, 0.002)) * (0.65 - fi * 0.18);\n' +
      '  }\n' +
      '  float bass = fft(0.05);\n' +
      '  col += iAccent * bass * bass * 0.25 * (1.0 - abs(uv.y - 0.5) * 2.0);\n' +
      '  o = vec4(col, 1.0);\n' +
      '}\n',
  },
  {
    name: 'Bass Bloom',
    src: AUDIO_HELPERS +
      'void mainImage(out vec4 o, in vec2 fc){\n' +
      '  vec2 uv = (fc - 0.5 * iResolution.xy) / iResolution.y;\n' +
      '  float bass = fft(0.04) * 0.8 + fft(0.1) * 0.4;\n' +
      '  float r = length(uv);\n' +
      '  vec3 col = vec3(0.0);\n' +
      '  for (int i = 0; i < 5; i++){\n' +
      '    float fi = float(i) / 5.0;\n' +
      '    vec2 c = vec2(sin(iTime * 0.7 + fi * 6.28318), cos(iTime * 0.5 + fi * 6.28318)) * (0.25 + bass * 0.2);\n' +
      '    float d = length(uv - c);\n' +
      '    col += mix(iAccent, iAccent2, fi) * (0.015 + bass * 0.03) / max(d * d + 0.01, 0.012);\n' +
      '  }\n' +
      '  col *= 0.35 + bass * 0.9;\n' +
      '  col *= smoothstep(1.35, 0.35, r);\n' +
      '  o = vec4(col, 1.0);\n' +
      '}\n',
  },
  {
    name: 'Kaleido Pulse',
    src: AUDIO_HELPERS +
      'void mainImage(out vec4 o, in vec2 fc){\n' +
      '  vec2 uv = (fc - 0.5 * iResolution.xy) / iResolution.y;\n' +
      '  float mid = fft(0.35);\n' +
      '  float a = atan(uv.y, uv.x);\n' +
      '  float seg = 6.28318 / 8.0;\n' +
      '  a = abs(mod(a, seg) - seg * 0.5);\n' +
      '  vec2 p = vec2(cos(a), sin(a)) * length(uv);\n' +
      '  float t = iTime * 0.6;\n' +
      '  float v = sin(p.x * 9.0 + t) + sin(p.y * 11.0 - t * 1.3) + sin((p.x + p.y) * 7.0 + t * 0.7);\n' +
      '  v = abs(v) * (0.4 + mid * 1.6);\n' +
      '  vec3 col = mix(iAccent2, iAccent, smoothstep(0.0, 1.6, v)) * smoothstep(2.6, 0.4, v);\n' +
      '  col *= smoothstep(1.2, 0.2, length(uv)) * (0.5 + mid);\n' +
      '  o = vec4(col, 1.0);\n' +
      '}\n',
  },
  {
    name: 'Plasma Drift',
    src: AUDIO_HELPERS +
      'void mainImage(out vec4 o, in vec2 fc){\n' +
      '  vec2 uv = fc / iResolution.y;\n' +
      '  float lvl = fft(0.08) * 0.6 + fft(0.4) * 0.4;\n' +
      '  float t = iTime * (0.4 + lvl * 0.8);\n' +
      '  float v = sin(uv.x * 5.0 + t) + sin(uv.y * 6.0 - t * 1.2)\n' +
      '          + sin(length(uv - vec2(0.9, 0.5)) * 8.0 + t) + sin((uv.x + uv.y) * 4.0);\n' +
      '  v *= 0.25;\n' +
      '  vec3 col = mix(iAccent2 * 0.35, iAccent, 0.5 + 0.5 * sin(v * 3.14159 + t * 0.5));\n' +
      '  col *= 0.35 + lvl * 1.2;\n' +
      '  o = vec4(col, 1.0);\n' +
      '}\n',
  },
  {
    name: 'Starburst EQ',
    src: AUDIO_HELPERS +
      'void mainImage(out vec4 o, in vec2 fc){\n' +
      '  vec2 uv = (fc - 0.5 * iResolution.xy) / iResolution.y;\n' +
      '  float a = atan(uv.y, uv.x);\n' +
      '  float r = length(uv);\n' +
      '  float n = 48.0;\n' +
      '  float idx = floor((a / 6.28318 + 0.5) * n);\n' +
      '  float f = fft(mod(idx, n * 0.5) / (n * 0.5) * 0.8);\n' +
      '  float len = 0.12 + f * 0.55;\n' +
      '  float spoke = smoothstep(0.5, 0.1, abs(fract((a / 6.28318 + 0.5) * n) - 0.5));\n' +
      '  float bar = spoke * smoothstep(len, len - 0.03, r) * smoothstep(0.05, 0.09, r);\n' +
      '  vec3 col = mix(iAccent, iAccent2, r / 0.7) * bar * (0.5 + f * 1.4);\n' +
      '  col += iAccent * smoothstep(0.09, 0.0, r) * (0.4 + fft(0.05));\n' +
      '  o = vec4(col, 1.0);\n' +
      '}\n',
  },
  {
    name: 'Liquid Bars',
    src: AUDIO_HELPERS +
      'void mainImage(out vec4 o, in vec2 fc){\n' +
      '  vec2 uv = fc / iResolution.xy;\n' +
      '  float n = 28.0;\n' +
      '  float cell = floor(uv.x * n) / n;\n' +
      '  float f = fft(cell * 0.85);\n' +
      '  float melt = sin(uv.x * 22.0 + iTime * 2.0) * 0.02 * f;\n' +
      '  float h = f * 0.85 + melt;\n' +
      '  float edge = smoothstep(h, h - 0.05, uv.y);\n' +
      '  float gap = smoothstep(0.06, 0.14, abs(fract(uv.x * n) - 0.5));\n' +
      '  vec3 col = mix(iAccent2, iAccent, uv.y / max(h, 0.05)) * edge * (0.35 + f) * (0.4 + gap * 0.6);\n' +
      '  col += iAccent * (0.02 / max(abs(uv.y - h), 0.01)) * f * 0.4;\n' +
      '  o = vec4(col, 1.0);\n' +
      '}\n',
  },
  {
    name: 'Night City',
    src: AUDIO_HELPERS +
      'void mainImage(out vec4 o, in vec2 fc){\n' +
      '  vec2 uv = (fc - 0.5 * iResolution.xy) / iResolution.y;\n' +
      '  float bass = fft(0.05);\n' +
      '  float horizon = -0.12 + bass * 0.05;\n' +
      '  vec3 col = mix(vec3(0.01, 0.0, 0.03), iAccent2 * 0.25, smoothstep(-0.6, 0.6, uv.y));\n' +
      '  float sun = length(uv - vec2(0.0, horizon + 0.28));\n' +
      '  col += iAccent * smoothstep(0.3, 0.0, sun) * (0.6 + bass * 0.8) * smoothstep(0.0, 0.02, sin(uv.y * 90.0) + 0.6);\n' +
      '  if (uv.y < horizon) {\n' +
      '    float persp = 1.0 / (horizon - uv.y + 0.02);\n' +
      '    vec2 g = vec2(uv.x * persp, persp * 0.5 - iTime * 2.0);\n' +
      '    float line = smoothstep(0.94, 1.0, max(abs(sin(g.x * 3.14159)), abs(sin(g.y * 3.14159))));\n' +
      '    col = mix(col, iAccent2 * (0.6 + bass), line * smoothstep(6.0, 1.5, persp));\n' +
      '  }\n' +
      '  o = vec4(col, 1.0);\n' +
      '}\n',
  },
];

// ── GL plumbing ──────────────────────────────────────────────────────────────
var program = null, vao = null, audioTex = null;
var uniforms = {};
var frameNo = 0, timeAcc = 0;
var fftBytes = new Uint8Array(512);
var texRow = new Uint8Array(512 * 2);
var current = 0;

function compile(type, src) {
  var s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    var log = gl.getShaderInfoLog(s);
    gl.deleteShader(s);
    throw new Error('shader compile failed: ' + log);
  }
  return s;
}

function buildProgram(fragBody) {
  var vs = compile(gl.VERTEX_SHADER,
    '#version 300 es\nvoid main(){ vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2)) * 2.0 - 1.0; gl_Position = vec4(p, 0.0, 1.0); }');
  var fs = compile(gl.FRAGMENT_SHADER, HEADER + fragBody + FOOTER);
  var p = gl.createProgram();
  gl.attachShader(p, vs);
  gl.attachShader(p, fs);
  gl.linkProgram(p);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    var log = gl.getProgramInfoLog(p);
    gl.deleteProgram(p);
    throw new Error('shader link failed: ' + log);
  }
  return p;
}

function useShader(i) {
  current = ((i % SHADERS.length) + SHADERS.length) % SHADERS.length;
  if (program) gl.deleteProgram(program);
  program = buildProgram(SHADERS[current].src);
  gl.useProgram(program);
  ['iResolution', 'iTime', 'iTimeDelta', 'iFrame', 'iMouse', 'iDate', 'iSampleRate', 'iChannel0', 'iAccent', 'iAccent2']
    .forEach(function (n) { uniforms[n] = gl.getUniformLocation(program, n); });
  gl.uniform1i(uniforms.iChannel0, 0);
  viz.settings.set('shader', current);
  showLabel(SHADERS[current].name + '  (' + (current + 1) + '/' + SHADERS.length + ')');
}

function initGL() {
  vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  audioTex = gl.createTexture();
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, audioTex);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, 512, 2, 0, gl.RED, gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
}

// ── name label + click-to-switch (plain DOM over the canvas) ────────────────
var label = document.createElement('div');
var labelTimer = null;
(function styleLabel(s) {
  s.position = 'fixed'; s.left = '10px'; s.bottom = '8px';
  s.font = '600 11px "JetBrains Mono", ui-monospace, monospace';
  s.color = 'rgba(255,255,255,0.85)';
  s.background = 'rgba(0,0,0,0.55)'; s.padding = '4px 9px'; s.borderRadius = '7px';
  s.pointerEvents = 'none'; s.opacity = '0'; s.transition = 'opacity 200ms';
  s.zIndex = '5';
})(label.style);
if (typeof document !== 'undefined' && document.body) document.body.appendChild(label);
function showLabel(text) {
  label.textContent = text;
  label.style.opacity = '1';
  if (labelTimer) clearTimeout(labelTimer);
  labelTimer = setTimeout(function () { label.style.opacity = '0'; }, 2200);
}

// Left third = previous, everywhere else = next. (Guarded: the node test
// harness's canvas stub has neither style nor events.)
if (viz.canvas.style) viz.canvas.style.cursor = 'pointer';
if (typeof viz.canvas.addEventListener === 'function') {
  viz.canvas.addEventListener('click', function (ev) {
    var prev = ev.clientX < viz.canvas.clientWidth / 3;
    try { useShader(current + (prev ? -1 : 1)); } catch (e) { showLabel(String(e && e.message || e)); }
  });
}

function hexToRgb(hex) {
  return [
    parseInt(hex.slice(1, 3), 16) / 255,
    parseInt(hex.slice(3, 5), 16) / 255,
    parseInt(hex.slice(5, 7), 16) / 255,
  ];
}

if (!gl) {
  showLabel('WebGL2 unavailable');
} else {
  initGL();
  var saved = viz.settings.get('shader');
  useShader(typeof saved === 'number' ? saved : 0);
}

viz.on('frame', function (f) {
  var w = f.size.width, h = f.size.height;
  if (!gl || !program) {
    // 2D fallback: WebGL2 unavailable — a mirrored spectrum keeps the
    // surface honest instead of black.
    var ctx = f.ctx;
    if (!ctx || w <= 0 || h <= 0) return;
    ctx.fillStyle = 'rgba(3,4,7,0.3)';
    ctx.fillRect(0, 0, w, h);
    var bins = viz.bins(96);
    var bw = w / bins.length;
    for (var b = 0; b < bins.length; b++) {
      var bh = bins[b] * h * 0.42;
      ctx.fillStyle = b % 2 ? f.theme.accent : f.theme.accent2;
      ctx.fillRect(b * bw, h * 0.5 - bh, bw * 0.8, bh * 2);
    }
    return;
  }
  if (w <= 0 || h <= 0) return;
  var dt = Math.max(0.0001, Math.min(0.25, f.dt || 0.016));
  timeAcc += dt;
  frameNo++;

  // Audio texture: row 0 FFT (64 host bins → 512), row 1 waveform (1024 → 512).
  var bins = viz.bins(512);
  for (var i = 0; i < 512; i++) {
    var v = bins[i];
    fftBytes[i] = v <= 0 ? 0 : v >= 1 ? 255 : (v * 255) | 0;
  }
  texRow.set(fftBytes, 0);
  var wf = f.waveform;
  if (wf && wf.length >= 1024) {
    for (var j = 0; j < 512; j++) texRow[512 + j] = wf[j * 2];
  } else {
    for (var k = 0; k < 512; k++) texRow[512 + k] = 128;
  }
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, audioTex);
  gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 512, 2, gl.RED, gl.UNSIGNED_BYTE, texRow);

  gl.viewport(0, 0, w, h);
  gl.uniform3f(uniforms.iResolution, w, h, 1);
  gl.uniform1f(uniforms.iTime, timeAcc);
  gl.uniform1f(uniforms.iTimeDelta, dt);
  gl.uniform1i(uniforms.iFrame, frameNo);
  gl.uniform4f(uniforms.iMouse, 0, 0, 0, 0);
  var d = new Date();
  gl.uniform4f(uniforms.iDate, d.getFullYear(), d.getMonth(), d.getDate(),
    d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds() + d.getMilliseconds() / 1000);
  gl.uniform1f(uniforms.iSampleRate, 48000);
  var a1 = hexToRgb(f.theme.accent), a2 = hexToRgb(f.theme.accent2);
  gl.uniform3f(uniforms.iAccent, a1[0], a1[1], a1[2]);
  gl.uniform3f(uniforms.iAccent2, a2[0], a2[1], a2[2]);

  gl.drawArrays(gl.TRIANGLES, 0, 3);
});

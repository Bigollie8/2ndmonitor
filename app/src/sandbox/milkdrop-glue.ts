// ─────────────────────────────────────────────────────────────────────────────
// Frame-side glue for the builtin MilkDrop visualizer. Runs INSIDE the viz
// sandbox iframe (opaque origin, default-src 'none', eval allowed) after the
// butterchurn + preset-pack UMDs — see components/milkdrop-code.ts for the
// assembly. Kept as a plain string in a pure module so node tests can scan it
// without touching Vite's `?raw` resolver.
//
// Protocol (over the sandbox 'data' channel — types in state/milkdrop-presets):
//   host → frame  { kind: 'milkdrop:load', seq, source, blend }
//   frame → host  { kind: 'milkdrop:names', names }          (once per init)
//   frame → host  { kind: 'milkdrop:load:result', seq, ok, error? }
// ─────────────────────────────────────────────────────────────────────────────

export const MILKDROP_GLUE = String.raw`
(function () {
  'use strict';
  var BC = (window.butterchurn && window.butterchurn.default) || window.butterchurn;
  var PACK = (window.butterchurnPresets && window.butterchurnPresets.default) || window.butterchurnPresets;
  if (!BC || !PACK) throw new Error('butterchurn libraries failed to load in the sandbox');
  var presets = PACK.getPresets();

  // AudioProcessor.updateAudio wants three Uint8Array(1024) time-domain
  // buffers (getByteTimeDomainData convention, 128 = silence). Mono capture,
  // so L/R duplicate. Allocated once, mutated per frame.
  var W = 1024;
  var levels = {
    timeByteArray: new Uint8Array(W),
    timeByteArrayL: new Uint8Array(W),
    timeByteArrayR: new Uint8Array(W),
  };
  levels.timeByteArray.fill(128); levels.timeByteArrayL.fill(128); levels.timeByteArrayR.fill(128);

  // The runtime's applySize has already stamped the init size onto the canvas.
  var canvas = viz.canvas;
  var lastW = Math.max(2, canvas.width);
  var lastH = Math.max(2, canvas.height);

  // Window-level singleton: the sandbox iframe (and its <canvas id="c">) is
  // NOT remounted across a re-init — 'init' fires again on hot-reload and on
  // any 'ready' ping that races the first before readyRef settles, and both
  // re-run this whole IIFE against the SAME canvas. A fresh
  // BC.createVisualizer per init would leave the previous run's WebGL
  // context attached with nothing left to release it; Chromium caps live
  // contexts (~16) and this frame is one of several surfaces that can be
  // mounted at once. Reuse the existing visualizer instead — only its
  // frame/data callbacks (registered below via viz.on) need to be fresh,
  // and the runtime already clears frameCbs/dataCbs before re-running this
  // code (sandbox-html.ts's 'init' handler), so re-registering them here is
  // enough on its own.
  var visualizer = window.__mdViz;
  if (!visualizer) {
    visualizer = BC.createVisualizer(null, canvas, { width: lastW, height: lastH });
    window.__mdViz = visualizer;
  } else {
    visualizer.setRendererSize(lastW, lastH);
  }

  viz.on('data', function (msg) {
    if (!msg || msg.kind !== 'milkdrop:load') return;
    try {
      var preset = msg.source.bundled !== undefined ? presets[msg.source.bundled] : msg.source.preset;
      if (!preset) throw new Error('bundled preset missing: ' + msg.source.bundled);
      visualizer.loadPreset(preset, msg.blend);
      viz.post({ kind: 'milkdrop:load:result', seq: msg.seq, ok: true });
    } catch (e) {
      viz.post({ kind: 'milkdrop:load:result', seq: msg.seq, ok: false, error: String(e && e.message ? e.message : e) });
    }
  });

  viz.on('frame', function (f) {
    if (canvas.width !== lastW || canvas.height !== lastH) {
      lastW = Math.max(2, canvas.width);
      lastH = Math.max(2, canvas.height);
      visualizer.setRendererSize(lastW, lastH);
    }
    if (f.waveform) {
      var src = f.waveform.length > 1024 ? f.waveform.subarray(0, 1024) : f.waveform;
      levels.timeByteArray.set(src);
      levels.timeByteArrayL.set(src);
      levels.timeByteArrayR.set(src);
    }
    visualizer.render({ audioLevels: levels });
  });

  // Level-triggered like the runtime's own ready pings: this fires on EVERY
  // init (including hot reloads), and the host rebuilds its library + reloads
  // the current preset each time it hears it.
  viz.post({ kind: 'milkdrop:names', names: Object.keys(presets) });
})();
`;

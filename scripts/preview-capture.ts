// ─────────────────────────────────────────────────────────────────────────────
// Preview-image capture harness (finding 31): generates bundles/<id>/preview.png
// for every visualizer bundle by running its real main.js against the real
// sandbox shims (BINS_SHIM_SRC / CLAMP_SHIM_SRC) in a plain browser page.
//
// Unlike the app, the harness runs bundle code SAME-DOCUMENT (no iframe), which
// is what makes capture possible at all: canvas-surface bundles are read with
// canvas.toDataURL(), dom-surface bundles are rasterized via an SVG
// <foreignObject> of #root. That is safe here because these are our own
// first-party-authored bundles being run by a build tool, not untrusted input.
//
// Run:    npx --prefix app tsx scripts/preview-capture.ts
// Then:   open http://127.0.0.1:5199/?all=1 and wait for title CAPTURE DONE
//         (or /?id=<bundleId> to redo one).
// ─────────────────────────────────────────────────────────────────────────────
import { createServer } from 'node:http';
import {
  readFileSync, readdirSync, writeFileSync, existsSync, statSync,
  mkdtempSync, mkdirSync, rmSync, unlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BINS_SHIM_SRC, CLAMP_SHIM_SRC } from '../app/src/sandbox/bins';
import { ffmpegAvailable, encodeWebp } from './encode-anim.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLES = join(ROOT, 'bundles');
const PORT = 5199;
const PREVIEW_CAP = 262_144; // 256 KiB — mirrors scripts/bundles.mjs and server/src/submit.rs
const ANIM_CAP = 2 * 1024 * 1024; // 2 MB — mirrors server/src/media.rs
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

// 12 fps for 3s. Fast enough to read as motion, few enough that a 2 MB cap
// is reachable at this canvas size, and 3s is long enough to show a full
// cycle of most ambient visualizers without becoming a video.
const ANIM_FPS = 12;
const ANIM_SECONDS = 3;

const HAVE_FFMPEG = ffmpegAvailable();

function visualizerIds(): string[] {
  return readdirSync(BUNDLES, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name !== 'dist' && !d.name.startsWith('tile-'))
    .filter((d) => existsSync(join(BUNDLES, d.name, 'manifest.json')))
    .map((d) => d.name)
    .sort();
}

const HARNESS = `<!doctype html>
<meta charset="utf-8">
<title>preview capture</title>
<body style="background:#111;color:#ddd;font:13px monospace;margin:20px">
<div id="stage" style="width:576px;height:194px;position:relative;overflow:hidden;background:#000">
  <canvas id="c" width="576" height="194" style="position:absolute;inset:0"></canvas>
  <div id="root" style="position:absolute;inset:0"></div>
</div>
<div id="status" style="margin-top:12px">starting…</div>
<script>
${BINS_SHIM_SRC}
${CLAMP_SHIM_SRC}
const ANIM_FPS = ${ANIM_FPS};
const ANIM_FRAMES = ${ANIM_FPS * ANIM_SECONDS};
// The server tells the page whether encoding is even possible, so a machine
// without ffmpeg does not spend 3 seconds per bundle recording frames that
// would be thrown away.
const WANT_ANIM = ${HAVE_FFMPEG};
let frameCbs = []; let lastSpectrum = null; const binCache = {};
const canvas = document.getElementById('c'); const root = document.getElementById('root');
let ctx2d = null;
// Same freeze + surface as the real runtime (sandbox-html.ts), minus rpc.
window.viz = Object.freeze({
  canvas, root,
  bins(n) { const count = __clampBinCount(n); if (!binCache[count]) binCache[count] = new Float32Array(count); return __resample(lastSpectrum, count, binCache[count]); },
  on(name, cb) { if (name === 'frame' && typeof cb === 'function') frameCbs.push(cb); },
  settings: Object.freeze({ get: () => undefined, set: () => {} }),
  net: Object.freeze({ fetch: () => Promise.reject(new Error('no net in capture')) }),
  tauri: Object.freeze({ invoke: () => Promise.reject(new Error('no tauri in capture')) }),
});
const SIZE = { width: 576, height: 194 };
// The Rust capture emits exactly 64 log-spaced bands (see app/src/sandbox/bins.ts
// header) — synthesize 64, and let viz.bins() resample exactly like production.
function synthFrame(i) {
  const t = i / 30;
  const spectrum = new Float32Array(64);
  for (let k = 0; k < 64; k++) {
    const f = k / 64;
    spectrum[k] = Math.max(0, Math.min(1,
      (1 - f * 0.8) * (0.45 + 0.4 * Math.sin(t * 2.1 + k * 0.28)) * (0.6 + 0.4 * Math.sin(t * 0.9))
      + 0.12 * Math.sin(t * 7 + k)));
  }
  const waveform = new Uint8Array(256);
  for (let k = 0; k < 256; k++) waveform[k] = 128 + Math.round(90 * Math.sin(t * 4 + k * 0.12) * (0.5 + 0.5 * Math.sin(t * 1.3)));
  if (!ctx2d) { try { ctx2d = canvas.getContext('2d'); } catch (e) {} }
  return {
    ctx: ctx2d, spectrum, waveform,
    bands: { bass: 0.55 + 0.35 * Math.sin(t * 2.1), mid: 0.45 + 0.3 * Math.sin(t * 1.7 + 1), treble: 0.4 + 0.35 * Math.sin(t * 2.9 + 2) },
    onset: { kick: (i % 15) < 2 ? 1 : 0, snare: (i % 30) < 2 ? 0.8 : 0, hat: (i % 7) < 1 ? 0.6 : 0 },
    level: 0.5 + 0.3 * Math.sin(t * 1.1), dt: 1 / 30, size: SIZE,
    theme: { accent: '#7cf5d4', accent2: '#a5b4fc' },
    track: { title: 'Preview', artist: 'Capture', album: '' },
    playback: { playing: true, position: 42, duration: 180 },
  };
}
// One PNG data URL of the current stage. Factored out of captureOne so the
// animation loop rasterizes through the exact same path the still does —
// two rasterizers would drift, and a still that does not match frame 0 of
// its own animation reads as a glitch.
async function rasterize(useDom) {
  if (!useDom) {
    // Composite onto black: bundles that only stroke (waveform, bars, radial,
    // particles) leave the canvas transparent, and a transparent preview
    // renders as whatever sits behind the <img> instead of the dark stage the
    // visualizer was designed against.
    const out = document.createElement('canvas'); out.width = 576; out.height = 194;
    const octx = out.getContext('2d');
    octx.fillStyle = '#000'; octx.fillRect(0, 0, 576, 194);
    octx.drawImage(canvas, 0, 0);
    return out.toDataURL('image/png');
  }
  const xml = new XMLSerializer().serializeToString(root);
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="576" height="194">'
    + '<rect width="576" height="194" fill="#000"/>'
    + '<foreignObject width="576" height="194">' + xml + '</foreignObject></svg>';
  const img = new Image();
  await new Promise((res, rej) => {
    img.onload = res;
    img.onerror = () => rej(new Error('svg rasterize failed'));
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  });
  const out = document.createElement('canvas'); out.width = 576; out.height = 194;
  out.getContext('2d').drawImage(img, 0, 0);
  return out.toDataURL('image/png');
}
async function captureOne(id, frames) {
  frameCbs = []; root.textContent = '';
  if (ctx2d) ctx2d.clearRect(0, 0, 576, 194);
  const manifest = await (await fetch('/bundles/' + id + '/manifest.json')).json();
  const useDom = manifest.surface === 'dom';
  canvas.hidden = useDom; root.hidden = !useDom;
  const code = await (await fetch('/bundles/' + id + '/main.js')).text();
  new Function(code)();
  // Real-time pump: dom bundles animate via CSS transitions that need wall time.
  for (let i = 0; i < frames; i++) {
    const f = synthFrame(i); lastSpectrum = f.spectrum;
    for (const cb of frameCbs) { try { cb(f); } catch (e) { throw new Error('frame threw: ' + e.message); } }
    await new Promise(r => setTimeout(r, 1000 / 30));
  }
  const dataUrl = await rasterize(useDom);
  const resp = await fetch('/save?id=' + encodeURIComponent(id), { method: 'POST', body: dataUrl });
  if (!resp.ok) throw new Error(id + ': ' + await resp.text());
  return { useDom, frameOffset: frames };
}
// Records ANIM_FRAMES frames of the ALREADY-RUNNING bundle. Called straight
// after captureOne so the bundle keeps animating from where the still was
// taken rather than restarting — a restart would make every animation open on
// the same cold first frame the still already shows.
async function captureAnim(id, state) {
  const frames = [];
  for (let i = 0; i < ANIM_FRAMES; i++) {
    const f = synthFrame(state.frameOffset + i); lastSpectrum = f.spectrum;
    for (const cb of frameCbs) { try { cb(f); } catch (e) { throw new Error('frame threw: ' + e.message); } }
    await new Promise(r => setTimeout(r, 1000 / ANIM_FPS));
    frames.push(await rasterize(state.useDom));
  }
  const resp = await fetch('/save-anim?id=' + encodeURIComponent(id), {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(frames),
  });
  if (!resp.ok) throw new Error(id + ' anim: ' + await resp.text());
}
(async () => {
  const status = document.getElementById('status');
  const params = new URLSearchParams(location.search);
  const ids = params.has('all') ? await (await fetch('/list')).json() : [params.get('id')];
  const frames = Math.max(30, Math.min(600, Number(params.get('frames')) || 90));
  const failed = [];
  for (const id of ids) {
    status.textContent = 'capturing ' + id + '…';
    try {
      const state = await captureOne(id, frames);
      if (WANT_ANIM) {
        status.textContent = 'recording ' + id + '…';
        await captureAnim(id, state);
      }
      status.textContent = id + ' ✓';
    }
    catch (e) { failed.push(id + ': ' + e.message); console.error(id, e); }
  }
  document.title = failed.length ? 'CAPTURE FAILED' : 'CAPTURE DONE';
  status.innerHTML = failed.length
    ? 'FAILED ' + failed.length + ':<br>' + failed.join('<br>')
    : 'ALL DONE — ' + ids.length + ' captured';
})();
</script>`;

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://127.0.0.1:${PORT}`);
  try {
    if (url.pathname === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(HARNESS);
    } else if (url.pathname === '/list') {
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(visualizerIds()));
    } else if (url.pathname.startsWith('/bundles/')) {
      const [, , id, file] = url.pathname.split('/');
      if (!/^[a-z0-9-]+$/.test(id ?? '') || !['manifest.json', 'main.js'].includes(file ?? '')) {
        res.writeHead(404).end('not found'); return;
      }
      const p = join(BUNDLES, id, file);
      if (!existsSync(p) || !statSync(p).isFile()) { res.writeHead(404).end('not found'); return; }
      const type = file.endsWith('.json') ? 'application/json' : 'text/javascript';
      res.writeHead(200, { 'Content-Type': type }).end(readFileSync(p));
    } else if (url.pathname === '/save' && req.method === 'POST') {
      const id = url.searchParams.get('id') ?? '';
      if (!/^[a-z0-9-]+$/.test(id) || !existsSync(join(BUNDLES, id))) {
        res.writeHead(400).end('bad id'); return;
      }
      const chunks: Buffer[] = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        const m = /^data:image\/png;base64,(.+)$/.exec(body);
        if (!m) { res.writeHead(400).end('not a png data url'); return; }
        const bytes = Buffer.from(m[1], 'base64');
        if (!bytes.subarray(0, 4).equals(PNG_MAGIC)) { res.writeHead(400).end('bad png magic'); return; }
        if (bytes.length > PREVIEW_CAP) { res.writeHead(400).end(`too large: ${bytes.length} > ${PREVIEW_CAP}`); return; }
        writeFileSync(join(BUNDLES, id, 'preview.png'), bytes);
        console.log(`saved ${id}/preview.png (${bytes.length} bytes)`);
        res.writeHead(200).end('ok');
      });
    } else if (url.pathname === '/save-anim' && req.method === 'POST') {
      const id = url.searchParams.get('id') ?? '';
      if (!/^[a-z0-9-]+$/.test(id) || !existsSync(join(BUNDLES, id))) {
        res.writeHead(400).end('bad id'); return;
      }
      const chunks: Buffer[] = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        let frames: string[];
        try {
          frames = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        } catch {
          res.writeHead(400).end('not JSON'); return;
        }
        if (!Array.isArray(frames) || frames.length === 0) {
          res.writeHead(400).end('no frames'); return;
        }
        const dir = mkdtempSync(join(tmpdir(), `anim-${id}-`));
        const outPath = join(BUNDLES, id, 'preview-anim.webp');
        try {
          mkdirSync(dir, { recursive: true });
          frames.forEach((f, i) => {
            const m = /^data:image\/png;base64,(.+)$/.exec(f);
            if (!m) throw new Error(`frame ${i} is not a png data url`);
            writeFileSync(join(dir, String(i).padStart(3, '0') + '.png'), Buffer.from(m[1], 'base64'));
          });
          if (!encodeWebp(dir, outPath, ANIM_FPS)) {
            res.writeHead(500).end('ffmpeg failed'); return;
          }
          // Enforce the cap here rather than discovering it at upload time:
          // a too-large animation is dropped and the still is kept, which is
          // the honest degradation.
          const size = statSync(outPath).size;
          if (size > ANIM_CAP) {
            console.warn(`! ${id}: animation is ${size} bytes, over the ${ANIM_CAP} cap — dropping it, still kept`);
            unlinkSync(outPath);
            res.writeHead(200).end('dropped: over cap'); return;
          }
          console.log(`saved ${id}/preview-anim.webp (${size} bytes)`);
          res.writeHead(200).end('ok');
        } catch (e) {
          res.writeHead(500).end(String(e));
        } finally {
          rmSync(dir, { recursive: true, force: true });
        }
      });
    } else {
      res.writeHead(404).end('not found');
    }
  } catch (e) {
    res.writeHead(500).end(String(e));
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`listening on http://127.0.0.1:${PORT} — ${visualizerIds().length} visualizer bundles`);
  if (!HAVE_FFMPEG) {
    console.warn('! ffmpeg not found — capturing stills only. Animated previews will be skipped.');
    console.warn('  Install ffmpeg and re-run to produce bundles/<id>/preview-anim.webp');
  } else {
    console.log(`  ffmpeg found — recording ${ANIM_FPS * ANIM_SECONDS} frames at ${ANIM_FPS}fps per bundle`);
  }
});

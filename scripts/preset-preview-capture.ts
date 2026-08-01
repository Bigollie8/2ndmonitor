// ─────────────────────────────────────────────────────────────────────────────
// Preset preview-image capture harness (Task 9, milkdrop-preset-split): generates
// bundles-presets/<id>/preview.png for every staged MilkDrop preset by running
// the real Butterchurn UMD against synthetic audio in a plain browser page.
//
// Pattern-copied from scripts/preview-capture.ts (server/page split, /save
// validation, PNG magic, 256 KiB cap) — the page differs because presets are
// Butterchurn preset objects (loadPreset + render), not sandboxed bundle code.
//
// Run:    npx --prefix app tsx scripts/preset-preview-capture.ts
// Then:   open http://127.0.0.1:5198/?all=1 and wait for title CAPTURE DONE
//         (or /?id=<presetId> to redo/spot-check one).
// ─────────────────────────────────────────────────────────────────────────────
import { createServer } from 'node:http';
import { readFileSync, readdirSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PRESETS = join(ROOT, 'bundles-presets');
const BUTTERCHURN_UMD = join(ROOT, 'app', 'node_modules', 'butterchurn', 'lib', 'butterchurn.min.js');
const PORT = 5198;
const PREVIEW_CAP = 262_144; // 256 KiB — mirrors scripts/bundles.mjs and server/src/submit.rs
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff]);
const ID_RE = /^[a-z0-9-]+$/;

function presetIds(): string[] {
  return readdirSync(PRESETS, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .filter((d) => existsSync(join(PRESETS, d.name, 'manifest.json')) && existsSync(join(PRESETS, d.name, 'preset.json')))
    .map((d) => d.name)
    .sort();
}

const HARNESS = `<!doctype html>
<meta charset="utf-8">
<title>preset preview capture</title>
<body style="background:#111;color:#ddd;font:13px monospace;margin:20px">
<div id="stage" style="width:576px;height:194px;position:relative;overflow:hidden;background:#000">
  <canvas id="c" width="576" height="194" style="position:absolute;inset:0"></canvas>
</div>
<div id="status" style="margin-top:12px">starting…</div>
<script src="/butterchurn.js"></script>
<script>
const canvas = document.getElementById('c');
const BC = (window.butterchurn && window.butterchurn.default) || window.butterchurn;
if (!BC) throw new Error('butterchurn failed to load');
const visualizer = BC.createVisualizer(null, canvas, { width: 576, height: 194 });

// AudioProcessor.updateAudio wants three Uint8Array(1024) time-domain buffers
// (getByteTimeDomainData convention, 128 = silence). Mono synth, so L/R
// duplicate — same shape as app/src/sandbox/milkdrop-glue.ts.
const W = 1024;
const levels = {
  timeByteArray: new Uint8Array(W),
  timeByteArrayL: new Uint8Array(W),
  timeByteArrayR: new Uint8Array(W),
};

function synthWaveform(i, out) {
  const t = i / 30;
  const beat = 0.5 + 0.5 * Math.sin(t * 2.4) * (0.6 + 0.4 * Math.sin(t * 0.37));
  for (let k = 0; k < W; k++) {
    const x = k / W;
    const s = Math.sin(t * 6.0 + x * 41.0) * 0.4 + Math.sin(t * 2.7 + x * 13.0) * 0.25;
    const v = 128 + s * 90 * (0.35 + 0.65 * beat);
    out[k] = Math.max(0, Math.min(255, Math.round(v)));
  }
}

function pumpAndCapture(frames) {
  for (let i = 0; i < frames; i++) {
    synthWaveform(i, levels.timeByteArray);
    levels.timeByteArrayL.set(levels.timeByteArray);
    levels.timeByteArrayR.set(levels.timeByteArray);
    visualizer.render({ audioLevels: levels });
  }
  // Composite onto black: some presets leave transparent/near-empty pixels,
  // and a transparent preview renders as whatever sits behind the <img>
  // instead of the dark stage the preset was designed against.
  const out = document.createElement('canvas'); out.width = 576; out.height = 194;
  const octx = out.getContext('2d');
  octx.fillStyle = '#000'; octx.fillRect(0, 0, 576, 194);
  octx.drawImage(canvas, 0, 0);
  return { out, octx };
}

function luminanceStats(octx) {
  const { data } = octx.getImageData(0, 0, 576, 194);
  const n = data.length / 4;
  let sum = 0;
  const lum = new Float64Array(n);
  for (let p = 0; p < n; p++) {
    const o = p * 4;
    const l = 0.299 * data[o] + 0.587 * data[o + 1] + 0.114 * data[o + 2];
    lum[p] = l; sum += l;
  }
  const mean = sum / n;
  let variance = 0;
  for (let p = 0; p < n; p++) { const d = lum[p] - mean; variance += d * d; }
  const stddev = Math.sqrt(variance / n);
  return { mean, stddev };
}

async function captureOne(id) {
  const presetObj = await (await fetch('/preset/' + id)).json();
  visualizer.loadPreset(presetObj, 0); // throws on bad equations — caller catches
  const frames = 75;
  const { out, octx } = pumpAndCapture(frames);
  const { mean, stddev } = luminanceStats(octx);
  if (mean < 4) throw new Error('rejected: black (mean luminance ' + mean.toFixed(2) + ')');
  if (stddev < 5) throw new Error('rejected: blank/uniform (luminance stddev ' + stddev.toFixed(2) + ')');
  let dataUrl = out.toDataURL('image/png');
  let bytesLen = Math.ceil((dataUrl.length - dataUrl.indexOf(',') - 1) * 3 / 4);
  if (bytesLen > ${PREVIEW_CAP}) dataUrl = out.toDataURL('image/jpeg', 0.85);
  const resp = await fetch('/save?id=' + encodeURIComponent(id), { method: 'POST', body: dataUrl });
  if (!resp.ok) throw new Error('save failed: ' + await resp.text());
}

(async () => {
  const status = document.getElementById('status');
  const params = new URLSearchParams(location.search);
  const ids = params.has('all') ? await (await fetch('/list')).json() : [params.get('id')];
  const rejected = [];
  let captured = 0;
  for (const id of ids) {
    status.textContent = 'capturing ' + id + ' (' + (captured + rejected.length + 1) + '/' + ids.length + ')…';
    try { await captureOne(id); captured++; }
    catch (e) {
      const reason = e && e.message ? e.message : String(e);
      rejected.push({ id, reason });
      console.error(id, e);
    }
  }
  const report = { total: ids.length, captured, rejected };
  try {
    await fetch('/report', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(report) });
  } catch (e) { console.error('report post failed', e); }
  document.title = rejected.length ? 'CAPTURE DONE (' + rejected.length + ' rejected)' : 'CAPTURE DONE';
  status.innerHTML = 'DONE — ' + captured + '/' + ids.length + ' captured'
    + (rejected.length ? '<br>REJECTED ' + rejected.length + ':<br>' + rejected.map(r => r.id + ': ' + r.reason).join('<br>') : '');
})();
</script>`;

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://127.0.0.1:${PORT}`);
  try {
    if (url.pathname === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(HARNESS);
    } else if (url.pathname === '/list') {
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(presetIds()));
    } else if (url.pathname === '/butterchurn.js') {
      res.writeHead(200, { 'Content-Type': 'text/javascript' }).end(readFileSync(BUTTERCHURN_UMD));
    } else if (url.pathname.startsWith('/preset/')) {
      const id = url.pathname.slice('/preset/'.length);
      if (!ID_RE.test(id)) { res.writeHead(404).end('not found'); return; }
      const p = join(PRESETS, id, 'preset.json');
      if (!existsSync(p) || !statSync(p).isFile()) { res.writeHead(404).end('not found'); return; }
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(readFileSync(p));
    } else if (url.pathname === '/save' && req.method === 'POST') {
      const id = url.searchParams.get('id') ?? '';
      if (!ID_RE.test(id) || !existsSync(join(PRESETS, id))) {
        res.writeHead(400).end('bad id'); return;
      }
      const chunks: Buffer[] = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        const m = /^data:image\/(png|jpeg);base64,(.+)$/.exec(body);
        if (!m) { res.writeHead(400).end('not a png/jpeg data url'); return; }
        const bytes = Buffer.from(m[2], 'base64');
        const isPng = bytes.subarray(0, 4).equals(PNG_MAGIC);
        const isJpeg = bytes.subarray(0, 3).equals(JPEG_MAGIC);
        if (!isPng && !isJpeg) { res.writeHead(400).end('bad image magic'); return; }
        if (bytes.length > PREVIEW_CAP) { res.writeHead(400).end(`too large: ${bytes.length} > ${PREVIEW_CAP}`); return; }
        writeFileSync(join(PRESETS, id, 'preview.png'), bytes);
        console.log(`saved ${id}/preview.png (${bytes.length} bytes)`);
        res.writeHead(200).end('ok');
      });
    } else if (url.pathname === '/report' && req.method === 'POST') {
      const chunks: Buffer[] = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        try {
          const parsed = JSON.parse(body);
          writeFileSync(join(PRESETS, 'capture-report.json'), JSON.stringify(parsed, null, 2));
          console.log(`saved capture-report.json (total=${parsed.total} captured=${parsed.captured} rejected=${parsed.rejected?.length ?? 0})`);
          res.writeHead(200).end('ok');
        } catch (e) {
          res.writeHead(400).end('bad json: ' + String(e));
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
  console.log(`listening on http://127.0.0.1:${PORT} — ${presetIds().length} staged presets`);
});

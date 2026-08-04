// ─────────────────────────────────────────────────────────────────────────────
// Preview capture for DECLARATIVE tile bundles — deferred finding #31's
// remaining gap.
//
// A declarative tile is not sandboxed code: it is a view.json spec rendered
// by DeclarativeTile.tsx against fetched data. So it needs a different
// harness from preview-capture.ts, which drives a bundle's real main.js
// against the sandbox shims — there is no main.js here to drive.
//
// Data comes from the manifest's optional `previewData`; without it the tile
// gets a generic stub, which produces an honest-but-dull preview rather than
// an empty frame.
//
// `previewData` shape (validated server-side only as "an object under 8 KB",
// because the rest is the tile's own business):
//
//   "previewData": {
//     "config":   { "symbol": "AAPL" },      // optional, fills {{config.x}}
//     "response": { ... }                    // the RAW body the source returns
//   }
//
// The harness applies view.json's own `select` to `response`, exactly as
// production does, so a preview cannot silently disagree with the real tile.
//
// This is a SIDECAR to the app's Vite dev server rather than its own page
// server (unlike preview-capture.ts): the renderer is React + TSX and lives
// in app/src, so the page has to be built by Vite. Run:
//
//   1. npm --prefix app run dev
//   2. npx --prefix app tsx scripts/tile-preview-capture.ts
//   3. open http://localhost:1420/tile-capture.html and wait for CAPTURE DONE
// ─────────────────────────────────────────────────────────────────────────────
import { createServer } from 'node:http';
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLES = join(ROOT, 'bundles');
const PORT = 5200;
const PREVIEW_CAP = 262_144; // 256 KiB — mirrors scripts/bundles.mjs and server/src/submit.rs
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

function tileIds(): string[] {
  return readdirSync(BUNDLES, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name.startsWith('tile-'))
    .filter((d) => existsSync(join(BUNDLES, d.name, 'view.json')))
    .map((d) => d.name)
    .sort();
}

const CORS = {
  // The page is served by Vite on another port. This server binds 127.0.0.1
  // and only ever writes into bundles/<id>/preview.png, so a permissive
  // origin here is a local build tool's convenience, not an exposure.
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type',
} as const;

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://127.0.0.1:${PORT}`);
  try {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, CORS).end();
      return;
    }
    if (url.pathname === '/list') {
      // Only bundles that have NO preview yet, unless ?all=1. Capturing
      // everything by default would overwrite a good published preview with a
      // generic-stub render for any bundle that declares no previewData —
      // a silent downgrade, and the exact mistake this default prevents.
      const ids = url.searchParams.has('all')
        ? tileIds()
        : tileIds().filter((id) => !existsSync(join(BUNDLES, id, 'preview.png')));
      res.writeHead(200, { ...CORS, 'Content-Type': 'application/json' })
        .end(JSON.stringify(ids));
    } else if (url.pathname === '/spec') {
      const id = url.searchParams.get('id') ?? '';
      if (!/^[a-z0-9-]+$/.test(id) || !existsSync(join(BUNDLES, id))) {
        res.writeHead(400, CORS).end('bad id'); return;
      }
      const manifest = JSON.parse(readFileSync(join(BUNDLES, id, 'manifest.json'), 'utf8'));
      const view = JSON.parse(readFileSync(join(BUNDLES, id, 'view.json'), 'utf8'));
      res.writeHead(200, { ...CORS, 'Content-Type': 'application/json' })
        .end(JSON.stringify({ id, name: manifest.name, view, previewData: manifest.previewData ?? null }));
    } else if (url.pathname === '/save' && req.method === 'POST') {
      const id = url.searchParams.get('id') ?? '';
      if (!/^[a-z0-9-]+$/.test(id) || !existsSync(join(BUNDLES, id))) {
        res.writeHead(400, CORS).end('bad id'); return;
      }
      const chunks: Buffer[] = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        const m = /^data:image\/png;base64,(.+)$/.exec(body);
        if (!m) { res.writeHead(400, CORS).end('not a png data url'); return; }
        const bytes = Buffer.from(m[1], 'base64');
        if (!bytes.subarray(0, 4).equals(PNG_MAGIC)) { res.writeHead(400, CORS).end('bad png magic'); return; }
        if (bytes.length > PREVIEW_CAP) {
          res.writeHead(400, CORS).end(`too large: ${bytes.length} > ${PREVIEW_CAP}`); return;
        }
        writeFileSync(join(BUNDLES, id, 'preview.png'), bytes);
        console.log(`saved ${id}/preview.png (${bytes.length} bytes)`);
        res.writeHead(200, CORS).end('ok');
      });
    } else {
      res.writeHead(404, CORS).end('not found');
    }
  } catch (e) {
    res.writeHead(500, CORS).end(String(e));
  }
});

server.listen(PORT, '127.0.0.1', () => {
  const ids = tileIds();
  const missing = ids.filter((id) => !existsSync(join(BUNDLES, id, 'preview.png')));
  const noData = ids.filter((id) => {
    const manifest = JSON.parse(readFileSync(join(BUNDLES, id, 'manifest.json'), 'utf8'));
    return manifest.previewData == null;
  });
  console.log(`listening on http://127.0.0.1:${PORT} — ${ids.length} declarative tile bundles`);
  console.log(`  ${missing.length} have no preview.png yet: ${missing.join(', ') || '(none)'}`);
  if (noData.length > 0) {
    // Said out loud rather than silently stubbed: a generic stub renders an
    // honest-but-dull frame, and the operator should know which bundles got
    // one so the manifest can be filled in rather than the preview shipped.
    console.warn(`! no previewData in: ${noData.join(', ')} — these render a generic stub`);
  }
  console.log('  now: npm --prefix app run dev, then open http://localhost:1420/tile-capture.html');
});

// Fail loudly if the port is taken — silently binding nothing and telling the
// operator to open a page that will never save anything is the bad outcome.
server.on('error', (e) => {
  console.error(`could not listen on ${PORT}: ${e.message}`);
  process.exit(1);
});

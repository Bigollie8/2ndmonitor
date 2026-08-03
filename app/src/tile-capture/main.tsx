// ─────────────────────────────────────────────────────────────────────────────
// Capture page for declarative tile bundles. Driven by
// scripts/tile-preview-capture.ts, which serves the bundle list and specs and
// receives the rendered PNGs.
//
// This lives under app/src rather than being inlined in the script (unlike
// preview-capture.ts's hand-written harness page) for one reason: it renders
// through DeclarativeTile's REAL `ViewRenderer`. A second renderer written
// for the harness would drift, and a preview that does not match the tile is
// worse than no preview at all.
// ─────────────────────────────────────────────────────────────────────────────
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { ViewRenderer } from '../components/DeclarativeTile';
import type { TileViewSpec } from '../tiles/viewSpec';

const SIDECAR = 'http://127.0.0.1:5200';
const W = 576;
const H = 194;
const ACCENT = '#7cf5d4';

interface Spec {
  id: string;
  name: string;
  view: TileViewSpec;
  previewData: { config?: Record<string, unknown>; response?: unknown } | null;
}

/** What a tile with no declared `previewData` renders against. Deliberately
 *  obviously-sample rather than fake-real: an invented news headline
 *  presented as genuine would be worse than a dull frame. */
const STUB = { title: 'Sample', value: '—', items: [] as unknown[] };

const stage = document.createElement('div');
stage.style.cssText =
  `width:${W}px;height:${H}px;position:relative;overflow:hidden;background:#0b0c10;`
  + 'display:flex;flex-direction:column;padding:10px;box-sizing:border-box;'
  + 'font-family:system-ui,-apple-system,"Segoe UI",sans-serif;color:#e8e8ea';
document.body.appendChild(stage);

const status = document.createElement('div');
status.style.cssText = 'margin-top:12px';
status.textContent = 'starting…';
document.body.appendChild(status);

const root = createRoot(stage);

async function rasterize(): Promise<string> {
  const xml = new XMLSerializer().serializeToString(stage);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">`
    + `<rect width="${W}" height="${H}" fill="#0b0c10"/>`
    + `<foreignObject width="${W}" height="${H}">${xml}</foreignObject></svg>`;
  const img = new Image();
  await new Promise((res, rej) => {
    img.onload = res;
    img.onerror = () => rej(new Error('svg rasterize failed'));
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  });
  const out = document.createElement('canvas');
  out.width = W;
  out.height = H;
  out.getContext('2d')!.drawImage(img, 0, 0);
  return out.toDataURL('image/png');
}

async function captureOne(id: string): Promise<void> {
  const spec: Spec = await (await fetch(`${SIDECAR}/spec?id=${encodeURIComponent(id)}`)).json();
  const data = spec.previewData?.response ?? STUB;
  const configValues = spec.previewData?.config ?? {};

  // flushSync so the DOM is committed before it is serialized — an async
  // commit would rasterize the previous tile, which is the kind of off-by-one
  // that produces a whole batch of subtly wrong previews.
  flushSync(() => {
    root.render(
      <ViewRenderer spec={spec.view} data={data} configValues={configValues} accent={ACCENT} />,
    );
  });
  // One frame for layout and any transition to settle.
  await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 60)));

  const dataUrl = await rasterize();
  const resp = await fetch(`${SIDECAR}/save?id=${encodeURIComponent(id)}`, {
    method: 'POST', body: dataUrl,
  });
  if (!resp.ok) throw new Error(`${id}: ${await resp.text()}`);
}

void (async () => {
  const params = new URLSearchParams(location.search);
  const ids: string[] = params.has('id')
    ? [params.get('id')!]
    : await (await fetch(`${SIDECAR}/list`)).json();
  const failed: string[] = [];
  for (const id of ids) {
    status.textContent = `capturing ${id}…`;
    try {
      await captureOne(id);
      status.textContent = `${id} ✓`;
    } catch (e) {
      failed.push(`${id}: ${(e as Error).message}`);
      console.error(id, e);
    }
  }
  document.title = failed.length ? 'CAPTURE FAILED' : 'CAPTURE DONE';
  status.innerHTML = failed.length
    ? `FAILED ${failed.length}:<br>${failed.join('<br>')}`
    : `ALL DONE — ${ids.length} captured`;
})();

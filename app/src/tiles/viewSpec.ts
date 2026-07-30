// ─────────────────────────────────────────────────────────────────────────────
// The `view.json` contract for declarative tiles.
//
// A declarative tile carries NO code. It names where data comes from and which
// native primitive renders it; the host does the fetching and the drawing. That
// is the whole security story — an installed tile cannot execute anything, so
// it needs no sandbox.
//
// The template grammar is substitution only (see template.ts). If you find
// yourself wanting an operator here, the answer is a phase-3 scripted tile, not
// a bigger grammar.
// ─────────────────────────────────────────────────────────────────────────────

/** Lowest refresh interval a bundle may request, so a published tile cannot
 *  hammer a third-party API from every install. */
export const MIN_INTERVAL_MS = 15_000;

export type TileSource =
  | { kind: 'http'; url: string; headers?: Record<string, string>; intervalMs: number }
  | { kind: 'tauri'; command: string; args?: Record<string, unknown>; intervalMs: number };

export interface ListRow {
  left?: string;
  title: string;
  right?: string;
  openUrl?: string;
}

export type TileView =
  | { type: 'list'; row: ListRow; emptyText?: string }
  | { type: 'stat'; value: string; label?: string; delta?: string }
  | { type: 'rows'; rows: { label: string; value: string }[] }
  | { type: 'text'; body: string; attribution?: string }
  | { type: 'badge'; value: string; label?: string };

export interface TileViewSpec {
  source: TileSource;
  /** Dot-path into the response selecting what the view renders. Omit for the
   *  whole response. `list` expects it to resolve to an array. */
  select?: string;
  view: TileView;
}

// A segment is either a plain identifier (`[A-Za-z_][A-Za-z0-9_]*`) or a
// literal non-negative integer with no leading zero (`0` or `[1-9][0-9]*`) —
// the latter is how a tile indexes into an array a real API actually
// returned at that position (a bare top-level array is completely ordinary
// for a third-party JSON API). This is still not an expression language: no
// variables, no arithmetic, no negative or relative indices — a literal
// integer is exactly as static and auditable as any other segment, and
// `resolvePath` needs no runtime change to support it (arrays already expose
// numeric-string keys as own properties).
const SEGMENT = '(?:[A-Za-z_][A-Za-z0-9_]*|0|[1-9][0-9]*)';
const DOT_PATH = new RegExp(`^${SEGMENT}(\\.${SEGMENT})*$`);
const SECRET_RE = /\{\{\s*secret\.[^}]*\}\}/;

const fail = (error: string) => ({ ok: false as const, error });

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Deep scan for a `{{secret.*}}` placeholder in any string within `v`. */
function containsSecretRef(v: unknown): boolean {
  if (typeof v === 'string') return SECRET_RE.test(v);
  if (Array.isArray(v)) return v.some(containsSecretRef);
  if (isPlainObject(v)) return Object.values(v).some(containsSecretRef);
  return false;
}

function validateSource(raw: unknown): { ok: true; source: TileSource } | { ok: false; error: string } {
  if (!isPlainObject(raw)) return fail('source must be an object');
  const interval = raw.intervalMs;
  if (typeof interval !== 'number' || !Number.isFinite(interval)) {
    return fail('source.intervalMs must be a number');
  }
  if (interval < MIN_INTERVAL_MS) {
    return fail(`source.intervalMs must be at least ${MIN_INTERVAL_MS}ms`);
  }
  if (raw.kind === 'http') {
    if (typeof raw.url !== 'string' || !raw.url.startsWith('https://')) {
      return fail('source.url must be an https:// URL');
    }
    if (raw.headers !== undefined) {
      if (!isPlainObject(raw.headers)) return fail('source.headers must be an object');
      for (const [k, v] of Object.entries(raw.headers)) {
        if (typeof v !== 'string') return fail(`source.headers.${k} must be a string`);
      }
    }
    return {
      ok: true,
      source: {
        kind: 'http',
        url: raw.url,
        headers: raw.headers as Record<string, string> | undefined,
        intervalMs: interval,
      },
    };
  }
  if (raw.kind === 'tauri') {
    if (typeof raw.command !== 'string' || !/^[a-z0-9_]{1,64}$/.test(raw.command)) {
      return fail('source.command must be 1-64 chars of [a-z0-9_]');
    }
    if (raw.args !== undefined && !isPlainObject(raw.args)) {
      return fail('source.args must be an object');
    }
    return {
      ok: true,
      source: {
        kind: 'tauri',
        command: raw.command,
        args: raw.args as Record<string, unknown> | undefined,
        intervalMs: interval,
      },
    };
  }
  return fail(`unknown source kind ${JSON.stringify(raw.kind)} (expected "http" or "tauri")`);
}

function validateView(raw: unknown): { ok: true; view: TileView } | { ok: false; error: string } {
  if (!isPlainObject(raw)) return fail('view must be an object');
  switch (raw.type) {
    case 'list': {
      if (!isPlainObject(raw.row)) return fail('list view requires a `row` object');
      const title = raw.row.title;
      if (typeof title !== 'string') return fail('list row requires a string `title`');
      const left = raw.row.left;
      if (left !== undefined && typeof left !== 'string') return fail('list row.left must be a string');
      const right = raw.row.right;
      if (right !== undefined && typeof right !== 'string') return fail('list row.right must be a string');
      const openUrl = raw.row.openUrl;
      if (openUrl !== undefined && typeof openUrl !== 'string') return fail('list row.openUrl must be a string');
      const emptyText = raw.emptyText;
      if (emptyText !== undefined && typeof emptyText !== 'string') return fail('list emptyText must be a string');
      return {
        ok: true,
        view: {
          type: 'list',
          row: { title, ...(left !== undefined && { left }), ...(right !== undefined && { right }), ...(openUrl !== undefined && { openUrl }) },
          ...(emptyText !== undefined && { emptyText }),
        },
      };
    }
    case 'stat': {
      if (typeof raw.value !== 'string') return fail('stat view requires a string `value`');
      const label = raw.label;
      if (label !== undefined && typeof label !== 'string') return fail('stat label must be a string');
      const delta = raw.delta;
      if (delta !== undefined && typeof delta !== 'string') return fail('stat delta must be a string');
      return {
        ok: true,
        view: { type: 'stat', value: raw.value, ...(label !== undefined && { label }), ...(delta !== undefined && { delta }) },
      };
    }
    case 'rows': {
      if (!Array.isArray(raw.rows) || raw.rows.length === 0) return fail('rows view requires a non-empty `rows` array');
      const validated: { label: string; value: string }[] = [];
      for (const r of raw.rows) {
        if (!isPlainObject(r) || typeof r.label !== 'string' || typeof r.value !== 'string') {
          return fail('each rows entry needs string `label` and `value`');
        }
        validated.push({ label: r.label, value: r.value });
      }
      return { ok: true, view: { type: 'rows', rows: validated } };
    }
    case 'text': {
      if (typeof raw.body !== 'string') return fail('text view requires a string `body`');
      const attribution = raw.attribution;
      if (attribution !== undefined && typeof attribution !== 'string') return fail('text attribution must be a string');
      return {
        ok: true,
        view: { type: 'text', body: raw.body, ...(attribution !== undefined && { attribution }) },
      };
    }
    case 'badge': {
      if (typeof raw.value !== 'string') return fail('badge view requires a string `value`');
      const label = raw.label;
      if (label !== undefined && typeof label !== 'string') return fail('badge label must be a string');
      return {
        ok: true,
        view: { type: 'badge', value: raw.value, ...(label !== undefined && { label }) },
      };
    }
    default:
      return fail(`unknown view type ${JSON.stringify(raw.type)} (expected list, stat, rows, text or badge)`);
  }
}

export function validateViewSpec(
  raw: unknown,
): { ok: true; spec: TileViewSpec } | { ok: false; error: string } {
  if (!isPlainObject(raw)) return fail('view spec must be a JSON object');

  const src = validateSource(raw.source);
  if (!src.ok) return src;

  if (raw.select !== undefined) {
    if (typeof raw.select !== 'string' || !DOT_PATH.test(raw.select)) {
      return fail('select must be a plain dot-path (no indexing, no expressions)');
    }
  }

  const view = validateView(raw.view);
  if (!view.ok) return view;

  // A credential may only be substituted into the outgoing request (in source.url
  // or source.headers). Anywhere in `view` or `select` it would be rendered on
  // screen, so reject it at validation time rather than trusting authors.
  if (containsSecretRef(raw.view)) {
    return fail('{{secret.*}} is not allowed in `view` — secrets may only appear in source.url or source.headers');
  }

  return { ok: true, spec: { source: src.source, select: raw.select as string | undefined, view: view.view } };
}

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

/** Where `{{secret.*}}` may legally appear. Anywhere else — above all inside
 *  `view` — would render a credential on screen. */
export const SECRET_ALLOWED_IN = ['source.url', 'source.headers'] as const;

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

const DOT_PATH = /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$/;
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
  const str = (k: string, required: boolean): string | null | undefined => {
    const v = raw[k];
    if (v === undefined) return required ? undefined : null;
    return typeof v === 'string' ? v : undefined;
  };
  switch (raw.type) {
    case 'list': {
      if (!isPlainObject(raw.row)) return fail('list view requires a `row` object');
      const title = raw.row.title;
      if (typeof title !== 'string') return fail('list row requires a string `title`');
      for (const k of ['left', 'right', 'openUrl']) {
        if (raw.row[k] !== undefined && typeof raw.row[k] !== 'string') {
          return fail(`list row.${k} must be a string`);
        }
      }
      return { ok: true, view: { type: 'list', row: raw.row as unknown as ListRow, emptyText: raw.emptyText as string | undefined } };
    }
    case 'stat': {
      if (str('value', true) === undefined) return fail('stat view requires a string `value`');
      return { ok: true, view: { type: 'stat', value: raw.value as string, label: raw.label as string | undefined, delta: raw.delta as string | undefined } };
    }
    case 'rows': {
      if (!Array.isArray(raw.rows) || raw.rows.length === 0) return fail('rows view requires a non-empty `rows` array');
      for (const r of raw.rows) {
        if (!isPlainObject(r) || typeof r.label !== 'string' || typeof r.value !== 'string') {
          return fail('each rows entry needs string `label` and `value`');
        }
      }
      return { ok: true, view: { type: 'rows', rows: raw.rows as { label: string; value: string }[] } };
    }
    case 'text': {
      if (str('body', true) === undefined) return fail('text view requires a string `body`');
      return { ok: true, view: { type: 'text', body: raw.body as string, attribution: raw.attribution as string | undefined } };
    }
    case 'badge': {
      if (str('value', true) === undefined) return fail('badge view requires a string `value`');
      return { ok: true, view: { type: 'badge', value: raw.value as string, label: raw.label as string | undefined } };
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

  // A credential may only be substituted into the outgoing request. Anywhere in
  // `view` it would be rendered on screen, so reject it at validation time
  // rather than trusting authors.
  if (containsSecretRef(raw.view)) {
    return fail('{{secret.*}} is not allowed in `view` — secrets may only appear in source.url or source.headers');
  }
  if (raw.select !== undefined && SECRET_RE.test(String(raw.select))) {
    return fail('{{secret.*}} is not allowed in `select`');
  }

  return { ok: true, spec: { source: src.source, select: raw.select as string | undefined, view: view.view } };
}

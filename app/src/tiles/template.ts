// ─────────────────────────────────────────────────────────────────────────────
// `{{path}}` substitution for declarative tiles.
//
// Substitution ONLY: a placeholder names a dot-path into the scope and is
// replaced by that value's string form. No expressions, no operators, no
// conditionals, no calls. A tile that needs any of those is a phase-3 scripted
// tile. Keeping this dumb is what makes an installed tile safe to render.
//
// Two deliberate properties:
//  - one pass, so a value that itself looks like a placeholder is NOT expanded
//    (otherwise response data could reach `{{secret.*}}`);
//  - own-properties only, so `__proto__`/`constructor` resolve to undefined.
// ─────────────────────────────────────────────────────────────────────────────

export interface TemplateScope {
  item?: unknown;
  data?: unknown;
  config?: Record<string, unknown>;
  secret?: Record<string, string>;
  location?: unknown;
  units?: unknown;
}

const PLACEHOLDER = /\{\{\s*([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*)\s*\}\}/g;

export function resolvePath(scope: unknown, path: string): unknown {
  let cur: unknown = scope;
  for (const key of path.split('.')) {
    if (typeof cur !== 'object' || cur === null) return undefined;
    if (!Object.prototype.hasOwnProperty.call(cur, key)) return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

/** Scalars render as themselves; anything structural renders empty, because a
 *  tile that stringifies an object is a bug the author should see as blank
 *  rather than as "[object Object]". */
function render(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '';
  if (typeof v === 'boolean') return String(v);
  return '';
}

export function substitute(tpl: string, scope: TemplateScope): string {
  return tpl.replace(PLACEHOLDER, (_m, path: string) => render(resolvePath(scope, path)));
}

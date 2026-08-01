// ─────────────────────────────────────────────────────────────────────────────
// Permission broker — the enforcement point for marketplace-installed bundles.
//
// The sandbox can only *ask* (postMessage rpc); this module decides. A request
// is allowed only when the installed manifest declares the exact capability:
//   net:<host>       → fetches to exactly that host (https, via Rust broker_fetch)
//   tauri:<command>  → that command, AND it must also be in BROKER_COMMANDS
//
// BROKER_COMMANDS is the app's own allowlist of commands that are safe to
// expose to reviewed third-party code. It ships EMPTY on purpose: adding a
// command is a deliberate, reviewable one-line change — never automatic.
// Pure logic is separated (brokerDecide) so enforcement is unit-tested.
// ─────────────────────────────────────────────────────────────────────────────

import { parsePermission, type Permission } from './manifest';

/** Tauri commands exposable to sandboxed bundles. Deliberately empty at
 *  launch — see header comment before adding anything. */
export const BROKER_COMMANDS: Record<string, true> = {};

export interface RpcRequest {
  rpc: 'net.fetch' | 'tauri.invoke';
  url?: string;
  command?: string;
  args?: unknown;
}

export function permissionsOf(raw: string[]): Permission[] {
  const out: Permission[] = [];
  for (const s of raw) {
    const p = parsePermission(s);
    if (p.ok) out.push(p.perm);
  }
  return out;
}

export function brokerDecide(
  perms: Permission[],
  req: RpcRequest,
): { allow: true } | { allow: false; reason: string } {
  // `secret:<key>` permissions are deliberately never consulted below. They
  // are a declaration for the host's install-time UI and request-injection
  // path, not a capability — a secret grants no fetch or invoke on its own.
  // The `p.kind === 'net'` / `p.kind === 'tauri'` filters below already
  // exclude them; do not widen either check to also match `kind === 'secret'`.
  if (req.rpc === 'net.fetch') {
    let host: string;
    try {
      const u = new URL(req.url ?? '');
      if (u.protocol !== 'https:') return { allow: false, reason: 'only https URLs are allowed' };
      host = u.hostname.toLowerCase();
    } catch {
      return { allow: false, reason: 'invalid URL' };
    }
    const ok = perms.some((p) => p.kind === 'net' && p.host.toLowerCase() === host);
    return ok
      ? { allow: true }
      : { allow: false, reason: `host ${host} is not declared in this bundle's permissions` };
  }
  if (req.rpc === 'tauri.invoke') {
    const cmd = req.command ?? '';
    if (!perms.some((p) => p.kind === 'tauri' && p.command === cmd)) {
      return { allow: false, reason: `command ${cmd} is not declared in this bundle's permissions` };
    }
    if (!BROKER_COMMANDS[cmd]) {
      return { allow: false, reason: `command ${cmd} is not broker-exposable in this app version` };
    }
    return { allow: true };
  }
  return { allow: false, reason: 'unknown rpc' };
}

export interface BrokerDeps {
  /** Performs the actual fetch (Rust `broker_fetch`: https-only, size-capped).
   *  `headers` is optional — visualizers never declare secrets and pass
   *  none; declarative tiles (DeclarativeTile.tsx) use it to carry a
   *  substituted `Authorization`-style header, which the Rust side validates
   *  strictly (see `validate_headers` in marketplace.rs) since header values
   *  are built from config/secret substitution, not fully-trusted input. */
  fetch(url: string, headers?: Record<string, string>): Promise<{ status: number; body: string }>;
  /** Invokes an allowlisted tauri command. */
  invoke(command: string, args: unknown): Promise<unknown>;
}

/** Returns an async handler the host calls for each `{type:'rpc'}` message;
 *  the result is posted back as `{type:'rpc:result', rpcId, ...}`. */
export function makeBrokerHandler(perms: Permission[], deps: BrokerDeps) {
  return async (req: RpcRequest): Promise<{ ok: true; value: unknown } | { ok: false; error: string }> => {
    const decision = brokerDecide(perms, req);
    if (!decision.allow) return { ok: false, error: decision.reason };
    try {
      if (req.rpc === 'net.fetch') {
        return { ok: true, value: await deps.fetch(req.url!) };
      }
      return { ok: true, value: await deps.invoke(req.command!, req.args) };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  };
}

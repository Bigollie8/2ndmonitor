import React, { useEffect, useState } from 'react';
import { HFTile } from './tiles';
import { TileEmpty, TileError, TileNeedsSetup, TileSkeleton } from './tileStates';
import { TileCredentialPanel } from './TileCredentialPanel';
import { usePoll } from '../state/usePoll';
import { bundleSecretKey, deleteSecret, getSecret } from '../state/secrets';
import { appActions } from '../state/tauri';
import {
  validateManifest,
  type ConfigDecl,
  type Permission,
  type SecretDecl,
  type VizManifest,
} from '../sandbox/manifest';
import { brokerDecide, permissionsOf } from '../sandbox/broker';
import { validateViewSpec, type ListRow, type TileView, type TileViewSpec } from '../tiles/viewSpec';
import { resolvePath, substitute, type TemplateScope } from '../tiles/template';
import { buildRequest } from '../tiles/request';
import type { Density } from '../types';

// ─────────────────────────────────────────────────────────────────────────────
// Turns a `manifest.json` + `view.json` bundle into a tile indistinguishable
// from a built-in one. Reuses the same furniture every hand-written tile
// uses (HFTile / usePoll / tileStates) so an installed tile fits the
// dashboard visually and behaviorally.
//
// Security shape (see task-7-brief.md for the full rationale):
//  - secrets are resolved only inside the fetch path (buildRequest / the
//    tauri arg scope below), never inside the render scope handed to the
//    view primitives.
//  - every outgoing request — http or tauri — is checked with brokerDecide
//    against the manifest's declared permissions before it is made. A denial
//    renders TileError; it never falls back to fetching anyway.
//  - `tauri` sources are refused this phase because BROKER_COMMANDS (in
//    sandbox/broker.ts) ships empty on purpose. That refusal is surfaced as
//    a plain-language TileError, not the broker's internal reason string.
// ─────────────────────────────────────────────────────────────────────────────

export interface DeclarativeTileProps {
  bundleId: string;
  instanceId: string;
  density: Density;
  accent: string;
  editing: boolean;
}

interface LoadedBundle {
  manifest: VizManifest;
  spec: TileViewSpec;
  perms: Permission[];
}

type LoadState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; bundle: LoadedBundle };

/** Used only while the manifest hasn't loaded yet (so the poll interval is
 *  known); replaced the moment `spec.source.intervalMs` is available. */
const FALLBACK_INTERVAL_MS = 60_000;

const configStorageKey = (bundleId: string, instanceId: string) =>
  `tile.config.${bundleId}.${instanceId}`;

function readStoredConfig(bundleId: string, instanceId: string): Record<string, unknown> {
  try {
    const raw = localStorage.getItem(configStorageKey(bundleId, instanceId));
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function writeStoredConfig(bundleId: string, instanceId: string, config: Record<string, unknown>): void {
  try {
    localStorage.setItem(configStorageKey(bundleId, instanceId), JSON.stringify(config));
  } catch { /* storage full/unavailable — config just won't survive reload */ }
}

/** Reads every declared secret by key. Deliberately NOT one `useSecret(key)`
 *  call per declaration: the set of keys is only known once the manifest has
 *  loaded (0 keys while loading, N after), and a hook count that changes
 *  across renders violates the rules of hooks. This calls the plain
 *  `getSecret` the hook itself wraps, inside a single effect, so the number
 *  of hooks this component calls never depends on bundle contents.
 *  `version` is bumped by the caller after a save/disconnect to force a
 *  re-read without waiting for `keys` to change identity. */
function useSecretValues(
  bundleId: string, keys: string[], version: number,
): { values: Record<string, string>; loaded: boolean } {
  const keysSignature = keys.join(',');
  const [state, setState] = useState<{ values: Record<string, string>; loaded: boolean }>(
    () => (keys.length === 0 ? { values: {}, loaded: true } : { values: {}, loaded: false }),
  );

  useEffect(() => {
    let cancelled = false;
    if (keys.length === 0) {
      setState({ values: {}, loaded: true });
      return;
    }
    setState((s) => ({ values: s.values, loaded: false }));
    // Storage is namespaced per-bundle (bundleSecretKey) so a bundle can never
    // read a built-in tile's credential; `values` stays keyed by the
    // *declared* key so the rest of this component (buildRequest's secret
    // scope, needsSetup, etc.) is unaffected by the storage-key change.
    Promise.all(keys.map(async (k) => [k, await getSecret(bundleSecretKey(bundleId, k))] as const)).then((pairs) => {
      if (cancelled) return;
      const values: Record<string, string> = {};
      for (const [k, v] of pairs) if (v != null) values[k] = v;
      setState({ values, loaded: true });
    });
    return () => { cancelled = true; };
    // keysSignature (not keys) is the real dependency: `keys` is a fresh
    // array each render even when its contents haven't changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bundleId, keysSignature, version]);

  return state;
}

/** A list row's `openUrl` comes from the substituted REMOTE HTTP RESPONSE,
 *  not from the bundle — the manifest/view.json only supplies the template,
 *  and the response's own field values fill it in. It must therefore be
 *  treated as fully untrusted input before it ever reaches `appActions.
 *  openUrl` (which shells out via `cmd /C start`, see actions.rs). `new
 *  URL(...)` is the parse; only `http:`/`https:` survive. A parse failure or
 *  any other scheme returns undefined — deliberately not "cleaned" or
 *  re-encoded, just refused (C3). */
function safeExternalUrl(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  try {
    const parsed = new URL(raw);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? raw : undefined;
  } catch {
    return undefined;
  }
}

/** Parses a `broker_fetch` response body. An empty 200 body is not malformed
 *  JSON — it's the absence of data (e.g. an ntfy topic with no new messages,
 *  the majority state for `tile-phonenotifs`) — so it is treated as `null`
 *  rather than a parse failure. `data == null` already renders `TileEmpty`
 *  for free (see `ViewRenderer` below); before this fix an empty body threw
 *  "response body was not valid JSON" and surfaced as a raw `TileError`
 *  instead. Whitespace-only bodies (e.g. a lone newline some servers emit
 *  for an empty 200) are treated the same way. */
export function parseResponseBody(body: string): unknown {
  if (body.trim() === '') return null;
  try {
    return JSON.parse(body);
  } catch {
    throw new Error('response body was not valid JSON');
  }
}

/** Redacts every known secret VALUE from an error message before it's ever
 *  rendered — `TileError` shows `error` verbatim. `broker_fetch` (marketplace.
 *  rs) surfaces `format!("request failed: {e}")` on any HTTP failure, and
 *  ureq's error `Display` includes the full request URL; the view-spec
 *  grammar explicitly blesses secrets in `source.url` (e.g.
 *  `?key={{secret.api_key}}`). Without this, a 401/DNS/TLS/timeout would put
 *  a live credential in plain text on screen (I1). Applied at the one place
 *  this component produces an error string, since that's where the secret
 *  values are in scope. */
function redactSecrets(message: string, secretValues: Record<string, string>): string {
  let out = message;
  for (const value of Object.values(secretValues)) {
    if (!value) continue;
    out = out.split(value).join('***');
  }
  return out;
}

/** `brokerDecide`'s reason strings are precise on purpose (host names,
 *  command names) but the "command not broker-exposable" case is a policy
 *  decision a user should read as intentional, not as an internal error. */
function explainBrokerDenial(reason: string): string {
  if (reason.includes('not broker-exposable')) {
    return "this tile needs an app command that isn't enabled";
  }
  return reason;
}

export function DeclarativeTile({ bundleId, instanceId, density, accent, editing }: DeclarativeTileProps) {
  const [loadState, setLoadState] = useState<LoadState>({ kind: 'loading' });
  const [setupOpen, setSetupOpen] = useState(false);
  const [secretsVersion, setSecretsVersion] = useState(0);
  const [configValues, setConfigValues] = useState<Record<string, unknown>>(
    () => readStoredConfig(bundleId, instanceId),
  );

  // Load + validate manifest.json and view.json. Every failure — unreadable
  // folder, bad JSON, a validator rejection — becomes loadState.error so the
  // tile always renders something explanatory instead of staying blank.
  useEffect(() => {
    let cancelled = false;
    setLoadState({ kind: 'loading' });
    (async () => {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        const raw = await invoke<{ manifest: string; view: string }>('tiles_read', { id: bundleId });

        let manifestJson: unknown;
        try {
          manifestJson = JSON.parse(raw.manifest);
        } catch {
          throw new Error('manifest.json is not valid JSON');
        }
        const mv = validateManifest(manifestJson, { allowPermissions: true });
        if (!mv.ok) throw new Error(`manifest.json: ${mv.error}`);

        let viewJson: unknown;
        try {
          viewJson = JSON.parse(raw.view);
        } catch {
          throw new Error('view.json is not valid JSON');
        }
        const vv = validateViewSpec(viewJson);
        if (!vv.ok) throw new Error(`view.json: ${vv.error}`);

        if (cancelled) return;
        setLoadState({
          kind: 'ready',
          bundle: { manifest: mv.manifest, spec: vv.spec, perms: permissionsOf(mv.manifest.permissions) },
        });
      } catch (e) {
        if (cancelled) return;
        setLoadState({ kind: 'error', message: e instanceof Error ? e.message : String(e) });
      }
    })();
    return () => { cancelled = true; };
  }, [bundleId]);

  useEffect(() => {
    setConfigValues(readStoredConfig(bundleId, instanceId));
  }, [bundleId, instanceId]);

  const bundle = loadState.kind === 'ready' ? loadState.bundle : null;
  const secretDecls: SecretDecl[] = bundle?.manifest.secrets ?? [];
  const configDecls: ConfigDecl[] = bundle?.manifest.config ?? [];
  const secretKeys = secretDecls.map((s) => s.key);

  const { values: secretValues, loaded: secretsLoaded } = useSecretValues(bundleId, secretKeys, secretsVersion);
  // A tile can need setup for a missing secret OR a missing config value —
  // e.g. a config-only tile (no secrets at all, such as a dictionary lookup
  // parameterized by a `word` config entry) has nothing to inject into
  // secretValues and would otherwise never trip this flag, leaving no way
  // to ever open TileCredentialPanel and fill in the config the tile
  // actually needs to build a working request.
  const needsSetup = secretsLoaded && (
    secretDecls.some((d) => !secretValues[d.key])
    || configDecls.some((d) => {
      const v = configValues[d.key];
      return v == null || v === '';
    })
  );

  const saveConfig = (next: Record<string, unknown>) => {
    writeStoredConfig(bundleId, instanceId, next);
    setConfigValues(next);
  };

  const intervalMs = bundle?.spec.source.intervalMs ?? FALLBACK_INTERVAL_MS;

  const { data, error, loading, refresh } = usePoll<unknown>(async () => {
    if (!bundle) throw new Error('tile is not loaded yet');
    if (needsSetup) return null;

    // Every throw below is funneled through this catch so a secret value
    // never reaches the rendered error string (I1) — e.g. broker_fetch's
    // "request failed: {e}" includes ureq's full request URL, which may
    // itself carry a secret per the view-spec's own `?key={{secret.x}}`
    // grammar.
    try {
      const { spec, perms } = bundle;
      if (spec.source.kind === 'tauri') {
        const decision = brokerDecide(perms, {
          rpc: 'tauri.invoke', command: spec.source.command, args: spec.source.args,
        });
        if (!decision.allow) throw new Error(explainBrokerDenial(decision.reason));
        // Unreachable while BROKER_COMMANDS (sandbox/broker.ts) is empty,
        // which it is by design this phase — kept so a future allowlisted
        // command works without touching this component again.
        const { invoke } = await import('@tauri-apps/api/core');
        return await invoke(spec.source.command, spec.source.args);
      }

      // http source. Secrets are injected right here, host-side, and only
      // into the outgoing request — buildRequest's returned url/headers are
      // the only place a credential value ever exists in this component.
      const req = buildRequest(spec.source, { config: configValues, secret: secretValues });
      const decision = brokerDecide(perms, { rpc: 'net.fetch', url: req.url });
      if (!decision.allow) throw new Error(decision.reason);

      const { invoke } = await import('@tauri-apps/api/core');
      // Send `undefined` rather than `{}` when there are no headers, so the
      // common no-header case is unchanged on the wire (and the Rust side's
      // `Option<HashMap<...>>` sees `None`, skipping header validation
      // entirely instead of validating an empty map).
      const headers = Object.keys(req.headers).length > 0 ? req.headers : undefined;
      const res = await invoke<{ status: number; body: string }>('broker_fetch', { url: req.url, headers });
      if (res.status < 200 || res.status >= 300) {
        throw new Error(`request failed: HTTP ${res.status}`);
      }
      return parseResponseBody(res.body);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      throw new Error(redactSecrets(message, secretValues));
    }
  }, intervalMs, [bundle, needsSetup, JSON.stringify(configValues), JSON.stringify(secretValues)]);

  const title = bundle?.manifest.name ?? 'Tile';

  return (
    <HFTile title={title} accent={accent} density={density} style={{ height: '100%' }}>
      <div style={{
        position: 'absolute', inset: 0, padding: 10,
        display: 'flex', flexDirection: 'column', gap: 6,
        overflow: 'hidden',
      }}>
        {loadState.kind === 'loading' && <TileSkeleton rows={3} />}
        {loadState.kind === 'error' && <TileError line={loadState.message} />}

        {loadState.kind === 'ready' && !secretsLoaded && <TileSkeleton rows={3} />}

        {loadState.kind === 'ready' && secretsLoaded && needsSetup && !editing && !setupOpen && (
          <TileNeedsSetup
            accent={accent}
            line={setupHintLine(secretDecls, configDecls)}
            onSetup={() => setSetupOpen(true)}
          />
        )}

        {/* Shown whenever `editing` is true, regardless of `needsSetup` — a
            placed tile must always be reconfigurable in edit mode (I6). Before
            this fix, a config-only tile (no secrets) with every config field
            already non-empty could never reopen this panel again: needsSetup
            had gone false permanently and there was no disconnect escape
            hatch (that's gated on secretDecls.length > 0). `storedSecretKeys`
            (Object.keys(secretValues) — populated ones only) lets the panel
            treat an already-configured secret as optional to retype, so
            reopening this panel to tweak one config field doesn't also force
            re-entering every working credential. */}
        {loadState.kind === 'ready' && secretsLoaded && (editing || (needsSetup && setupOpen)) && (
          <TileCredentialPanel
            bundleId={bundleId}
            accent={accent}
            secrets={secretDecls}
            config={configDecls}
            storedSecretKeys={Object.keys(secretValues)}
            initialConfig={configValues}
            introLine={setupHintLine(secretDecls, configDecls)}
            onSaveConfig={saveConfig}
            onSecretsSaved={() => { setSecretsVersion((v) => v + 1); setSetupOpen(false); refresh(); }}
          />
        )}

        {loadState.kind === 'ready' && secretsLoaded && !needsSetup && !editing && error && (
          <TileError line={error} onRetry={refresh} />
        )}
        {loadState.kind === 'ready' && secretsLoaded && !needsSetup && !editing && !error && loading && data == null && (
          <TileSkeleton rows={4} />
        )}
        {loadState.kind === 'ready' && secretsLoaded && !needsSetup && !editing && !error && !loading && (
          <ViewRenderer spec={bundle!.spec} data={data} configValues={configValues} accent={accent} />
        )}

        {loadState.kind === 'ready' && secretsLoaded && !needsSetup && editing && secretDecls.length > 0 && (
          <button
            onClick={() => {
              void Promise.all(secretDecls.map((d) => deleteSecret(bundleSecretKey(bundleId, d.key))))
                .then(() => setSecretsVersion((v) => v + 1));
            }}
            style={{
              padding: '4px 10px', fontSize: 10, fontWeight: 600, borderRadius: 4,
              background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.7)',
              border: '1px solid rgba(255,255,255,0.08)', cursor: 'pointer',
              alignSelf: 'flex-start', flexShrink: 0,
            }}
          >disconnect</button>
        )}
      </div>
    </HFTile>
  );
}

function setupHintLine(secrets: SecretDecl[], config: ConfigDecl[]): React.ReactNode {
  const parts: string[] = [];
  if (secrets.length > 0) parts.push(`connect ${secrets.map((s) => s.label).join(', ')}`);
  if (config.length > 0) parts.push(`set ${config.map((c) => c.label).join(', ')}`);
  if (parts.length === 0) return 'This tile needs to be connected.';
  const [first, ...rest] = parts;
  return `${first![0]!.toUpperCase()}${first!.slice(1)}${rest.length ? ` and ${rest.join(' and ')}` : ''} to use this tile.`;
}

// ── View primitives ──────────────────────────────────────────────────────────
// Each one substitutes with { item?, data, config } only — no `secret` ever
// reaches this scope, so a credential cannot land on screen even if
// validation were somehow bypassed upstream.

/** Exported for `scripts/tile-preview-capture.ts`, which renders a
 *  declarative tile against sample data to produce its preview image. It is
 *  the whole render half of this component with none of the fetching, which
 *  is exactly what a capture harness needs — and rendering through the REAL
 *  renderer is the point: a second one written for the harness would drift,
 *  and a preview that does not match the tile is worse than no preview. */
export function ViewRenderer({
  spec, data, configValues, accent,
}: { spec: TileViewSpec; data: unknown; configValues: Record<string, unknown>; accent: string }) {
  const selected: unknown = spec.select ? resolvePath(data, spec.select) : data;

  if (data == null) {
    return <TileEmpty icon="◻" line="No data yet." />;
  }

  switch (spec.view.type) {
    case 'list': {
      if (!Array.isArray(selected)) {
        return (
          <TileError
            line={`"select: ${spec.select ?? '(root)'}" did not resolve to an array, as the list view requires`}
          />
        );
      }
      if (selected.length === 0) {
        return <TileEmpty icon="◻" line={spec.view.emptyText ?? 'Nothing to show.'} />;
      }
      return (
        <ListPrimitive
          view={spec.view}
          items={selected}
          data={data}
          configValues={configValues}
          accent={accent}
        />
      );
    }
    case 'stat':
      return <StatPrimitive view={spec.view} scope={{ data: selected, config: configValues }} accent={accent} />;
    case 'rows':
      return <RowsPrimitive view={spec.view} scope={{ data: selected, config: configValues }} />;
    case 'text':
      return <TextPrimitive view={spec.view} scope={{ data: selected, config: configValues }} accent={accent} />;
    case 'badge':
      return <BadgePrimitive view={spec.view} scope={{ data: selected, config: configValues }} accent={accent} />;
    default:
      return <TileError line="unknown view type" />;
  }
}

function ListPrimitive({
  view, items, data, configValues, accent,
}: {
  view: Extract<TileView, { type: 'list' }>;
  items: unknown[];
  data: unknown;
  configValues: Record<string, unknown>;
  accent: string;
}) {
  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
      {items.map((item, i) => {
        const scope: TemplateScope = { item, data, config: configValues };
        const row: ListRow = view.row;
        const title = substitute(row.title, scope);
        const left = row.left !== undefined ? substitute(row.left, scope) : undefined;
        const right = row.right !== undefined ? substitute(row.right, scope) : undefined;
        const openUrl = safeExternalUrl(row.openUrl !== undefined ? substitute(row.openUrl, scope) : undefined);
        return (
          <div
            key={i}
            onClick={openUrl ? () => { void appActions.openUrl(openUrl); } : undefined}
            title={title}
            style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '5px 6px', fontSize: 11.5, borderRadius: 4,
              background: 'rgba(255,255,255,0.02)',
              cursor: openUrl ? 'pointer' : 'default',
            }}
          >
            {left && (
              <span style={{
                color: accent, fontFamily: '"JetBrains Mono", ui-monospace, monospace', flexShrink: 0,
              }}>{left}</span>
            )}
            <span style={{
              flex: 1, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>{title}</span>
            {right && (
              <span style={{
                fontSize: 9.5, color: 'rgba(255,255,255,0.4)', flexShrink: 0,
                fontFamily: '"JetBrains Mono", ui-monospace, monospace',
              }}>{right}</span>
            )}
          </div>
        );
      })}
    </div>
  );
}

function StatPrimitive({
  view, scope, accent,
}: { view: Extract<TileView, { type: 'stat' }>; scope: TemplateScope; accent: string }) {
  const value = substitute(view.value, scope);
  const label = view.label !== undefined ? substitute(view.label, scope) : undefined;
  const delta = view.delta !== undefined ? substitute(view.delta, scope) : undefined;
  return (
    <div style={{
      flex: 1, display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center', gap: 4,
    }}>
      {label && (
        <span style={{
          fontSize: 9, color: 'rgba(255,255,255,0.45)', letterSpacing: '0.08em',
          textTransform: 'uppercase', fontFamily: '"JetBrains Mono", ui-monospace, monospace',
        }}>{label}</span>
      )}
      <span style={{
        fontSize: 32, fontWeight: 700, color: accent,
        fontFamily: '"JetBrains Mono", ui-monospace, monospace', lineHeight: 1,
      }}>{value}</span>
      {delta && <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.6)' }}>{delta}</span>}
    </div>
  );
}

function RowsPrimitive({ view, scope }: { view: Extract<TileView, { type: 'rows' }>; scope: TemplateScope }) {
  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: 6, justifyContent: 'center' }}>
      {view.rows.map((r, i) => (
        <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 11.5 }}>
          <span style={{
            color: 'rgba(255,255,255,0.55)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>{substitute(r.label, scope)}</span>
          <span style={{
            color: '#fff', fontFamily: '"JetBrains Mono", ui-monospace, monospace', flexShrink: 0,
          }}>{substitute(r.value, scope)}</span>
        </div>
      ))}
    </div>
  );
}

function TextPrimitive({
  view, scope, accent,
}: { view: Extract<TileView, { type: 'text' }>; scope: TemplateScope; accent: string }) {
  const body = substitute(view.body, scope);
  const attribution = view.attribution !== undefined ? substitute(view.attribution, scope) : undefined;
  return (
    <div style={{
      flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column',
      justifyContent: 'center', gap: 10, overflow: 'hidden',
    }}>
      <div style={{
        fontSize: 14, lineHeight: 1.5, color: 'rgba(255,255,255,0.92)',
        overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 6 as any, WebkitBoxOrient: 'vertical' as any,
      }}>{body}</div>
      {attribution && (
        <div style={{
          fontSize: 11, color: accent, fontFamily: '"JetBrains Mono", ui-monospace, monospace', textAlign: 'right',
        }}>— {attribution}</div>
      )}
    </div>
  );
}

function BadgePrimitive({
  view, scope, accent,
}: { view: Extract<TileView, { type: 'badge' }>; scope: TemplateScope; accent: string }) {
  const value = substitute(view.value, scope);
  const label = view.label !== undefined ? substitute(view.label, scope) : undefined;
  return (
    <div style={{
      flex: 1, display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center', gap: 6,
    }}>
      <span style={{
        padding: '4px 10px', borderRadius: 999, background: `${accent}22`, color: accent,
        fontSize: 12, fontWeight: 700, fontFamily: '"JetBrains Mono", ui-monospace, monospace',
      }}>{value}</span>
      {label && <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.5)' }}>{label}</span>}
    </div>
  );
}

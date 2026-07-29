// ─────────────────────────────────────────────────────────────────────────────
// Scripted-visualizer manifest (schema v1) + host⇄sandbox postMessage protocol.
// Pure module: no React, no tauri — node-testable, and shared verbatim by the
// phase-3 marketplace validation pipeline.
// ─────────────────────────────────────────────────────────────────────────────

export interface VizManifest {
  /** Folder name; `[a-z0-9-]{1,64}`. */
  id: string;
  name: string;
  author?: string;
  version: string;
  /** Frame-payload contract version. Only 1 exists; evolution is additive. */
  api: 1;
  /** Broker permissions ("net:<host>" / "tauri:<command>"). Locally-authored
   *  visualizers must declare none; marketplace-installed bundles may (they
   *  were reviewed with these permissions and the user approved at install). */
  permissions: string[];
}

export type Permission =
  | { kind: 'net'; host: string }
  | { kind: 'tauri'; command: string };

const ID_RE = /^[a-z0-9-]{1,64}$/;
const CMD_RE = /^[a-z0-9_]{1,64}$/;
const HOST_LABEL_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/i;

/** Grammar mirrors the server's `Perm::parse` — keep the two in sync. */
export function parsePermission(s: string): { ok: true; perm: Permission } | { ok: false; error: string } {
  if (s.startsWith('net:')) {
    const host = s.slice(4);
    const ok = host.length > 0 && host.length <= 253
      && !/[/:?#@ ]/.test(host)
      && host.split('.').every((l) => HOST_LABEL_RE.test(l));
    return ok
      ? { ok: true, perm: { kind: 'net', host } }
      : { ok: false, error: `invalid net host: ${JSON.stringify(host)} (bare hostname only)` };
  }
  if (s.startsWith('tauri:')) {
    const command = s.slice(6);
    return CMD_RE.test(command)
      ? { ok: true, perm: { kind: 'tauri', command } }
      : { ok: false, error: `invalid tauri command: ${JSON.stringify(command)}` };
  }
  return { ok: false, error: `unknown permission ${JSON.stringify(s)} (expected net:<host> or tauri:<command>)` };
}

export function validateManifest(
  raw: unknown,
  opts?: { allowPermissions?: boolean },
): { ok: true; manifest: VizManifest } | { ok: false; error: string } {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, error: 'manifest must be a JSON object' };
  }
  const m = raw as Record<string, unknown>;
  if (typeof m.id !== 'string' || !ID_RE.test(m.id)) {
    return { ok: false, error: 'id must be 1-64 chars of [a-z0-9-]' };
  }
  if (typeof m.name !== 'string' || !m.name.trim()) {
    return { ok: false, error: 'name is required' };
  }
  if (m.author !== undefined && typeof m.author !== 'string') {
    return { ok: false, error: 'author must be a string' };
  }
  if (typeof m.version !== 'string' || !m.version.trim()) {
    return { ok: false, error: 'version is required' };
  }
  if (m.api !== 1) {
    return { ok: false, error: 'api must be 1 (the only published API version)' };
  }
  if (!Array.isArray(m.permissions)) {
    return { ok: false, error: 'permissions must be an array' };
  }
  if (!opts?.allowPermissions && m.permissions.length !== 0) {
    return { ok: false, error: 'locally-authored visualizers must not declare permissions (marketplace bundles only)' };
  }
  if (m.permissions.length > 16) {
    return { ok: false, error: 'too many permissions (max 16)' };
  }
  const permissions: string[] = [];
  for (const p of m.permissions) {
    if (typeof p !== 'string') return { ok: false, error: 'permissions entries must be strings' };
    const parsed = parsePermission(p);
    if (!parsed.ok) return parsed;
    permissions.push(p);
  }
  return {
    ok: true,
    manifest: {
      id: m.id,
      name: m.name,
      author: m.author as string | undefined,
      version: m.version,
      api: 1,
      permissions,
    },
  };
}

// ── postMessage protocol ─────────────────────────────────────────────────────
// Host → sandbox:
//   { type: 'init', code, settings, size, theme }
//   { type: 'frame', spectrum, waveform, bands, onset, level, dt, size, theme, track }
// Sandbox → host:
//   { type: 'ready' }
//   { type: 'error', message, line }
//   { type: 'settings:set', key, value }

export const MSG_INIT = 'init';
export const MSG_FRAME = 'frame';
export const MSG_READY = 'ready';
export const MSG_ERROR = 'error';
export const MSG_SETTINGS_SET = 'settings:set';

export interface VizTheme { accent: string; accent2: string }
export interface VizSize { width: number; height: number }
export interface VizTrackInfo { title: string; artist: string }

export interface InitMessage {
  type: typeof MSG_INIT;
  code: string;
  settings: Record<string, unknown>;
  size: VizSize;
  theme: VizTheme;
}

export interface FrameMessage {
  type: typeof MSG_FRAME;
  /** 64 spectrum bins, [0,1]. */
  spectrum: Float32Array;
  /** 1024 time-domain bytes, 0-255 centered 128. */
  waveform: Uint8Array;
  bands: { bass: number; mid: number; treble: number };
  onset: { kick: number; snare: number; hat: number };
  level: number;
  /** Seconds since previous frame. */
  dt: number;
  size: VizSize;
  theme: VizTheme;
  track: VizTrackInfo | null;
}

export interface ReadyMessage { type: typeof MSG_READY }
export interface ErrorMessage { type: typeof MSG_ERROR; message: string; line: number | null }
export interface SettingsSetMessage { type: typeof MSG_SETTINGS_SET; key: string; value: unknown }

export type SandboxToHost = ReadyMessage | ErrorMessage | SettingsSetMessage;

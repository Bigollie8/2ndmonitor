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
  /** Broker permissions ("net:<host>" / "tauri:<command>" / "secret:<key>").
   *  Locally-authored visualizers must declare none; marketplace-installed
   *  bundles may (they were reviewed with these permissions and the user
   *  approved at install). */
  permissions: string[];
  /** Declares that this bundle reads f.waveformL/R, so the host should turn
   *  the stereo waveform emit on while it is mounted (0.8.7). Absent = mono
   *  only, which is every bundle except the stereo meters — the stereo IPC
   *  (~8 KB of JSON per frame at 30 Hz) is not paid by bundles that never
   *  read it. */
  stereo?: boolean;
  /** Named credentials this tile needs. The host renders an input per entry,
   *  stores the value, and injects it into outgoing requests — the bundle
   *  itself never receives it. Every key here must also appear as a
   *  `secret:<key>` permission (see validateManifest). */
  secrets?: SecretDecl[];
  /** Per-instance user settings (e.g. a stock watchlist). Not credentials —
   *  no permission is required and a later task stores these in plain
   *  localStorage. */
  config?: ConfigDecl[];
  /** Render surface the bundle draws into. `'canvas'` (default) exposes a
   *  single `<canvas>`; `'dom'` gives the bundle a DOM root instead, for
   *  styles built from CSS transforms rather than canvas draw calls. Additive
   *  to api 1: an older app reading a newer manifest ignores an absent field
   *  and defaults to `'canvas'`; the field only ever *declares* which surface
   *  the frame already exposes — bundle code has always run inside the
   *  frame's document, so this widens no capability. */
  surface?: 'canvas' | 'dom';
}

export interface SecretDecl {
  key: string;
  label: string;
  kind: 'password' | 'text';
  help?: string;
}

export interface ConfigDecl {
  key: string;
  label: string;
  type: 'text' | 'number';
}

export type Permission =
  | { kind: 'net'; host: string }
  | { kind: 'tauri'; command: string }
  | { kind: 'secret'; key: string };

const ID_RE = /^[a-z0-9-]{1,64}$/;
const CMD_RE = /^[a-z0-9_]{1,64}$/;
const HOST_LABEL_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/i;
const SECRET_KEY_RE = /^[a-z0-9_]{1,64}$/;

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
  if (s.startsWith('secret:')) {
    const key = s.slice(7);
    return SECRET_KEY_RE.test(key)
      ? { ok: true, perm: { kind: 'secret', key } }
      : { ok: false, error: `invalid secret key: ${JSON.stringify(key)}` };
  }
  return { ok: false, error: `unknown permission ${JSON.stringify(s)} (expected net:<host>, tauri:<command>, or secret:<key>)` };
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
  // Reject rather than default an unknown surface: a typo'd value should fail
  // at submission, not silently fall back to 'canvas' and render a blank
  // frame the author has no way to diagnose.
  let surface: 'canvas' | 'dom' = 'canvas';
  if (m.surface !== undefined) {
    if (m.surface !== 'canvas' && m.surface !== 'dom') {
      return { ok: false, error: 'surface must be "canvas" or "dom"' };
    }
    surface = m.surface;
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

  let secrets: SecretDecl[] | undefined;
  if (m.secrets !== undefined) {
    if (!Array.isArray(m.secrets)) return { ok: false, error: 'secrets must be an array' };
    if (m.secrets.length > 8) return { ok: false, error: 'too many secrets (max 8)' };
    secrets = [];
    for (const s of m.secrets) {
      if (typeof s !== 'object' || s === null || Array.isArray(s)) {
        return { ok: false, error: 'secrets entries must be objects' };
      }
      const sr = s as Record<string, unknown>;
      if (typeof sr.key !== 'string' || !SECRET_KEY_RE.test(sr.key)) {
        return { ok: false, error: `secret key must be 1-64 chars of [a-z0-9_]: ${JSON.stringify(sr.key)}` };
      }
      if (typeof sr.label !== 'string' || !sr.label.trim()) {
        return { ok: false, error: `secret ${sr.key} requires a label` };
      }
      if (sr.kind !== 'password' && sr.kind !== 'text') {
        return { ok: false, error: `secret ${sr.key} kind must be "password" or "text"` };
      }
      if (sr.help !== undefined && typeof sr.help !== 'string') {
        return { ok: false, error: `secret ${sr.key} help must be a string` };
      }
      secrets.push({ key: sr.key, label: sr.label, kind: sr.kind, help: sr.help as string | undefined });
    }
    // Load-bearing: the install-time confirmation dialog lists `permissions`,
    // so a secret without a matching `secret:<key>` permission would prompt
    // for a credential the user never approved installing.
    for (const decl of secrets) {
      if (!permissions.includes(`secret:${decl.key}`)) {
        return { ok: false, error: `secret ${decl.key} declared but missing matching permission secret:${decl.key}` };
      }
    }
  }

  // Reverse of the rule above, and just as load-bearing: the install dialog
  // renders each `secret:<key>` permission as "this tile needs a credential
  // named <key>", implying an input the tile can fill in. Without a matching
  // `secrets` entry there is no label, no kind, and no input for it — an
  // orphaned prompt for a credential the tile can never actually collect.
  // Must run even when `secrets` is undefined entirely (not nested in the
  // `if (m.secrets !== undefined)` block above).
  for (const p of permissions) {
    if (p.startsWith('secret:')) {
      const key = p.slice(7);
      if (!secrets?.some((decl) => decl.key === key)) {
        return { ok: false, error: `permission secret:${key} declared but missing matching secrets entry` };
      }
    }
  }

  let config: ConfigDecl[] | undefined;
  if (m.config !== undefined) {
    if (!Array.isArray(m.config)) return { ok: false, error: 'config must be an array' };
    if (m.config.length > 8) return { ok: false, error: 'too many config entries (max 8)' };
    config = [];
    for (const c of m.config) {
      if (typeof c !== 'object' || c === null || Array.isArray(c)) {
        return { ok: false, error: 'config entries must be objects' };
      }
      const cr = c as Record<string, unknown>;
      if (typeof cr.key !== 'string' || !cr.key.trim()) {
        return { ok: false, error: 'config entry requires a key' };
      }
      if (typeof cr.label !== 'string' || !cr.label.trim()) {
        return { ok: false, error: `config ${cr.key} requires a label` };
      }
      if (cr.type !== 'text' && cr.type !== 'number') {
        return { ok: false, error: `config ${cr.key} type must be "text" or "number"` };
      }
      config.push({ key: cr.key, label: cr.label, type: cr.type });
    }
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
      secrets,
      config,
      surface,
      // Lenient: anything other than literal true means mono-only, so an old
      // manifest (no field) and a malformed one behave identically.
      stereo: m.stereo === true,
    },
  };
}

// ── postMessage protocol ─────────────────────────────────────────────────────
// Host → sandbox:
//   { type: 'init', code, settings, size, theme, surface }
//   { type: 'frame', spectrum, waveform, bands, onset, level, dt, size, theme, track, playback }
// Sandbox → host:
//   { type: 'ready', token }   (repeated until an 'init' arrives)
//   { type: 'error', message, line }
//   { type: 'settings:set', key, value }
//   { type: 'data', payload }   (both directions; first-party surfaces only —
//                                delivered to viz.on('data') / posted by viz.post)

export const MSG_INIT = 'init';
export const MSG_FRAME = 'frame';
export const MSG_READY = 'ready';
export const MSG_ERROR = 'error';
export const MSG_SETTINGS_SET = 'settings:set';
export const MSG_DATA = 'data';

export interface VizTheme { accent: string; accent2: string }
export interface VizSize { width: number; height: number }
export interface VizTrackInfo { title: string; artist: string }

/** Live playback state. Additive to api 1 — bundles that don't read it are
 *  unaffected. Used by tape/record-style visualizers (cassette, vinyl).
 *
 *  Deliberately NOT the host's `Playback` shape. That type carries GSMTC sync
 *  internals (`positionAtSync` + `syncedAt`) that every consumer must
 *  interpolate to get a usable position; exposing them would make each bundle
 *  reimplement `useLivePos`. The host does the projection once per frame and
 *  hands over a plain answer. */
export interface VizPlayback {
  playing: boolean;
  /** Live position in seconds at this frame, already interpolated. */
  position: number;
  /** Track duration in seconds. 0 when unknown. */
  duration: number;
}

export interface InitMessage {
  type: typeof MSG_INIT;
  code: string;
  settings: Record<string, unknown>;
  size: VizSize;
  theme: VizTheme;
  /** Which surface (canvas or DOM root) the frame should show for this
   *  bundle. The host reads this off the bundle's *validated* manifest — see
   *  validateManifest above, which normalizes an absent field to 'canvas' —
   *  so a bundle that failed validation never reaches sendInit at all. */
  surface: 'canvas' | 'dom';
}

export interface FrameMessage {
  type: typeof MSG_FRAME;
  /** 64 spectrum bins, [0,1]. */
  spectrum: Float32Array;
  /** 1024 time-domain bytes, 0-255 centered 128. */
  waveform: Uint8Array;
  /** Per-channel time domain (0.8.4). Equal for a mono source — including any
   *  per-app capture, which is mixed before it reaches the ring — so a
   *  vectorscope drawn from these correctly shows a vertical line there.
   *  Absent (0.8.7) unless the manifest declared "stereo": true and live
   *  stereo frames have arrived; fall back to `f.waveformL || f.waveform`. */
  waveformL?: Uint8Array;
  waveformR?: Uint8Array;
  bands: { bass: number; mid: number; treble: number };
  onset: { kick: number; snare: number; hat: number };
  level: number;
  /** Seconds since previous frame. */
  dt: number;
  size: VizSize;
  theme: VizTheme;
  track: VizTrackInfo | null;
  playback: VizPlayback | null;
}

/** Re-posted on a short interval until the host answers with `init`, so the
 *  handshake does not depend on a single edge being caught. `token` is the
 *  per-process value the Rust protocol handler stamped into the served
 *  document; the host refuses to init a frame that cannot echo it. */
export interface ReadyMessage { type: typeof MSG_READY; token: string }
export interface ErrorMessage { type: typeof MSG_ERROR; message: string; line: number | null }
export interface SettingsSetMessage { type: typeof MSG_SETTINGS_SET; key: string; value: unknown }
/** Generic first-party payload channel, both directions. Additive to api 1:
 *  bundles that never register viz.on('data') or call viz.post are unaffected.
 *  The host only acts on it when a surface passes an `onData` callback —
 *  installed marketplace bundles get no callback, so their `data` posts go
 *  nowhere. */
export interface DataMessage { type: typeof MSG_DATA; payload: unknown }

export type SandboxToHost = ReadyMessage | ErrorMessage | SettingsSetMessage | DataMessage;

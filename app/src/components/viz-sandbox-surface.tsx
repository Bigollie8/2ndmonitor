import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useAnimateGate, makeSpectrumReader, type VizProps } from './viz';
import { useWaveformRef } from '../state/waveform';
import { paceFrame, type PaceState } from '../state/framePace';
import { SANDBOX_ATTR, SANDBOX_SRC } from '../sandbox/sandbox-html';
import { validateManifest } from '../sandbox/manifest';
import type { InitMessage, SandboxToHost } from '../sandbox/manifest';
import { buildFrameMessage, toVizPlayback } from '../sandbox/frame';
import { makeBrokerHandler, permissionsOf, type RpcRequest } from '../sandbox/broker';

const settingsKey = (id: string) => `scripted.settings.${id}`;

// ── sandbox proof token ─────────────────────────────────────────────────────
// The Rust protocol handler stamps a per-process random token into every copy
// of the sandbox document it serves; the frame echoes it in `ready`. A frame
// that cannot echo it is never treated as ours: it is not inited (so no bundle
// source code is posted to it) and — because the check gates the WHOLE message
// dispatch in `onMessage` below, not just the `ready` branch — none of its
// `rpc`, `settings:set` or `error` messages are acted on either.
//
// That last clause is load-bearing and was not true until 2026-07-31: the check
// used to sit *inside* the `ready` branch, below the `rpc` and `settings:set`
// branches, so an unproven frame could still drive both. See the long comment
// on the guard in `onMessage`.
//
// It closes a fail-OPEN case in the delivery path: wry only intercepts
// sub-frame custom-protocol requests when ICoreWebView2_22 is present
// (wry-0.54.4 src/webview2/mod.rs:941-950). Without it the request escapes to
// the network, Chromium resolves *.localhost to loopback, and any server on
// 127.0.0.1:80 answers with a document that passes both the contentWindow
// identity check and the opaque-origin check while carrying none of the
// sandbox CSP. A local server cannot know the token.
//
// Process-wide, not per component: one IPC round trip serves every surface,
// including the six-ish catalog previews that mount at once.
let sandboxToken: string | null = null;
let sandboxTokenLoad: Promise<void> | null = null;
function loadSandboxToken(): Promise<void> {
  if (!sandboxTokenLoad) {
    sandboxTokenLoad = (async () => {
      const { invoke } = await import('@tauri-apps/api/core');
      sandboxToken = await invoke<string>('sandbox_token');
    })().catch(() => {
      // Fail closed: no token, no init. Clear the memo so the NEXT caller
      // starts a fresh attempt rather than pinning the failure for the life of
      // the process. The retry driver is the frame's own `ready` ping loop (see
      // onMessage) — before that, a single transient failure inside one mount
      // was never retried and left a permanently black surface with no banner,
      // because the token-mismatch path is a silent `return`.
      sandboxTokenLoad = null;
    });
  }
  return sandboxTokenLoad;
}

/** How many token-less `ready` pings to absorb before telling the user. The
 *  frame re-posts `ready` every 250ms and gives up after 60 tries
 *  (sandbox/sandbox-html.ts), so this is ~10s of silent retrying inside its
 *  ~15s budget: long enough that a cold-start `invoke('sandbox_token')` — one
 *  IPC round trip behind a dynamic import — never trips it, short enough that
 *  the frame has not yet stopped pinging when the banner appears. */
const READY_TOKEN_GRACE_PINGS = 40;

export type ScriptError = { message: string; line: number | null } | null;

/** The no-capability iframe runtime shared by every sandboxed visualizer:
 *  the "Scripted" authoring surface (which wraps this with a picker/editor/
 *  reload chrome — see viz-scripted.tsx) and installed marketplace `bundle:`
 *  styles (which mount this directly, so an installed visualizer looks like
 *  any other built-in style, not like an editor).
 *
 *  Each visualizer runs inside sandbox="allow-scripts" + CSP default-src
 *  'none'; the only channel is postMessage. See src/sandbox/ for the
 *  runtime and protocol.
 *
 *  This component owns: loading a bundle's code, running it in the iframe,
 *  pumping frames and surfacing errors. It does not own the folder list,
 *  the picker, the editor or `scripted.active` — those are the authoring
 *  surface's concern. */
export function SandboxVizSurface({
  bundleId, accent, accent2, spectrumRef, sensitivity = 1, smoothing = 0, autoGain = false,
  paused, track, playback, reloadKey, suppressErrorBanner, onError, maxFps,
  localSource, onData, dataSenderRef,
}: VizProps & {
  bundleId: string | null;
  // Deliberately no `chrome` flag: this component renders only the iframe
  // and its error banner, full stop — there is no authoring UI here to gate.
  // Picker/editor/reload markup lives in the caller (ScriptedSurface) and is
  // simply never rendered around the chromeless `bundle:` dispatch case. A
  // boolean here would invite someone to believe passing `chrome={true}`
  // turns something on inside this component; it wouldn't, so don't add one.
  /** Bump to force a fresh code load + re-init for the current `bundleId`
   *  without remounting the iframe. Drives both the authoring surface's
   *  manual "reload" button and the `visualizers:changed` hot-reload signal. */
  reloadKey?: number;
  /** True while the authoring editor is already showing this error inline —
   *  hides the floating banner so the error isn't shown twice. */
  suppressErrorBanner?: boolean;
  /** Mirrors this surface's error state to the caller; the authoring editor
   *  needs it for its own inline `liveError` display. */
  onError?: (error: ScriptError) => void;
  /** Per-instance frame-rate ceiling, independent of the global `vizMaxFps`
   *  the Performance setting controls (which `useAnimateGate`'s `shouldDraw`
   *  already applies to every surface, including this one). Undefined means
   *  "no additional cap" — the hero surface and the Scripted authoring editor
   *  both omit this, so their behavior is unchanged. Catalog-card live
   *  previews (`LivePreview.tsx`) pass a low value here: many of these can be
   *  mounted at once, so each one needs its own reduced budget on top of
   *  (not instead of) the global cap — a single shared module flag would
   *  throttle the main hero surface too, which is not the goal. */
  maxFps?: number;
  /** First-party code to run instead of an installed bundle. When set, the
   *  surface skips visualizers_read and manifest validation entirely and grants
   *  NO broker permissions. MUST be a module-scope constant (stable identity). */
  localSource?: { code: string; surface?: 'canvas' | 'dom' };
  /** Payloads the frame sends via viz.post. Only honoured after the frame has
   *  proven itself (readyRef) — same gate as every other message. */
  onData?: (payload: unknown) => void;
  /** Receives a stable sender for host→frame data payloads. Returns false while
   *  the frame is not ready. Cleared to null on unmount. */
  dataSenderRef?: React.MutableRefObject<((payload: unknown) => boolean) | null>;
}) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const waveRef = useWaveformRef();
  // Label the perf-debug draw-rate bucket with the concrete bundle (or the
  // authoring surface's fixed id) rather than a hardcoded 'scripted' — all 12
  // installed bundle styles otherwise collapse into a single indistinguishable
  // bucket in the perf HUD.
  const gate = useAnimateGate(paused, bundleId ? `scripted:${bundleId}` : 'scripted');

  const [scriptError, setScriptErrorState] = useState<ScriptError>(null);
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  const setScriptError = useCallback((e: ScriptError) => {
    setScriptErrorState(e);
    onErrorRef.current?.(e);
  }, []);
  const onDataRef = useRef(onData);
  onDataRef.current = onData;
  // Read via ref inside the [bundleId, reloadKey] effect: localSource is
  // documented as a module-scope constant, so it never *changes* — the ref
  // only dodges an exhaustive-deps entry that would re-init on every render
  // if a caller ignored the stability requirement.
  const localSourceRef = useRef(localSource);
  localSourceRef.current = localSource;

  const readyRef = useRef(false);
  /** Count of `ready` pings dropped because the frame could not prove itself.
   *  Drives the give-up banner; reset whenever a fresh load starts. */
  const unprovenReadyRef = useRef(0);
  // MUST be a stable callback, not an inline arrow. An inline arrow is a new
  // function identity every render, so React detaches it (calls it with null)
  // and re-attaches it on EVERY re-render — and each of those calls sees
  // `iframeRef.current !== el` and clears readyRef. The frame pump and
  // sendInit both bail on `!readyRef.current`, so the surface rendered for
  // roughly one render cycle after `ready` and then froze, and a `reloadKey`
  // bump (the manual reload button and the `visualizers:changed` hot-reload
  // signal) could NEVER re-init: bumping reloadKey re-renders first, which
  // cleared readyRef before the effect got to call sendInit.
  //
  // Pre-existing, not introduced by the srcdoc→src move: verified by running
  // the pre-change srcdoc build in `tauri dev` and observing the identical
  // dead pump (zero messages reaching the frame). It bit the Scripted
  // authoring surface hardest because ScriptedSurface re-renders often
  // (folder list, picker, editor, error state); `bundle:` styles re-render
  // rarely, which is why those animated even before this fix.
  //
  // A stable callback still resets readyRef on a genuine remount: `key` is
  // bundleId, so switching bundles mounts a NEW iframe element and React
  // calls this with null then the new element — `iframeRef.current !== el`
  // still holds exactly when it should.
  const attachIframe = useCallback((el: HTMLIFrameElement | null) => {
    if (iframeRef.current !== el) readyRef.current = false;
    iframeRef.current = el;
  }, []);
  const codeRef = useRef<string>('');
  const brokerRef = useRef<ReturnType<typeof makeBrokerHandler> | null>(null);
  // Surface for the bundle currently loaded, off its *validated* manifest
  // (see the try block below) — never the raw JSON. A manifest that fails
  // validation short-circuits before codeRef is populated, so sendInit never
  // fires for it; this ref cannot carry an unvalidated value into `init`.
  const surfaceRef = useRef<'canvas' | 'dom'>('canvas');
  const themeRef = useRef({ accent, accent2 });
  themeRef.current = { accent, accent2 };
  const trackRef = useRef(track ?? null);
  trackRef.current = track ?? null;
  const playbackRef = useRef(playback ?? null);
  playbackRef.current = playback ?? null;

  // Load active visualizer source + init the sandbox when ready. Re-runs on
  // `reloadKey` bumps (manual reload / hot-reload) without remounting the
  // iframe — the iframe only remounts via its `key={bundleId}` below.
  useEffect(() => {
    if (!bundleId) return;
    let cancelled = false;
    // Start the token round trip in parallel with the frame's own document
    // load; `ready` is re-posted until we can act on it, so whichever wins is
    // fine. Memoised process-wide, so N mounted surfaces cost one invoke.
    void loadSandboxToken();
    unprovenReadyRef.current = 0;
    setScriptError(null); // clear any stale banner immediately on switch/reload
    // Clear stale code/broker BEFORE the async read below. The iframe remounts
    // (key={bundleId}) and its inline script posts `ready` almost immediately —
    // often before `invoke('visualizers_read')` resolves — so if the old
    // bundle's code/broker were still sitting in the refs, `ready`'s call to
    // sendInit() would init the NEW iframe with the OLD bundle's code while
    // sendInit's closure already has the new bundleId. That produces a
    // visible wrong-style flash, can write a `settings:set` from the old
    // bundle's module body under the new bundle's settings key, and can leave
    // the old bundle's interval brokered under the new bundle's permissions.
    // Do not delete this as "redundant" — it is the fix for that race.
    codeRef.current = '';
    brokerRef.current = null;
    surfaceRef.current = 'canvas';
    const local = localSourceRef.current;
    if (local) {
      // First-party code shipped inside the app bundle: nothing to read over
      // IPC, nothing to validate, and — deliberately — nothing brokered.
      brokerRef.current = null;
      surfaceRef.current = local.surface ?? 'canvas';
      codeRef.current = local.code;
      sendInit();
      return () => { cancelled = true; };
    }
    (async () => {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        const src = await invoke<{ manifest: string; code: string }>('visualizers_read', { id: bundleId });
        if (cancelled) return;
        let manifestErr: string | null = null;
        try {
          // allowPermissions: installed marketplace bundles may carry vetted
          // permissions; locally-authored ones still declare none.
          const v = validateManifest(JSON.parse(src.manifest), { allowPermissions: true });
          if (!v.ok) {
            manifestErr = v.error;
          } else {
            surfaceRef.current = v.manifest.surface ?? 'canvas';
            brokerRef.current = makeBrokerHandler(permissionsOf(v.manifest.permissions), {
              fetch: async (url) => {
                const { invoke } = await import('@tauri-apps/api/core');
                return invoke('broker_fetch', { url });
              },
              invoke: async (command, args) => {
                const { invoke } = await import('@tauri-apps/api/core');
                return invoke(command, args as Record<string, unknown> | undefined);
              },
            });
          }
        } catch {
          manifestErr = 'manifest.json is not valid JSON';
        }
        if (manifestErr) {
          setScriptError({ message: `manifest: ${manifestErr}`, line: null });
          return;
        }
        setScriptError(null);
        codeRef.current = src.code;
        sendInit();
      } catch (e) {
        if (!cancelled) setScriptError({ message: String(e), line: null });
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bundleId, reloadKey]);

  const sendInit = useCallback(() => {
    const win = iframeRef.current?.contentWindow;
    if (!win || !readyRef.current || !codeRef.current || !bundleId || !hostRef.current) return;
    let settings: Record<string, unknown> = {};
    try {
      settings = JSON.parse(localStorage.getItem(settingsKey(bundleId)) ?? '{}');
    } catch { /* fresh */ }
    const rect = hostRef.current.getBoundingClientRect();
    const msg: InitMessage = {
      type: 'init',
      code: codeRef.current,
      settings,
      size: { width: Math.round(rect.width), height: Math.round(rect.height) },
      theme: themeRef.current,
      surface: surfaceRef.current,
    };
    win.postMessage(msg, '*');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bundleId]);

  // Host→frame payload channel for first-party surfaces (see localSource).
  useEffect(() => {
    if (!dataSenderRef) return;
    dataSenderRef.current = (payload: unknown) => {
      const win = iframeRef.current?.contentWindow;
      if (!win || !readyRef.current) return false;
      win.postMessage({ type: 'data', payload }, '*');
      return true;
    };
    return () => { dataSenderRef.current = null; };
  }, [dataSenderRef]);

  // Sandbox → host messages.
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      // Identity check against the live frame's own window: strictly stronger
      // than an origin string comparison, and unaffected by the srcdoc→src
      // move. Note the frame is still `sandbox="allow-scripts"` with no
      // allow-same-origin, so it has an opaque origin and `e.origin` is the
      // literal "null" — NOT the SANDBOX_ORIGIN the document was fetched from
      // (verified in the packaged build, see task-7b report). The extra
      // e.origin assertion below therefore doubles as a tripwire: if anyone
      // ever adds allow-same-origin, the frame gains a real origin, this
      // check starts rejecting, and the surface fails loudly instead of
      // quietly running visualizer code with storage and IPC reachable.
      if (e.source !== iframeRef.current?.contentWindow) return;
      if (e.origin !== 'null') return;
      const msg = e.data as SandboxToHost | { type: 'rpc'; rpcId: number; rpc: RpcRequest['rpc']; url?: string; command?: string; args?: unknown };

      // ── the token gate, ABOVE the whole dispatch ──────────────────────────
      // `ready` is the only message that carries the token, so "prove the
      // frame" and "accept anything from it" are one decision: nothing but
      // `ready` is honoured until a token-matching `ready` has set readyRef.
      //
      // This check used to live inside the `ready` branch, *below* the `rpc`
      // and `settings:set` branches. In the exact fail-open case the token
      // exists to close — a foreign document answering at
      // http://vizsandbox.localhost because an old WebView2 did not intercept
      // the sub-frame request — that document passes both the `e.source` and
      // `e.origin` checks above, and could therefore still:
      //   * post `settings:set` → arbitrary writes into
      //     localStorage['scripted.settings.<bundleId>'], later handed to the
      //     real bundle as `init.settings`; and
      //   * post `rpc` → brokerRef is populated by an async effect
      //     independently of readyRef, so a never-inited frame reached the
      //     broker. `tauri.invoke` stays dead while BROKER_COMMANDS is `{}`,
      //     but `net.fetch` to manifest-allowlisted hosts was live.
      // Do not move this back down, and do not add a message type above it.
      if (msg?.type === 'ready') {
        if (!sandboxToken || (msg as { token?: unknown }).token !== sandboxToken) {
          // No token yet means the invoke has not landed — or failed, in which
          // case loadSandboxToken has already cleared its memo. Kick it again:
          // the frame's own 250ms ping loop is the retry driver, so a transient
          // failure costs a ping rather than the surface. A token that is
          // present but does not match is the attack this whole mechanism is
          // for; retrying would not help, but the ping counter still runs out
          // and says so instead of leaving a silent black rectangle.
          if (!sandboxToken) void loadSandboxToken();
          if (++unprovenReadyRef.current === READY_TOKEN_GRACE_PINGS) {
            setScriptError({
              message: 'sandbox handshake failed: the frame could not prove it was served by the app',
              line: null,
            });
          }
          return;
        }
        readyRef.current = true;
        // A token that lands AFTER the grace window has already painted the
        // handshake banner, and the only other `setScriptError(null)` lives in
        // the [bundleId, reloadKey] effect, which ran long ago — so without
        // this the visualizer animates behind a stale "handshake failed".
        // Guarded on the counter rather than clearing unconditionally: a
        // genuine script error can only arrive after `init`, but the frame may
        // still have one ping in flight at that point, and a bare clear here
        // would wipe it.
        if (unprovenReadyRef.current >= READY_TOKEN_GRACE_PINGS) setScriptError(null);
        unprovenReadyRef.current = 0;
        sendInit();
        return;
      }
      // Every other message type requires a frame that already proved itself.
      if (!readyRef.current) return;

      if (msg?.type === 'rpc') {
        // Broker-mediated capability request from an installed bundle.
        const win = iframeRef.current?.contentWindow;
        const handler = brokerRef.current;
        const reply = (r: { ok: true; value: unknown } | { ok: false; error: string }) =>
          win?.postMessage({ type: 'rpc:result', rpcId: msg.rpcId, ...r }, '*');
        if (!handler) { reply({ ok: false, error: 'no permissions granted' }); return; }
        void handler({ rpc: msg.rpc, url: msg.url, command: msg.command, args: msg.args }).then(reply);
      } else if (msg?.type === 'error') {
        setScriptError({ message: msg.message, line: msg.line });
      } else if (msg?.type === 'settings:set' && bundleId) {
        try {
          const cur = JSON.parse(localStorage.getItem(settingsKey(bundleId)) ?? '{}');
          cur[msg.key] = msg.value;
          localStorage.setItem(settingsKey(bundleId), JSON.stringify(cur));
        } catch { /* ignore corrupt settings */ }
      } else if (msg?.type === 'data') {
        onDataRef.current?.((msg as { payload?: unknown }).payload);
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bundleId, sendInit]);

  // Frame pump.
  useEffect(() => {
    const reader = makeSpectrumReader(64, spectrumRef, sensitivity, smoothing, autoGain);
    let raf = 0;
    let last = performance.now();
    const paceState: PaceState = { nextDue: 0 };
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const win = iframeRef.current?.contentWindow;
      if (!win || !readyRef.current || !hostRef.current) return;
      if (!gate.shouldDraw()) return;
      const now = performance.now();
      // Per-instance reduced budget (e.g. card previews), on top of — not
      // instead of — the global cap `gate.shouldDraw()` already applied.
      if (maxFps && !paceFrame(now, paceState, 1000 / maxFps)) return;
      const dtMs = now - last;
      last = now;
      reader.read();
      const rect = hostRef.current.getBoundingClientRect();
      const msg = buildFrameMessage({
        spectrum: reader.out,
        waveform: waveRef.current.mono,
        waveformL: waveRef.current.left,
        waveformR: waveRef.current.right,
        bands: reader.bands,
        onset: reader.onset,
        level: spectrumRef?.current.level ?? 0,
        dtMs,
        size: { width: Math.round(rect.width), height: Math.round(rect.height) },
        theme: themeRef.current,
        track: trackRef.current ? { title: trackRef.current.title, artist: trackRef.current.artist } : null,
        playback: toVizPlayback(playbackRef.current, now),
      });
      win.postMessage(msg, '*');
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // bundleId is a dep so `gate` (whose perf-debug label is derived from it)
    // is re-captured by this closure on every bundle switch, not just at mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spectrumRef, sensitivity, smoothing, autoGain, bundleId, maxFps]);

  return (
    <div ref={hostRef} style={{ position: 'absolute', inset: 0, background: '#000', overflow: 'hidden' }}>
      {bundleId && (
        <iframe
          key={bundleId}
          ref={attachIframe}
          // `src`, NOT `srcDoc`: a srcdoc frame inherits the embedder's CSP
          // policy container and the two policies intersect, so in a packaged
          // build (where Tauri injects script-src 'self') the sandbox's own
          // 'unsafe-inline'/'unsafe-eval' were cancelled out and the runtime
          // shim never ran. A fetched document carries only its own policy.
          // `sandbox="allow-scripts"` (no allow-same-origin) still applies to
          // a real URL, so the frame remains an opaque origin. See
          // src/sandbox/sandbox-html.ts and src-tauri/src/sandbox.rs.
          sandbox={SANDBOX_ATTR}
          src={SANDBOX_SRC}
          title="scripted visualizer"
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', border: 0, background: '#000' }}
        />
      )}

      {scriptError && !suppressErrorBanner && (
        <div style={{
          position: 'absolute', left: 10, right: 10, top: 10, padding: '8px 12px',
          background: 'rgba(40,8,10,0.9)', border: '1px solid rgba(255,80,80,0.4)', borderRadius: 8,
          fontSize: 11, color: 'rgba(255,180,180,0.95)', fontFamily: '"JetBrains Mono", ui-monospace, monospace',
          display: 'flex', gap: 10, alignItems: 'baseline',
          // Must paint above a first-party host's pointer shield (viz-milkdrop.tsx's
          // `data-pointer-shield` sits at zIndex 1) or the ✕ below is visible but
          // unclickable. Milkdrop chrome is 2, the Scripted picker overlay is 5.
          zIndex: 3,
        }}>
          <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {scriptError.line != null ? `line ${scriptError.line}: ` : ''}{scriptError.message}
          </span>
          <span style={{ cursor: 'pointer', opacity: 0.7 }} onClick={() => setScriptError(null)}>✕</span>
        </div>
      )}
    </div>
  );
}

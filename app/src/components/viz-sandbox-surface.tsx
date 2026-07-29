import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useAnimateGate, makeSpectrumReader, type VizProps } from './viz';
import { useWaveformRef } from '../state/waveform';
import { buildSandboxHtml, SANDBOX_ATTR } from '../sandbox/sandbox-html';
import { validateManifest } from '../sandbox/manifest';
import type { InitMessage, SandboxToHost } from '../sandbox/manifest';
import { buildFrameMessage, toVizPlayback } from '../sandbox/frame';
import { makeBrokerHandler, permissionsOf, type RpcRequest } from '../sandbox/broker';

const settingsKey = (id: string) => `scripted.settings.${id}`;

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
  bundleId, accent, accent2, spectrumRef, sensitivity = 1, smoothing = 0,
  paused, track, playback, reloadKey, suppressErrorBanner, onError,
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
}) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const waveRef = useWaveformRef();
  const gate = useAnimateGate(paused, 'scripted');

  const [scriptError, setScriptErrorState] = useState<ScriptError>(null);
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  const setScriptError = useCallback((e: ScriptError) => {
    setScriptErrorState(e);
    onErrorRef.current?.(e);
  }, []);

  const readyRef = useRef(false);
  const codeRef = useRef<string>('');
  const brokerRef = useRef<ReturnType<typeof makeBrokerHandler> | null>(null);
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
    setScriptError(null); // clear any stale banner immediately on switch/reload
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
          if (!v.ok) manifestErr = v.error;
          else brokerRef.current = makeBrokerHandler(permissionsOf(v.manifest.permissions), {
            fetch: async (url) => {
              const { invoke } = await import('@tauri-apps/api/core');
              return invoke('broker_fetch', { url });
            },
            invoke: async (command, args) => {
              const { invoke } = await import('@tauri-apps/api/core');
              return invoke(command, args as Record<string, unknown> | undefined);
            },
          });
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
    };
    win.postMessage(msg, '*');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bundleId]);

  // Sandbox → host messages.
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.source !== iframeRef.current?.contentWindow) return;
      const msg = e.data as SandboxToHost | { type: 'rpc'; rpcId: number; rpc: RpcRequest['rpc']; url?: string; command?: string; args?: unknown };
      if (msg?.type === 'rpc') {
        // Broker-mediated capability request from an installed bundle.
        const win = iframeRef.current?.contentWindow;
        const handler = brokerRef.current;
        const reply = (r: { ok: true; value: unknown } | { ok: false; error: string }) =>
          win?.postMessage({ type: 'rpc:result', rpcId: msg.rpcId, ...r }, '*');
        if (!handler) { reply({ ok: false, error: 'no permissions granted' }); return; }
        void handler({ rpc: msg.rpc, url: msg.url, command: msg.command, args: msg.args }).then(reply);
        return;
      }
      if (msg?.type === 'ready') {
        readyRef.current = true;
        sendInit();
      } else if (msg?.type === 'error') {
        setScriptError({ message: msg.message, line: msg.line });
      } else if (msg?.type === 'settings:set' && bundleId) {
        try {
          const cur = JSON.parse(localStorage.getItem(settingsKey(bundleId)) ?? '{}');
          cur[msg.key] = msg.value;
          localStorage.setItem(settingsKey(bundleId), JSON.stringify(cur));
        } catch { /* ignore corrupt settings */ }
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bundleId, sendInit]);

  // Frame pump.
  useEffect(() => {
    const reader = makeSpectrumReader(64, spectrumRef, sensitivity, smoothing);
    let raf = 0;
    let last = performance.now();
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const win = iframeRef.current?.contentWindow;
      if (!win || !readyRef.current || !hostRef.current) return;
      if (!gate.shouldDraw()) return;
      const now = performance.now();
      const dtMs = now - last;
      last = now;
      reader.read();
      const rect = hostRef.current.getBoundingClientRect();
      const msg = buildFrameMessage({
        spectrum: reader.out,
        waveform: waveRef.current.mono,
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spectrumRef, sensitivity, smoothing]);

  return (
    <div ref={hostRef} style={{ position: 'absolute', inset: 0, background: '#000', overflow: 'hidden' }}>
      {bundleId && (
        <iframe
          key={bundleId}
          ref={(el) => {
            if (iframeRef.current !== el) readyRef.current = false;
            iframeRef.current = el;
          }}
          sandbox={SANDBOX_ATTR}
          srcDoc={buildSandboxHtml()}
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

import React, { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useAnimateGate, makeSpectrumReader, type VizProps } from './viz';
import { useWaveformRef } from '../state/waveform';
import { buildSandboxHtml, SANDBOX_ATTR } from '../sandbox/sandbox-html';
import { validateManifest } from '../sandbox/manifest';
import type { FrameMessage, InitMessage, SandboxToHost } from '../sandbox/manifest';
import { makeBrokerHandler, permissionsOf, type RpcRequest } from '../sandbox/broker';
import { newVizManifest, NEW_VIZ_CODE } from '../sandbox/template';

const VizEditor = lazy(() => import('./viz-editor').then((m) => ({ default: m.VizEditor })));

interface VizFolder {
  id: string;
  name: string;
  author: string | null;
  version: string;
  api: number | null;
  manifest_error: string | null;
}

const LS_ACTIVE = 'scripted.active';
const settingsKey = (id: string) => `scripted.settings.${id}`;

/** Host for user-coded visualizers. Each runs inside a no-capability iframe
 *  (sandbox="allow-scripts" + CSP default-src 'none'); the only channel is
 *  postMessage. See src/sandbox/ for the runtime and protocol. */
export function VizScripted(props: VizProps) {
  if (props.preview) return <ScriptedPreviewCard accent={props.accent} accent2={props.accent2} />;
  return <ScriptedSurface {...props} />;
}

function ScriptedSurface({ accent, accent2, spectrumRef, sensitivity = 1, smoothing = 0, paused, track }: VizProps) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const waveRef = useWaveformRef();
  const gate = useAnimateGate(paused, 'scripted');

  const [folders, setFolders] = useState<VizFolder[]>([]);
  const [activeId, setActiveId] = useState<string | null>(() => localStorage.getItem(LS_ACTIVE));
  const [scriptError, setScriptError] = useState<{ message: string; line: number | null } | null>(null);
  const [hovered, setHovered] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [loadNonce, setLoadNonce] = useState(0);

  const readyRef = useRef(false);
  const codeRef = useRef<string>('');
  const brokerRef = useRef<ReturnType<typeof makeBrokerHandler> | null>(null);
  const themeRef = useRef({ accent, accent2 });
  themeRef.current = { accent, accent2 };
  const trackRef = useRef(track ?? null);
  trackRef.current = track ?? null;

  const refreshList = useCallback(async () => {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const list = await invoke<VizFolder[]>('visualizers_list');
      setFolders(list);
      return list;
    } catch {
      setFolders([]);
      return [];
    }
  }, []);

  // List load + hot-reload subscription.
  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    void refreshList();
    import('@tauri-apps/api/event')
      .then(({ listen }) =>
        listen('visualizers:changed', () => {
          if (cancelled) return;
          void refreshList();
          setLoadNonce((n) => n + 1); // re-init the active iframe with fresh code
        }),
      )
      .then((un) => { if (cancelled) un?.(); else unlisten = un; })
      .catch(() => {});
    return () => { cancelled = true; unlisten?.(); };
  }, [refreshList]);

  // Load active visualizer source + init the sandbox when ready.
  useEffect(() => {
    if (!activeId) return;
    let cancelled = false;
    (async () => {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        const src = await invoke<{ manifest: string; code: string }>('visualizers_read', { id: activeId });
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
  }, [activeId, loadNonce]);

  const sendInit = useCallback(() => {
    const win = iframeRef.current?.contentWindow;
    if (!win || !readyRef.current || !codeRef.current || !activeId || !hostRef.current) return;
    let settings: Record<string, unknown> = {};
    try {
      settings = JSON.parse(localStorage.getItem(settingsKey(activeId)) ?? '{}');
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
  }, [activeId]);

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
      } else if (msg?.type === 'settings:set' && activeId) {
        try {
          const cur = JSON.parse(localStorage.getItem(settingsKey(activeId)) ?? '{}');
          cur[msg.key] = msg.value;
          localStorage.setItem(settingsKey(activeId), JSON.stringify(cur));
        } catch { /* ignore corrupt settings */ }
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [activeId, sendInit]);

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
      const dt = Math.min(0.25, (now - last) / 1000);
      last = now;
      reader.read();
      const rect = hostRef.current.getBoundingClientRect();
      const msg: FrameMessage = {
        type: 'frame',
        spectrum: reader.out,
        waveform: waveRef.current.mono,
        bands: reader.bands,
        onset: reader.onset,
        level: spectrumRef?.current.level ?? 0,
        dt,
        size: { width: Math.round(rect.width), height: Math.round(rect.height) },
        theme: themeRef.current,
        track: trackRef.current ? { title: trackRef.current.title, artist: trackRef.current.artist } : null,
      };
      win.postMessage(msg, '*');
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spectrumRef, sensitivity, smoothing]);

  const createNew = useCallback(async () => {
    const list = await refreshList();
    let id = 'my-first-viz';
    let n = 1;
    while (list.some((f) => f.id === id)) id = `my-viz-${++n}`;
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('visualizers_write', { id, manifest: newVizManifest(id), code: NEW_VIZ_CODE });
      await refreshList();
      localStorage.setItem(LS_ACTIVE, id);
      setActiveId(id);
      setEditorOpen(true);
    } catch (e) {
      setScriptError({ message: String(e), line: null });
    }
  }, [refreshList]);

  const active = folders.find((f) => f.id === activeId) ?? null;
  const chip: React.CSSProperties = {
    padding: '4px 9px', fontSize: 12, lineHeight: 1, cursor: 'pointer',
    background: 'rgba(0,0,0,0.55)', color: 'rgba(255,255,255,0.85)',
    border: '1px solid rgba(255,255,255,0.12)', borderRadius: 8,
  };

  return (
    <div
      ref={hostRef}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{ position: 'absolute', inset: 0, background: '#000', overflow: 'hidden' }}
    >
      {activeId ? (
        <iframe
          key={`${activeId}`}
          ref={(el) => {
            if (iframeRef.current !== el) readyRef.current = false;
            iframeRef.current = el;
          }}
          sandbox={SANDBOX_ATTR}
          srcDoc={buildSandboxHtml()}
          title="scripted visualizer"
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', border: 0, background: '#000' }}
        />
      ) : (
        <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', padding: 20 }}>
          <div style={{ textAlign: 'center', maxWidth: 420 }}>
            <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>Code your own visualizer</div>
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.55)', lineHeight: 1.6, marginBottom: 14 }}>
              Drop a folder in <code style={{ fontSize: 11 }}>%APPDATA%\com.secondmonitor.hub\visualizers\</code> (manifest.json + main.js),
              or start from the built-in template. Scripts run sandboxed — audio data in, pixels out, nothing else.
            </div>
            <button onClick={createNew} style={{ ...chip, padding: '8px 14px', color: accent, borderColor: `${accent}55` }}>
              + New visualizer
            </button>
          </div>
        </div>
      )}

      {active && (
        <div style={{
          position: 'absolute', left: 10, bottom: 8, fontSize: 10,
          color: 'rgba(255,255,255,0.45)', fontFamily: '"JetBrains Mono", ui-monospace, monospace',
          maxWidth: '55%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          pointerEvents: 'none',
        }}>{active.name} · v{active.version || '?'}</div>
      )}

      <div style={{
        position: 'absolute', right: 10, bottom: 8, display: 'flex', gap: 6,
        opacity: hovered || pickerOpen || editorOpen ? 1 : 0, transition: 'opacity 160ms ease',
        pointerEvents: hovered || pickerOpen || editorOpen ? 'auto' : 'none',
      }}>
        <button style={chip} title="Pick visualizer" onClick={() => setPickerOpen((o) => !o)}>
          {active ? `${active.name} ▾` : 'Pick ▾'}
        </button>
        {active && <button style={chip} title="Edit code" onClick={() => setEditorOpen(true)}>✎</button>}
        {active && <button style={chip} title="Reload" onClick={() => { setScriptError(null); setLoadNonce((n) => n + 1); }}>↻</button>}
      </div>

      {pickerOpen && (
        <div onClick={() => setPickerOpen(false)} style={{ position: 'absolute', inset: 0, zIndex: 5 }}>
          <div onClick={(e) => e.stopPropagation()} style={{
            position: 'absolute', right: 10, bottom: 40, width: 280, maxHeight: '70%', overflowY: 'auto',
            background: 'rgba(10,11,16,0.96)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10,
            boxShadow: '0 16px 48px rgba(0,0,0,0.6)',
          }}>
            {folders.map((f) => (
              <div
                key={f.id}
                title={f.manifest_error ?? f.name}
                onClick={() => {
                  if (f.manifest_error) return;
                  localStorage.setItem(LS_ACTIVE, f.id);
                  setScriptError(null);
                  setActiveId(f.id);
                  setPickerOpen(false);
                }}
                style={{
                  padding: '6px 12px', fontSize: 12, cursor: f.manifest_error ? 'default' : 'pointer',
                  color: f.manifest_error ? 'rgba(255,255,255,0.35)' : f.id === activeId ? accent : 'rgba(255,255,255,0.8)',
                  background: f.id === activeId ? 'rgba(255,255,255,0.06)' : 'transparent',
                }}
              >{f.manifest_error ? '⚠ ' : ''}{f.name} <span style={{ opacity: 0.5 }}>· {f.id}</span></div>
            ))}
            <div
              onClick={() => { setPickerOpen(false); void createNew(); }}
              style={{ padding: '8px 12px', fontSize: 12, cursor: 'pointer', color: accent, borderTop: '1px solid rgba(255,255,255,0.06)' }}
            >+ New visualizer</div>
          </div>
        </div>
      )}

      {scriptError && !editorOpen && (
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

      {editorOpen && activeId && (
        <Suspense fallback={null}>
          <VizEditor
            id={activeId}
            accent={accent}
            liveError={scriptError}
            onClose={() => setEditorOpen(false)}
          />
        </Suspense>
      )}
    </div>
  );
}

function ScriptedPreviewCard({ accent, accent2 }: { accent: string; accent2: string }) {
  return (
    <div style={{
      position: 'absolute', inset: 0, display: 'grid', placeItems: 'center',
      background: `linear-gradient(135deg, ${accent}22, transparent 55%), linear-gradient(315deg, ${accent2}22, transparent 55%), #000`,
    }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 20, fontWeight: 700, letterSpacing: '-0.02em', fontFamily: '"JetBrains Mono", ui-monospace, monospace' }}>
          {'{ scripted }'}
        </div>
        <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.45)', marginTop: 4 }}>
          Your JS visualizers · sandboxed · hot reload
        </div>
      </div>
    </div>
  );
}

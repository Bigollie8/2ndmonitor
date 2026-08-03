import React, { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import type { VizProps } from './viz';
import { SandboxVizSurface, type ScriptError } from './viz-sandbox-surface';
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

/** Authoring host for user-coded visualizers: owns `scripted.active`, the
 *  folder list, the picker, the code editor and the reload button. The
 *  iframe lifecycle itself (load code, run it sandboxed, pump frames,
 *  surface errors) lives in `SandboxVizSurface` — the same runtime that
 *  installed marketplace `bundle:` styles use directly, chromeless. See
 *  src/sandbox/ for the runtime and protocol. */
export function VizScripted(props: VizProps) {
  if (props.preview) return <ScriptedPreviewCard accent={props.accent} accent2={props.accent2} />;
  return <ScriptedSurface {...props} />;
}

function ScriptedSurface(props: VizProps) {
  const { accent } = props;
  const [folders, setFolders] = useState<VizFolder[]>([]);
  const [activeId, setActiveId] = useState<string | null>(() => localStorage.getItem(LS_ACTIVE));
  const [scriptError, setScriptError] = useState<ScriptError>(null);
  const [hovered, setHovered] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [loadNonce, setLoadNonce] = useState(0);

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
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}
    >
      <SandboxVizSurface
        {...props}
        bundleId={activeId}
        reloadKey={loadNonce}
        suppressErrorBanner={editorOpen}
        onError={setScriptError}
      />

      {!activeId && (
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
            background: 'var(--surface-overlay, rgba(10,11,16,0.96))', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10,
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

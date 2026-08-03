import { useEffect, useRef, useState } from 'react';
import { EditorView, basicSetup } from 'codemirror';
import { keymap } from '@codemirror/view';
import { javascript } from '@codemirror/lang-javascript';
import { oneDark } from '@codemirror/theme-one-dark';

/** In-app code editor for a scripted visualizer's main.js. Saving writes via
 *  the Rust store; the folder watcher then hot-reloads the running iframe, so
 *  the tile behind this overlay doubles as the live preview. Lazy-loaded —
 *  CodeMirror stays out of the boot bundle. */
export function VizEditor({ id, accent, liveError, onClose }: {
  id: string;
  accent: string;
  liveError: { message: string; line: number | null } | null;
  onClose: () => void;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'saving'>('loading');
  const [dirty, setDirty] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const [ioError, setIoError] = useState('');

  const save = async () => {
    const view = viewRef.current;
    if (!view) return;
    setStatus('saving');
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('visualizers_write', { id, manifest: null, code: view.state.doc.toString() });
      setDirty(false);
      setIoError('');
    } catch (e) {
      setIoError(String(e));
    } finally {
      setStatus('ready');
    }
  };
  const saveRef = useRef(save);
  saveRef.current = save;

  useEffect(() => {
    let disposed = false;
    (async () => {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        const src = await invoke<{ manifest: string; code: string }>('visualizers_read', { id });
        if (disposed || !hostRef.current) return;
        viewRef.current = new EditorView({
          doc: src.code,
          parent: hostRef.current,
          extensions: [
            basicSetup,
            javascript(),
            oneDark,
            keymap.of([{
              key: 'Ctrl-s',
              preventDefault: true,
              run: () => { void saveRef.current(); return true; },
            }]),
            EditorView.updateListener.of((u) => { if (u.docChanged) setDirty(true); }),
            EditorView.theme({ '&': { height: '100%', fontSize: '12px' } }),
          ],
        });
        setStatus('ready');
      } catch (e) {
        if (!disposed) setIoError(String(e));
      }
    })();
    return () => {
      disposed = true;
      viewRef.current?.destroy();
      viewRef.current = null;
    };
  }, [id]);

  const tryClose = () => {
    if (dirty) setConfirmClose(true);
    else onClose();
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        tryClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty]);

  const btn: React.CSSProperties = {
    padding: '5px 12px', fontSize: 12, cursor: 'pointer', borderRadius: 6,
    background: 'transparent', color: 'rgba(255,255,255,0.7)',
    border: '1px solid rgba(255,255,255,0.15)',
  };

  return (
    <div style={{
      position: 'absolute', inset: 0, zIndex: 10, display: 'flex', flexDirection: 'column',
      background: 'var(--surface-overlay, rgba(8,9,13,0.97))',
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px',
        borderBottom: '1px solid rgba(255,255,255,0.08)',
      }}>
        <span style={{ fontSize: 12, fontFamily: '"JetBrains Mono", ui-monospace, monospace', color: 'rgba(255,255,255,0.7)' }}>
          {id}/main.js{dirty ? ' •' : ''}
        </span>
        <div style={{ flex: 1 }} />
        <button style={{ ...btn, color: accent, borderColor: `${accent}55` }} onClick={() => void save()} disabled={status !== 'ready'}>
          {status === 'saving' ? 'Saving…' : 'Save (Ctrl+S)'}
        </button>
        <button style={btn} onClick={tryClose}>Close</button>
      </div>

      {confirmClose && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10, padding: '6px 12px', fontSize: 12,
          background: 'rgba(60,40,8,0.6)', borderBottom: '1px solid rgba(255,200,80,0.25)',
          color: 'rgba(255,220,150,0.95)',
        }}>
          Unsaved changes.
          <button style={btn} onClick={async () => { await save(); onClose(); }}>Save & close</button>
          <button style={btn} onClick={onClose}>Discard</button>
          <button style={btn} onClick={() => setConfirmClose(false)}>Keep editing</button>
        </div>
      )}

      {(ioError || liveError) && (
        <div style={{
          padding: '6px 12px', fontSize: 11, fontFamily: '"JetBrains Mono", ui-monospace, monospace',
          background: 'rgba(40,8,10,0.7)', borderBottom: '1px solid rgba(255,80,80,0.3)',
          color: 'rgba(255,180,180,0.95)',
        }}>
          {ioError || `${liveError?.line != null ? `line ${liveError.line}: ` : ''}${liveError?.message}`}
        </div>
      )}

      <div ref={hostRef} style={{ flex: 1, overflow: 'hidden' }} />

      <div style={{
        padding: '5px 12px', fontSize: 10, color: 'rgba(255,255,255,0.35)',
        borderTop: '1px solid rgba(255,255,255,0.06)',
      }}>
        Saves hot-reload the tile behind this editor (~2s). API v1: viz.on('frame', cb) · viz.settings — see the template comments.
      </div>
    </div>
  );
}

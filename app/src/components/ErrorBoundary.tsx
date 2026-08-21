import React from 'react';

// ─────────────────────────────────────────────────────────────────────────────
// The app had NO error boundary anywhere (0.8.5).
//
// That is why a Marketplace fault presented as a black screen: the overlays are
// lazy-loaded behind `<Suspense fallback={null}>`, so a throw during render or
// in an effect unmounted the entire React tree with nothing to catch it. The
// window stayed open and the canvas went black — no message, no console entry a
// user could see, nothing to report but "it goes black".
//
// This does not stop things throwing. It stops a throw from taking the whole
// app with it, and it makes the failure legible: the surface that broke says so
// and shows the error, while everything else keeps running. Any future report
// arrives as a screenshot with a stack instead of a guessing game.
// ─────────────────────────────────────────────────────────────────────────────

interface Props {
  /** Human name of the surface being guarded, e.g. "Marketplace". */
  surface: string;
  /** Dismiss affordance — usually the same handler that closes the overlay. */
  onClose?: () => void;
  /** 0.9.14: render the failure INSIDE the guarded box (a tile) instead of
   *  as a fixed full-window overlay, so one tile's throw reads as one broken
   *  tile while the rest of the dashboard keeps running. */
  inline?: boolean;
  /** 0.9.14: root-level use — offer a reload of the whole window. */
  allowReload?: boolean;
  children: React.ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // Keep the full detail in the console for anyone who can open devtools,
    // while the UI below shows the readable part.
    console.error(`[${this.props.surface}] crashed:`, error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    if (this.props.inline) {
      return (
        <div style={{
          position: 'absolute', inset: 0, padding: 12, overflow: 'auto',
          background: 'rgba(40,8,10,0.35)', fontFamily: '"JetBrains Mono", ui-monospace, monospace',
        }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#fca5a5', marginBottom: 4 }}>
            ⚠ {this.props.surface} hit an error
          </div>
          <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.6)', marginBottom: 8 }}>
            The rest of the dashboard is unaffected. Details are in the crash log (Settings → Advanced).
          </div>
          <pre style={{
            fontSize: 9.5, color: '#fca5a5', margin: '0 0 8px', whiteSpace: 'pre-wrap',
            wordBreak: 'break-word', userSelect: 'text', maxHeight: 120, overflow: 'auto',
          }}>{String(error?.message || error)}</pre>
          <button
            onClick={() => this.setState({ error: null })}
            style={{
              padding: '4px 10px', fontSize: 10.5, fontWeight: 600, borderRadius: 'var(--control-radius, 5px)',
              background: 'rgba(255,255,255,0.08)', color: '#fff',
              border: '1px solid var(--control-border, rgba(255,255,255,0.15))', cursor: 'pointer',
            }}
          >Try again</button>
        </div>
      );
    }

    return (
      <div style={{
        position: 'fixed', inset: 0, zIndex: 2100,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(9,10,13,0.97)', padding: 24,
      }}>
        <div style={{ maxWidth: 560, lineHeight: 1.55 }}>
          <div style={{ fontSize: 28, marginBottom: 10 }}>⚠</div>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#fff', marginBottom: 8 }}>
            {this.props.surface} hit an error
          </div>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.6)', marginBottom: 12 }}>
            The rest of the app is still running. Closing this and reopening it is safe.
          </div>
          <pre style={{
            fontSize: 11, fontFamily: '"JetBrains Mono", ui-monospace, monospace',
            color: '#fca5a5', background: 'rgba(255,255,255,0.04)',
            border: '1px solid rgba(255,255,255,0.08)', borderRadius: 6,
            padding: 10, margin: '0 0 14px', maxHeight: 220, overflow: 'auto',
            whiteSpace: 'pre-wrap', wordBreak: 'break-word', userSelect: 'text',
          }}>{String(error?.stack || error?.message || error)}</pre>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={() => this.setState({ error: null })}
              style={{
                padding: '7px 14px', fontSize: 12, fontWeight: 600, borderRadius: 6,
                background: 'rgba(255,255,255,0.08)', color: '#fff',
                border: '1px solid rgba(255,255,255,0.15)', cursor: 'pointer',
              }}
            >Try again</button>
            {this.props.allowReload && (
              <button
                onClick={() => window.location.reload()}
                style={{
                  padding: '7px 14px', fontSize: 12, fontWeight: 600, borderRadius: 6,
                  background: '#fff', color: '#000', border: 'none', cursor: 'pointer',
                }}
              >Reload app</button>
            )}
            {this.props.onClose && (
              <button
                onClick={() => { this.setState({ error: null }); this.props.onClose?.(); }}
                style={{
                  padding: '7px 14px', fontSize: 12, fontWeight: 600, borderRadius: 6,
                  background: '#fff', color: '#000', border: 'none', cursor: 'pointer',
                }}
              >Close</button>
            )}
          </div>
        </div>
      </div>
    );
  }
}

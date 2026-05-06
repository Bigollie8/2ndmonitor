import { useEffect, useRef } from 'react';
import { HFTile } from './tiles';
import { isTauri } from '../state/tauri';
import type { Density } from '../types';

/**
 * Renders the tile chrome (header, border, rounded body) and reserves a body
 * rect that a native WebView2 child paints over. The body div's screen-space
 * rect (measured via getBoundingClientRect against the viewport-filling
 * canvas) is pushed to Rust via `position_tile`, which adds (or moves) a
 * child webview inside the main window at exactly that rect.
 *
 * Non-Tauri (web preview) renders an inline placeholder showing the URL.
 */
export function WebviewTile({ label, url, title, density, accent, enabled = true }: {
  label: string;
  url: string;
  title: string;
  density: Density;
  accent: string;
  /** Closes the child webview when false (e.g. during a fullscreen overlay). */
  enabled?: boolean;
}) {
  const bodyRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!isTauri) return;
    const el = bodyRef.current;
    if (!el) return;

    let cancelled = false;

    const apiPromise = import('@tauri-apps/api/core');

    const sync = () => {
      const r = el.getBoundingClientRect();
      apiPromise.then(({ invoke }) => {
        if (cancelled) return;
        invoke('position_tile', {
          label,
          url,
          x: r.left,
          y: r.top,
          w: r.width,
          h: r.height,
        }).catch((err) => console.error('position_tile failed', err));
      });
    };

    if (enabled) {
      sync();
      const ro = new ResizeObserver(sync);
      ro.observe(el);
      window.addEventListener('resize', sync);
      return () => {
        cancelled = true;
        ro.disconnect();
        window.removeEventListener('resize', sync);
      };
    } else {
      // Tear down the native child while the overlay is showing so it doesn't
      // poke through the dim layer.
      apiPromise.then(({ invoke }) => {
        invoke('close_tile', { label }).catch(() => {});
      });
      return () => { cancelled = true; };
    }
  }, [label, url, enabled]);

  // On final unmount, close the native child.
  useEffect(() => {
    if (!isTauri) return;
    return () => {
      import('@tauri-apps/api/core').then(({ invoke }) => {
        invoke('close_tile', { label }).catch(() => {});
      });
    };
  }, [label]);

  return (
    <HFTile
      title={title}
      density={density}
      headRight={
        <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', fontFamily: '"JetBrains Mono", ui-monospace, monospace' }}>
          {hostOf(url)}
        </span>
      }
      style={{ height: '100%' }}
    >
      <div
        ref={bodyRef}
        style={{
          position: 'absolute', inset: 0,
          background: '#06070a',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: 'rgba(255,255,255,0.45)', fontSize: 12, padding: 16, textAlign: 'center',
        }}
      >
        {!isTauri ? (
          <span>
            Webview placeholder · <span style={{ color: accent, fontFamily: '"JetBrains Mono", ui-monospace, monospace' }}>{url}</span>
            <br />
            <span style={{ fontSize: 10, opacity: 0.6 }}>Real WebView2 only inside Tauri</span>
          </span>
        ) : (
          <span style={{ opacity: 0.6 }}>Loading {hostOf(url)}…</span>
        )}
      </div>
    </HFTile>
  );
}

function hostOf(url: string): string {
  try { return new URL(url).host; } catch { return url; }
}

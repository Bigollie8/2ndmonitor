import React from 'react';
import { useEffect, useRef, useState } from 'react';
import { useBrowserWebview } from '../state/browserWebview';
import { Launchpad } from './launchpad';

export interface Bookmark {
  id: string;
  name: string;
  url: string;
  /** 1-3 chars or a single emoji. Drives the big label on the launchpad card. */
  letters: string;
  color: string;
}

/** Stable seed list used by both `migrateTweaks` (first launch / reset) and
 *  the "Restore defaults" affordance in Settings. Returns a fresh array each
 *  call so callers can mutate without aliasing the seed. */
export function defaultBookmarks(): Bookmark[] {
  const mk = (name: string, url: string, letters: string, color: string): Bookmark => ({
    id: newId(), name, url, letters, color,
  });
  return [
    mk('YouTube',       'https://www.youtube.com',      'YT', '#ff0000'),
    mk('Spotify',       'https://open.spotify.com',     'SP', '#22c55e'),
    mk('Apple Music',   'https://music.apple.com',      'AM', '#fa233b'),
    mk('YouTube Music', 'https://music.youtube.com',    'YM', '#ff0000'),
    mk('Netflix',       'https://www.netflix.com',      'NF', '#e50914'),
    mk('Disney+',       'https://www.disneyplus.com',   'D+', '#113ccf'),
    mk('Hulu',          'https://www.hulu.com',         'HU', '#1ce783'),
    mk('HBO Max',       'https://www.max.com',          'MX', '#002be7'),
    mk('Prime Video',   'https://www.primevideo.com',   'PV', '#00a8e1'),
    mk('Twitch',        'https://www.twitch.tv',        'TW', '#9146ff'),
    mk('Plex',          'https://app.plex.tv',          'PX', '#e5a00d'),
  ];
}

function newId(): string {
  return (typeof crypto !== 'undefined' && crypto.randomUUID)
    ? crypto.randomUUID()
    : `bm_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

interface BrowserPlayerProps {
  enabled: boolean;
  currentUrl: string | null;
  bookmarks: Bookmark[];
  onNavigate: (url: string | null) => void;
  onExit: () => void;
  /** Any overlay open: hide the native webview (Webview.hide) so it cannot
   *  paint over the panel, while the page — its logged-in session AND its
   *  audio — stays alive underneath (0.8.6). One mechanism for every overlay;
   *  the park-offscreen and hard-close variants it replaces each had a failure
   *  mode (the Market black screen; Settings killing playback). */
  suppress: boolean;
}

export function BrowserPlayer({ enabled, currentUrl, bookmarks, onNavigate, onExit, suppress }: BrowserPlayerProps) {
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const [bounds, setBounds] = useState<DOMRect | null>(null);

  // The webview exists whenever video is on and a URL is set; overlays merely
  // HIDE it (see BrowserPlayerProps.suppress). Third iteration of this logic:
  // destroy-on-overlay lost the session and stopped playback (Settings
  // "freezing" the app), park-offscreen could silently fail to move and
  // black-screen the Market. A hidden webview is not composited, so it cannot
  // cover a panel, and the page keeps playing underneath.
  const webviewActive = enabled && !!currentUrl;

  // Measure the placeholder div — initial measurement, on ResizeObserver, and on
  // window resize. The hook's reposition effect runs on every bounds change, so
  // we memoize on rect-value equality here to avoid per-frame IPC during a
  // sustained drag (e.g., the user dragging the window edge).
  useEffect(() => {
    if (!webviewActive) { setBounds(null); return; }
    const el = bodyRef.current;
    if (!el) return;
    const measure = () => {
      const rect = el.getBoundingClientRect();
      setBounds((prev) => {
        if (
          prev !== null &&
          prev.left === rect.left &&
          prev.top === rect.top &&
          prev.width === rect.width &&
          prev.height === rect.height
        ) {
          return prev; // same values → preserve reference, no re-render / no IPC
        }
        return rect;
      });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener('resize', measure);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [webviewActive]);

  const { error } = useBrowserWebview({
    enabled: webviewActive,
    url: currentUrl,
    bounds,
    hidden: suppress,
  });

  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', background: 'var(--surface-canvas, #06070a)' }}>
      <ChromeBar onHome={() => onNavigate(null)} onExit={onExit} />
      <div ref={bodyRef} style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
        {currentUrl === null && (
          <Launchpad bookmarks={bookmarks} onPick={(url) => onNavigate(url)} />
        )}
        {currentUrl !== null && error && (
          <BrowserUnavailable error={error} onExit={onExit} />
        )}
        {currentUrl !== null && !error && suppress && (
          <SuppressedNotice />
        )}
        {/* When currentUrl is set and no error and not suppressed, the native
            child webview is positioned over this div. Nothing to render in HTML. */}
      </div>
    </div>
  );
}

function BrowserUnavailable({ error, onExit }: { error: string; onExit: () => void }) {
  return (
    <div style={{
      position: 'absolute', inset: 0, padding: 24,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      color: 'rgba(255,255,255,0.85)', textAlign: 'center', lineHeight: 1.55,
      fontSize: 13,
    }}>
      <div style={{ maxWidth: 380 }}>
        <div style={{ fontSize: 32, marginBottom: 12 }}>⚠</div>
        <div style={{ fontWeight: 600, marginBottom: 6 }}>Browser unavailable</div>
        <div style={{
          color: 'rgba(255,255,255,0.55)', fontSize: 11,
          fontFamily: '"JetBrains Mono", ui-monospace, monospace',
          marginBottom: 16, wordBreak: 'break-word',
        }}>{error}</div>
        <button onClick={onExit} style={{
          padding: '8px 16px', fontSize: 12, fontWeight: 600,
          background: '#fff', color: '#000', border: 'none',
          borderRadius: 6, cursor: 'pointer',
        }}>Return to visualizer</button>
      </div>
    </div>
  );
}

function SuppressedNotice() {
  return (
    <div style={{
      position: 'absolute', inset: 0,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      color: 'rgba(255,255,255,0.5)', fontSize: 12,
      fontFamily: '"JetBrains Mono", ui-monospace, monospace',
    }}>
      Browser hidden while overlay is open
    </div>
  );
}

function ChromeBar({ onHome, onExit }: {
  onHome: () => void;
  onExit: () => void;
}) {
  const btn: React.CSSProperties = {
    background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
    color: 'rgba(255,255,255,0.85)', padding: '6px 10px', borderRadius: 6,
    cursor: 'pointer', fontSize: 12, fontWeight: 500,
  };
  return (
    <div style={{
      height: 36, flexShrink: 0,
      borderBottom: '1px solid rgba(255,255,255,0.06)',
      background: 'var(--surface-chrome, rgba(8,9,12,0.85))', backdropFilter: 'blur(10px)',
      display: 'flex', alignItems: 'center', gap: 6, padding: '0 10px',
    }}>
      <button onClick={onHome} style={btn} title="Home">🏠</button>
      <div style={{ flex: 1 }} />
      <button onClick={onExit} style={btn} title="Exit to visualizer">✕</button>
    </div>
  );
}

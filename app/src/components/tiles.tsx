import React, { useEffect, useRef, useState, type MutableRefObject } from 'react';
import { getDensity } from '../data';
import type { Density, Track } from '../types';
import type { Todo } from '../types';
import { type Playback, type SpectrumState, mediaControls, useSpotify, useSysmon, type SpotifyTrack } from '../state/tauri';
import { useLyrics, currentLineIndex } from '../state/lyrics';
import { mediaSourceFor, type MediaSourceInfo, type MediaSourceKind } from '../state/mediaSource';
import { tempsToChips, tempsTooltip } from '../state/temps';
import type { TempUnit } from '../state/units';
import { Slider } from './Slider';

export function HFTile({
  title, badge, headRight, children, accent, density = 'regular', noHead, style, onClick,
}: {
  title?: React.ReactNode;
  badge?: React.ReactNode;
  headRight?: React.ReactNode;
  children?: React.ReactNode;
  accent?: string;
  density?: Density;
  noHead?: boolean;
  style?: React.CSSProperties;
  onClick?: () => void;
}) {
  const D = getDensity(density);
  return (
    <div onClick={onClick} style={{
      background: 'var(--surface-tile, rgba(22,24,30,0.78))',
      backdropFilter: 'blur(20px) saturate(140%)',
      WebkitBackdropFilter: 'blur(20px) saturate(140%)',
      border: '1px solid rgba(255,255,255,0.06)',
      borderRadius: 14,
      overflow: 'hidden',
      position: 'relative',
      display: 'flex',
      flexDirection: 'column',
      boxShadow: accent ? `0 0 0 1px ${accent}33, 0 0 30px -8px ${accent}55` : '0 8px 24px -8px rgba(0,0,0,0.4)',
      ...style,
    }}>
      {!noHead && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: `${D.headerPad}px ${D.pad}px`,
          fontSize: 10, color: 'rgba(255,255,255,0.55)',
          letterSpacing: '0.08em', textTransform: 'uppercase', fontWeight: 600,
          flexShrink: 0,
        }}>
          <span style={{ flex: 1 }}>{title}</span>
          {badge}
          {headRight}
        </div>
      )}
      <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>{children}</div>
    </div>
  );
}

export function Sparkline({ data, color, height = 28, width = '100%' }: { data: number[]; color: string; height?: number | string; width?: number | string }) {
  if (data.length < 2) return null;
  const pts = data.map((v, i) => `${(i / (data.length - 1)) * 100},${100 - v * 100}`).join(' ');
  return (
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ width, height, display: 'block' }}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="2" vectorEffect="non-scaling-stroke" />
      <polyline points={`0,100 ${pts} 100,100`} fill={color} opacity="0.12" />
    </svg>
  );
}

const iconBtn = (): React.CSSProperties => ({
  background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.08)',
  color: 'rgba(255,255,255,0.85)', width: 28, height: 28, borderRadius: 999,
  display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
  fontSize: 11, padding: 0,
});

// ── Spotify ──────────────────────────────────────────────────────────────────
function formatMMSS(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) return '0:00';
  const total = Math.floor(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/** Estimate "now" position from the last GSMTC sync, ticking 1Hz when playing. */
function useLivePosition(playback: Playback | null): number {
  const [now, setNow] = useState(() => performance.now());
  useEffect(() => {
    if (!playback?.playing) return;
    const id = setInterval(() => setNow(performance.now()), 250);
    return () => clearInterval(id);
  }, [playback?.playing, playback?.syncedAt]);
  if (!playback) return 0;
  if (!playback.playing) return playback.positionAtSync;
  const elapsed = (now - playback.syncedAt) / 1000;
  const projected = playback.positionAtSync + elapsed;
  return playback.duration > 0 ? Math.min(playback.duration, projected) : projected;
}

type SpotifyTab = 'now' | 'lyrics' | 'upnext';

export function SpotifyTile({ density, accent, accent2, track, onPick: _onPick, playback, sourceAppId, spectrumRef }: {
  density: Density;
  accent: string;
  accent2: string;
  track: Track;
  onPick: (t: Track) => void;
  playback?: Playback | null;
  /** GSMTC SourceAppUserModelId — drives the platform pill and gates the
   *  Spotify-only Up Next + volume controls. */
  sourceAppId?: string;
  spectrumRef?: MutableRefObject<SpectrumState>;
}) {
  const [tab, setTab] = useState<SpotifyTab>('now');
  const source = mediaSourceFor(sourceAppId);
  return (
    <HFTile
      title="Now playing"
      density={density}
      badge={<SourceBadge source={source} playback={playback} />}
      style={{ height: '100%' }}
    >
      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <SpotifyTabBar tab={tab} setTab={setTab} accent={accent} />
        <div style={{ flex: 1, minHeight: 0, position: 'relative', display: 'flex', flexDirection: 'column' }}>
          {tab === 'now' && (
            <SpotifyNowView
              accent={accent} accent2={accent2} track={track}
              playback={playback} sourceKind={source.kind} spectrumRef={spectrumRef}
            />
          )}
          {tab === 'lyrics' && <SpotifyLyricsView accent={accent} playback={playback} />}
          {tab === 'upnext' && <UpNextRouter accent={accent} source={source} />}
        </div>
      </div>
    </HFTile>
  );
}

function SourceBadge({ source, playback }: { source: MediaSourceInfo; playback?: Playback | null }) {
  const playing = !!playback?.playing;
  const tone = playing ? source.color : 'rgba(255,255,255,0.55)';
  return (
    <span style={{
      fontSize: 9, fontWeight: 700, color: tone,
      padding: '2px 7px', borderRadius: 4,
      background: tone + '18',
      border: `1px solid ${tone}55`,
      letterSpacing: '.05em',
      display: 'inline-flex', alignItems: 'center', gap: 5,
    }} title={playing ? 'Playing' : (playback ? 'Paused' : 'No session')}>
      <span aria-hidden style={{ fontSize: 11, lineHeight: 1 }}>{source.glyph}</span>
      <span>{source.label.toUpperCase()}</span>
      {!playing && playback && (
        <span style={{ opacity: 0.65 }}>· paused</span>
      )}
    </span>
  );
}

/** "Up next" tab content routes by source: Spotify gets the Web API queue
 *  view; everything else gets a small explainer so the tab doesn't visually
 *  shimmer when the user switches platforms. */
function UpNextRouter({ accent, source }: { accent: string; source: MediaSourceInfo }) {
  if (source.hasQueueIntegration) {
    return <SpotifyUpNextView accent={accent} />;
  }
  if (source.kind === 'none') {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 18, textAlign: 'center', color: 'rgba(255,255,255,0.45)', fontSize: 11, lineHeight: 1.55 }}>
        Start playing something to see Up Next.
      </div>
    );
  }
  return (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 18, textAlign: 'center', color: 'rgba(255,255,255,0.55)', fontSize: 11, lineHeight: 1.55 }}>
      <div>
        <div style={{ fontSize: 13, fontWeight: 600, color: '#fff', marginBottom: 6 }}>
          Up Next isn't available for {source.label}
        </div>
        <div>
          Only Spotify exposes a public queue API. Switch to Spotify to see
          your queue here — Now and Lyrics work for any platform.
        </div>
      </div>
    </div>
  );
}

function SpotifyTabBar({ tab, setTab, accent }: { tab: SpotifyTab; setTab: (t: SpotifyTab) => void; accent: string }) {
  const tabs: { id: SpotifyTab; label: string }[] = [
    { id: 'now',    label: 'Now' },
    { id: 'lyrics', label: 'Lyrics' },
    { id: 'upnext', label: 'Up next' },
  ];
  return (
    <div style={{
      display: 'flex', borderBottom: '1px solid rgba(255,255,255,0.06)',
      flexShrink: 0,
    }}>
      {tabs.map((t) => {
        const active = tab === t.id;
        return (
          <button key={t.id} onClick={() => setTab(t.id)} style={{
            flex: 1, padding: '6px 0',
            background: active ? `${accent}10` : 'transparent',
            border: 'none', borderBottom: active ? `2px solid ${accent}` : '2px solid transparent',
            color: active ? accent : 'rgba(255,255,255,0.55)',
            fontSize: 10, fontWeight: 600, letterSpacing: '.06em',
            textTransform: 'uppercase',
            fontFamily: '"JetBrains Mono", ui-monospace, monospace',
            cursor: 'pointer',
            transition: 'background 0.12s, border-color 0.12s, color 0.12s',
          }}>{t.label}</button>
        );
      })}
    </div>
  );
}

function SpotifyNowView({ accent, accent2, track, playback, sourceKind, spectrumRef }: {
  accent: string; accent2: string; track: Track;
  playback?: Playback | null;
  sourceKind: MediaSourceKind;
  spectrumRef?: MutableRefObject<SpectrumState>;
}) {
  const position = useLivePosition(playback ?? null);
  const duration = playback?.duration ?? 0;
  const havePlayback = !!playback && duration > 0;
  const progressPct = havePlayback ? Math.min(100, (position / duration) * 100) : 0;
  const positionLabel = havePlayback ? formatMMSS(position) : '—';
  const durationLabel = havePlayback ? formatMMSS(duration) : '—';
  return (
    <>
      {/* Big album art */}
      <div style={{
        flex: '1 1 auto',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '12px 12px 8px', minHeight: 0, overflow: 'hidden',
      }}>
        <div style={{
          aspectRatio: '1 / 1',
          maxWidth: 'min(100%, 230px)', maxHeight: '100%', width: '100%',
          borderRadius: 12,
          background: track.cover, backgroundSize: 'cover', backgroundPosition: 'center',
          boxShadow: `0 14px 44px ${accent}66, 0 0 0 1px rgba(255,255,255,0.04)`,
          position: 'relative', overflow: 'hidden',
        }}>
          {!track.cover.startsWith('center') && (
            <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(circle at 30% 30%, rgba(255,255,255,0.28), transparent 60%)' }} />
          )}
        </div>
      </div>
      {/* Track info */}
      <div style={{ padding: '0 14px', flexShrink: 0, textAlign: 'center' }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{track.title}</div>
        <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.7)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{track.artist}</div>
        {track.album && (
          <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{track.album}</div>
        )}
      </div>
      {/* Progress + time */}
      <div style={{ padding: '10px 14px 6px', flexShrink: 0 }}>
        <div style={{ height: 3, background: 'rgba(255,255,255,0.1)', borderRadius: 2, position: 'relative', overflow: 'hidden' }}>
          <div style={{
            position: 'absolute', left: 0, top: 0, bottom: 0, width: `${progressPct}%`,
            background: `linear-gradient(90deg, ${accent2}, ${accent})`,
            borderRadius: 2,
            transition: havePlayback ? 'width 0.25s linear' : 'none',
          }} />
          <div style={{
            position: 'absolute', left: `${progressPct}%`, top: '50%', transform: 'translate(-50%,-50%)',
            width: 9, height: 9, background: '#fff', borderRadius: 999,
            boxShadow: `0 0 8px ${accent}`,
            transition: havePlayback ? 'left 0.25s linear' : 'none',
          }} />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'rgba(255,255,255,0.4)', fontFamily: '"JetBrains Mono", ui-monospace, monospace', marginTop: 4 }}>
          <span>{positionLabel}</span><span>{durationLabel}</span>
        </div>
      </div>
      {/* Controls */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, justifyContent: 'center', padding: '4px 0 8px', flexShrink: 0 }}>
        <button title="Previous" onClick={() => mediaControls.previous()} style={{ ...iconBtn(), width: 32, height: 32 }}>⏮</button>
        <button
          title={playback?.playing ? 'Pause' : 'Play'}
          onClick={() => mediaControls.togglePlayPause()}
          style={{ ...iconBtn(), width: 44, height: 44, background: '#fff', color: '#000', borderRadius: 999, fontSize: 16 }}
        >{playback?.playing ? '⏸' : '⏵'}</button>
        <button title="Next" onClick={() => mediaControls.next()} style={{ ...iconBtn(), width: 32, height: 32 }}>⏭</button>
      </div>
      {/* Spotify Web API volume — only meaningful when Spotify is the source.
       *  For Apple Music / browser playback / etc. the user adjusts volume
       *  through the system mixer (or the audio mixer tile). */}
      {sourceKind === 'spotify' && <SpotifyVolumeRow accent={accent} accent2={accent2} />}
      {/* Mini reactive visualizer */}
      {spectrumRef && <SpotifyMiniViz accent={accent} accent2={accent2} spectrumRef={spectrumRef} />}
    </>
  );
}

function SpotifyUpNextView({ accent }: { accent: string }) {
  const { state, connect, disconnect, getStoredClientId } = useSpotify();
  const [draftId, setDraftId] = useState('');
  const [showHelp, setShowHelp] = useState(false);

  useEffect(() => {
    getStoredClientId().then((id) => { if (id) setDraftId(id); });
  }, []);

  if (!state.connected) {
    return (
      <div style={{ flex: 1, padding: 14, display: 'flex', flexDirection: 'column', gap: 10, overflow: 'auto' }}>
        <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.85)', lineHeight: 1.5 }}>
          Connect Spotify to see your queue. Read-only — we never play, pause, or skip on your behalf.
        </div>
        <input
          value={draftId}
          onChange={(e) => setDraftId(e.target.value)}
          placeholder="Spotify Client ID"
          spellCheck={false}
          style={{
            background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: 6, color: '#fff', padding: '7px 10px', fontSize: 12,
            fontFamily: '"JetBrains Mono", ui-monospace, monospace', outline: 'none',
          }}
          onKeyDown={(e) => { if (e.key === 'Enter' && draftId.trim()) connect(draftId.trim()); }}
        />
        <button
          onClick={() => { if (draftId.trim()) connect(draftId.trim()); }}
          disabled={!draftId.trim() || state.connecting}
          style={{
            padding: '8px 12px', fontSize: 12, fontWeight: 700,
            background: draftId.trim() && !state.connecting ? accent : 'rgba(255,255,255,0.06)',
            color: draftId.trim() && !state.connecting ? '#000' : 'rgba(255,255,255,0.4)',
            border: 'none', borderRadius: 6,
            cursor: draftId.trim() && !state.connecting ? 'pointer' : 'not-allowed',
          }}
        >{state.connecting ? 'Authorizing…' : 'Connect Spotify'}</button>
        {state.error && (
          <div style={{ fontSize: 11, color: '#fca5a5', padding: 8, borderRadius: 6, background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)' }}>
            {state.error}
          </div>
        )}
        <button onClick={() => setShowHelp((v) => !v)} style={{
          fontSize: 11, color: 'rgba(255,255,255,0.55)', background: 'transparent',
          border: 'none', padding: '4px 0', textAlign: 'left', cursor: 'pointer',
        }}>{showHelp ? 'Hide setup help' : 'How do I get a Client ID?'}</button>
        {showHelp && (
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.7)', lineHeight: 1.5, padding: 10, borderRadius: 6, background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
            <ol style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 4 }}>
              <li>Go to <span style={{ color: accent, fontFamily: '"JetBrains Mono", ui-monospace, monospace' }}>developer.spotify.com/dashboard</span></li>
              <li>Create an app. Add <span style={{ color: accent, fontFamily: '"JetBrains Mono", ui-monospace, monospace' }}>http://127.0.0.1:14202/callback</span> as a Redirect URI. Spotify deprecated <code>localhost</code> — must be the literal IP.</li>
              <li>Copy the Client ID, paste it above.</li>
              <li>Click Connect — the browser opens, click Authorize.</li>
            </ol>
          </div>
        )}
      </div>
    );
  }

  const reauthBanner = state.needs_reauth ? (
    <div style={{
      margin: '6px 10px 0',
      padding: '6px 10px',
      borderRadius: 6,
      background: 'rgba(245, 158, 11, 0.10)',
      border: '1px solid rgba(245, 158, 11, 0.35)',
      color: '#fbbf24',
      fontSize: 11,
      lineHeight: 1.45,
    }}>
      Reconnect to enable playback control (volume).
      <button
        onClick={() => disconnect()}
        style={{
          marginLeft: 8,
          background: 'transparent',
          border: '1px solid rgba(245, 158, 11, 0.55)',
          color: '#fbbf24',
          fontSize: 10,
          padding: '2px 8px',
          borderRadius: 4,
          cursor: 'pointer',
          fontFamily: '"JetBrains Mono", ui-monospace, monospace',
        }}
      >sign out</button>
    </div>
  ) : null;

  if (state.premium_required) {
    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        <SpotifyConnectionHeader onDisconnect={() => disconnect()} />
        {reauthBanner}
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 18, textAlign: 'center', color: 'rgba(255,255,255,0.55)', fontSize: 11, lineHeight: 1.55 }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#fff', marginBottom: 6 }}>Premium required</div>
            <div>Spotify Web API requires Premium to read the queue. Free accounts don't expose it.</div>
          </div>
        </div>
      </div>
    );
  }

  if (state.queue.length === 0) {
    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        <SpotifyConnectionHeader onDisconnect={() => disconnect()} />
        {reauthBanner}
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'rgba(255,255,255,0.45)', fontSize: 11 }}>
          Nothing queued.
        </div>
      </div>
    );
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <SpotifyConnectionHeader onDisconnect={() => disconnect()} />
      {reauthBanner}
      <div style={{ flex: 1, overflowY: 'auto', padding: '4px 8px 10px' }}>
        {state.queue.map((q, i) => <UpNextRow key={(q.id || q.title) + ':' + i} track={q} accent={accent} />)}
      </div>
    </div>
  );
}

function SpotifyConnectionHeader({ onDisconnect }: { onDisconnect: () => void }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '4px 10px 0' }}>
      <button onClick={onDisconnect} style={{
        fontSize: 9, color: 'rgba(255,255,255,0.4)',
        background: 'transparent', border: 'none', cursor: 'pointer',
        fontFamily: '"JetBrains Mono", ui-monospace, monospace',
      }}>sign out</button>
    </div>
  );
}

function UpNextRow({ track, accent }: { track: SpotifyTrack; accent: string }) {
  const mins = Math.floor(track.duration_ms / 60000);
  const secs = Math.floor((track.duration_ms % 60000) / 1000);
  return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '5px 6px', borderRadius: 5 }}>
      {track.art_url ? (
        <img src={track.art_url} alt="" style={{ width: 32, height: 32, borderRadius: 4, flexShrink: 0, background: 'rgba(255,255,255,0.05)' }} />
      ) : (
        <div style={{ width: 32, height: 32, borderRadius: 4, background: `linear-gradient(135deg, ${accent}66, ${accent}22)`, flexShrink: 0 }} />
      )}
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 11.5, fontWeight: 600, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{track.title}</div>
        <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.5)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{track.artist}</div>
      </div>
      <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', fontFamily: '"JetBrains Mono", ui-monospace, monospace', flexShrink: 0 }}>{mins}:{String(secs).padStart(2, '0')}</span>
    </div>
  );
}

// GSMTC lags real audio by ~300-800ms; same forward offset as the viz overlay.
const LYRICS_FORWARD_OFFSET_SECS = 0.4;

function SpotifyLyricsView({ accent, playback }: { accent: string; playback?: Playback | null }) {
  const lyrics = useLyrics();
  const pos = useLivePosition(playback ?? null);
  const idx = currentLineIndex(lyrics.syncedLines, pos + LYRICS_FORWARD_OFFSET_SECS);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const activeRef = useRef<HTMLDivElement | null>(null);

  // Auto-scroll the active line to ~1/3 from the top of the viewport.
  useEffect(() => {
    const c = containerRef.current;
    const a = activeRef.current;
    if (!c || !a) return;
    const target = a.offsetTop - c.clientHeight / 3;
    c.scrollTo({ top: Math.max(0, target), behavior: 'smooth' });
  }, [idx]);

  if (lyrics.instrumental) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'rgba(255,255,255,0.55)', fontSize: 14 }}>
        ♪ Instrumental
      </div>
    );
  }

  if (lyrics.syncedLines.length === 0 && lyrics.plainLines.length === 0) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 18, textAlign: 'center', color: 'rgba(255,255,255,0.45)', fontSize: 11, lineHeight: 1.55 }}>
        No lyrics found for this track.
      </div>
    );
  }

  // Synced view
  if (lyrics.syncedLines.length > 0) {
    return (
      <div ref={containerRef} style={{
        flex: 1, overflowY: 'auto', padding: '14px 16px',
        fontFamily: '"JetBrains Mono", ui-monospace, monospace',
        fontSize: 12, lineHeight: 1.7,
        scrollBehavior: 'smooth',
      }}>
        {lyrics.syncedLines.map((line, i) => {
          const active = i === idx;
          return (
            <div
              key={i}
              ref={active ? activeRef : undefined}
              style={{
                color: active ? '#fff' : (i < idx ? 'rgba(255,255,255,0.32)' : 'rgba(255,255,255,0.65)'),
                fontWeight: active ? 700 : 400,
                background: active ? `linear-gradient(90deg, ${accent}22, transparent)` : 'transparent',
                borderLeft: active ? `2px solid ${accent}` : '2px solid transparent',
                padding: '2px 0 2px 8px',
                margin: '1px -8px',
                transition: 'color 0.18s, background 0.18s',
              }}
            >
              {line.text || ' ' /* non-breaking space for empty pause lines */}
            </div>
          );
        })}
      </div>
    );
  }

  // Plain-text fallback
  return (
    <div style={{
      flex: 1, overflowY: 'auto', padding: '14px 16px',
      fontFamily: '"JetBrains Mono", ui-monospace, monospace',
      fontSize: 12, lineHeight: 1.7, color: 'rgba(255,255,255,0.7)',
    }}>
      {lyrics.plainLines.map((line, i) => (
        <div key={i}>{line || ' '}</div>
      ))}
    </div>
  );
}

function SpotifyVolumeRow({ accent, accent2 }: { accent: string; accent2: string }) {
  const { state, setVolume } = useSpotify();

  // Resolve disabled reason in priority order. First match wins.
  let disabled = false;
  let hint: string | null = null;
  let value = 0;
  if (!state.connected) {
    disabled = true;
    hint = 'Connect Spotify (Up next tab)';
  } else if (state.needs_reauth) {
    disabled = true;
    hint = 'Reconnect Spotify for playback control';
  } else if (state.premium_required) {
    disabled = true;
    hint = 'Spotify Premium required';
  } else if (state.volume_percent === null) {
    disabled = true;
    hint = 'Open Spotify on a device';
  } else if (!state.volume_supported) {
    disabled = true;
    hint = "This device doesn't support remote volume";
    value = state.volume_percent / 100;
  } else {
    value = state.volume_percent / 100;
  }

  const onCommit = (v: number) => {
    if (disabled) return;
    setVolume(v * 100).catch((err) => console.error('spotify setVolume failed', err));
  };

  const percentLabel = state.volume_percent !== null
    ? `${state.volume_percent}%`
    : '—';
  const subLine = hint ?? state.device_name ?? '';

  return (
    <div
      title={hint ?? undefined}
      style={{
        padding: '2px 14px 8px',
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        gap: 10,
      }}
    >
      <span style={{
        fontSize: 13,
        color: disabled ? 'rgba(255,255,255,0.35)' : 'rgba(255,255,255,0.7)',
        flexShrink: 0,
      }} aria-hidden>🔊</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          display: 'flex', justifyContent: 'space-between',
          fontSize: 9, letterSpacing: '.06em', textTransform: 'uppercase',
          color: 'rgba(255,255,255,0.45)',
          marginBottom: 2, gap: 8,
          fontFamily: '"JetBrains Mono", ui-monospace, monospace',
        }}>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {subLine}
          </span>
          <span style={{ flexShrink: 0, color: 'rgba(255,255,255,0.7)' }}>{percentLabel}</span>
        </div>
        <Slider
          value={value}
          disabled={disabled}
          dimmed={false}
          accent={accent}
          accent2={accent2}
          onCommit={onCommit}
          throttleMs={250}
        />
      </div>
    </div>
  );
}

function SpotifyMiniViz({ accent, accent2, spectrumRef }: {
  accent: string;
  accent2: string;
  spectrumRef: MutableRefObject<SpectrumState>;
}) {
  const COUNT = 36;
  const refs = useRef<(HTMLDivElement | null)[]>([]);
  useEffect(() => {
    let raf = 0;
    // Once we've painted the idle floor there's nothing to animate until real
    // audio arrives — skip the 36 DOM writes per frame instead of rewriting
    // the same scaleY(0.08) at 60fps.
    let settled = false;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      if (document.hidden) return;
      const bands = spectrumRef.current.bands;
      const live = spectrumRef.current.live;
      const level = spectrumRef.current.level;
      if (!live || bands.length === 0) {
        if (!settled) {
          for (let i = 0; i < COUNT; i++) {
            const el = refs.current[i];
            if (el) el.style.transform = 'scaleY(0.08)';
          }
          settled = true;
        }
        return;
      }
      settled = false;
      for (let i = 0; i < COUNT; i++) {
        // Map across the energetic lower-mid range (same trick as the
        // viz hero waveform — the highest bands are usually silent).
        const t_norm = i / (COUNT - 1);
        const biased = Math.pow(t_norm, 1.4);
        const maxBand = Math.floor(bands.length * 0.7);
        const idx = Math.min(maxBand - 1, Math.floor(biased * maxBand));
        const h = Math.max(0.05, Math.min(1, (bands[idx] ?? 0) * 0.65 + level * 0.35 + 0.05));
        const el = refs.current[i];
        if (el) el.style.transform = `scaleY(${h})`;
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [spectrumRef]);
  return (
    <div style={{
      display: 'flex', alignItems: 'flex-end', gap: 2,
      height: 36, padding: '4px 12px 8px',
      borderTop: '1px solid rgba(255,255,255,0.05)',
      flexShrink: 0,
    }}>
      {Array.from({ length: COUNT }).map((_, i) => (
        <div key={i} ref={(el) => { refs.current[i] = el; }} style={{
          flex: 1, height: '100%', transformOrigin: 'bottom',
          background: `linear-gradient(180deg, ${accent} 0%, ${accent2} 100%)`,
          borderRadius: '1px 1px 0 0',
          opacity: 0.85,
          filter: `drop-shadow(0 0 4px ${accent}55)`,
          transform: 'scaleY(0.05)',
          transition: 'background 0.4s, opacity 0.4s',
        }} />
      ))}
    </div>
  );
}

// ── Notes ────────────────────────────────────────────────────────────────────
export function NotesTile({
  density, accent, todos, setTodos,
}: {
  density: Density;
  accent: string;
  todos: Todo[];
  setTodos: (next: Todo[]) => void;
}) {
  const [draft, setDraft] = useState('');
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  const sorted = [...todos].sort((a, b) => {
    if (a.done !== b.done) return a.done ? 1 : -1;
    return b.createdAt - a.createdAt;
  });
  const undoneCount = todos.filter((t) => !t.done).length;

  const addTodo = () => {
    const text = draft.trim();
    if (!text) return;
    const id = (typeof crypto !== 'undefined' && crypto.randomUUID)
      ? crypto.randomUUID() : `t_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    let next: Todo[] = [...todos, { id, text, done: false, createdAt: Date.now() }];
    if (next.length > 50) {
      // Drop oldest done item, or oldest of any if none are done.
      const idxDone = next.findIndex((t) => t.done);
      next.splice(idxDone >= 0 ? idxDone : 0, 1);
    }
    setTodos(next);
    setDraft('');
  };

  const toggleTodo = (id: string) => {
    setTodos(todos.map((t) => (t.id === id ? { ...t, done: !t.done } : t)));
  };

  const removeTodo = (id: string) => {
    setTodos(todos.filter((t) => t.id !== id));
  };

  return (
    <HFTile
      title="Todos"
      density={density}
      headRight={
        <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', fontFamily: '"JetBrains Mono", ui-monospace, monospace' }}>
          {undoneCount} / {todos.length}
        </span>
      }
      style={{ height: '100%' }}
    >
      <div style={{
        position: 'absolute', inset: 0, padding: 10, fontSize: 11,
        color: 'rgba(255,255,255,0.85)', lineHeight: 1.5,
        fontFamily: '"JetBrains Mono", ui-monospace, monospace',
        display: 'flex', flexDirection: 'column', gap: 2, overflow: 'hidden',
      }}>
        {todos.length === 0 && (
          <div style={{ color: 'rgba(255,255,255,0.4)' }}>No todos yet — type below to add.</div>
        )}
        <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 2 }}>
          {sorted.map((todo) => (
            <div
              key={todo.id}
              onMouseEnter={() => setHoveredId(todo.id)}
              onMouseLeave={() => setHoveredId(null)}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '2px 4px', borderRadius: 3,
                background: hoveredId === todo.id ? 'rgba(255,255,255,0.04)' : 'transparent',
              }}
            >
              <button
                onClick={() => toggleTodo(todo.id)}
                style={{
                  width: 13, height: 13, padding: 0, flexShrink: 0,
                  border: `1px solid ${todo.done ? accent : 'rgba(255,255,255,0.4)'}`,
                  background: todo.done ? accent : 'transparent',
                  borderRadius: 3, cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 9, color: '#000', fontWeight: 700, lineHeight: 1,
                }}
                aria-label={todo.done ? 'Mark not done' : 'Mark done'}
              >
                {todo.done ? '✓' : ''}
              </button>
              <span
                title={todo.text}
                style={{
                  flex: 1, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis',
                  textDecoration: todo.done ? 'line-through' : 'none',
                  color: todo.done ? 'rgba(255,255,255,0.4)' : 'rgba(255,255,255,0.85)',
                }}
              >{todo.text}</span>
              {hoveredId === todo.id && (
                <button
                  onClick={() => removeTodo(todo.id)}
                  style={{
                    background: 'transparent', border: 'none', cursor: 'pointer',
                    color: 'rgba(255,255,255,0.5)', fontSize: 12, padding: '0 2px', lineHeight: 1,
                  }}
                  aria-label="Delete todo"
                >×</button>
              )}
            </div>
          ))}
        </div>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 6, paddingTop: 6,
          borderTop: '1px solid rgba(255,255,255,0.06)', marginTop: 4, flexShrink: 0,
        }}>
          <span style={{ color: accent, width: 13, textAlign: 'center', flexShrink: 0 }}>+</span>
          <input
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); addTodo(); }
              else if (e.key === 'Escape') { e.preventDefault(); setDraft(''); }
            }}
            placeholder="Add a todo…"
            style={{
              flex: 1, background: 'transparent', border: 'none', outline: 'none',
              color: '#fff', fontFamily: 'inherit', fontSize: 11,
            }}
          />
        </div>
      </div>
    </HFTile>
  );
}

// ── Sysmon ───────────────────────────────────────────────────────────────────
export function SysMonTile({ density, accent, accent2, tempUnit }: { density: Density; accent: string; accent2: string; tempUnit: TempUnit }) {
  // Subscribes itself so the 1Hz sample stream re-renders only this tile,
  // not the App root that used to own the subscription.
  const history = useSysmon();
  const Cell = ({ k, v, sub, data, color }: { k: string; v: string; sub: string; data: number[]; color: string }) => (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6, padding: '0 14px', borderRight: '1px solid rgba(255,255,255,0.05)' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: '.08em', fontFamily: '"JetBrains Mono", ui-monospace, monospace' }}>{k}</span>
        <span style={{ fontSize: 18, fontWeight: 700, color: '#fff', fontFamily: '"JetBrains Mono", ui-monospace, monospace', lineHeight: 1 }}>{v}</span>
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>
        <Sparkline data={data} color={color} height="100%" />
      </div>
      <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)' }}>{sub}</div>
    </div>
  );
  const top = history.latest.top.slice(0, 4);
  const tempChips = tempsToChips(history.latest.temps, tempUnit);
  return (
    <HFTile title="System · live" density={density}
            headRight={<span style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)' }}>1Hz</span>}
            style={{ height: '100%' }}>
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
        <div style={{ display: 'flex', flex: 1, padding: '8px 0', minHeight: 0 }}>
          <Cell k="CPU" v={history.latest.cpu_pct_text} sub={history.latest.cpu_sub} data={history.cpu} color={accent} />
          <Cell k="RAM" v={history.latest.ram_text} sub={history.latest.ram_sub} data={history.ram} color={accent2} />
          <Cell k="GPU" v={history.latest.gpu_pct_text} sub={history.latest.gpu_sub} data={history.gpu} color="#facc15" />
          <Cell k="NET" v={history.latest.net_text} sub={history.latest.net_sub} data={history.net} color="#22c55e" />
          <div style={{ flex: 0.9, display: 'flex', flexDirection: 'column', gap: 4, padding: '0 14px', justifyContent: 'center' }}>
            <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: '.08em' }}>Top processes</div>
            {top.length === 0 && (
              <div style={{ fontSize: 10.5, fontFamily: '"JetBrains Mono", ui-monospace, monospace', color: 'rgba(255,255,255,0.3)' }}>—</div>
            )}
            {top.map((p, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10.5, fontFamily: '"JetBrains Mono", ui-monospace, monospace', color: i === 1 ? accent : 'rgba(255,255,255,0.7)' }}>
                <span>{p.name}</span><span>{p.cpu.toFixed(1)}%</span>
              </div>
            ))}
          </div>
        </div>
        {tempChips.length > 0 && (
          <div
            title={tempsTooltip(tempChips)}
            style={{
              display: 'flex', alignItems: 'center', flexShrink: 0,
              padding: '4px 14px 6px', borderTop: '1px solid rgba(255,255,255,0.05)',
              fontSize: 10, fontFamily: '"JetBrains Mono", ui-monospace, monospace',
              whiteSpace: 'nowrap', overflow: 'hidden',
            }}
          >
            {tempChips.map((c, i) => (
              <span key={c.label} style={{ color: c.color }}>
                {i > 0 && <span style={{ color: 'rgba(255,255,255,0.25)', margin: '0 6px' }}>·</span>}
                {c.text}
              </span>
            ))}
          </div>
        )}
      </div>
    </HFTile>
  );
}



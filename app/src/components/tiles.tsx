import React, { useEffect, useRef, useState, type MutableRefObject } from 'react';
import { getDensity } from '../data';
import type { Density, Track, SysmonHistory } from '../types';
import type { Todo } from '../types';
import { type Playback, type SpectrumState, mediaControls, useSpotify, type SpotifyTrack } from '../state/tauri';
import { useLyrics, currentLineIndex } from '../state/lyrics';
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
      background: 'rgba(22,24,30,0.78)',
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

// ── Discord ──────────────────────────────────────────────────────────────────
export function DiscordTile({ density, accent }: { density: Density; accent: string }) {
  const messages = [
    { user: 'maya',  color: '#fb7185', time: '14:28', text: 'pushed the new viz preset, take a look when you get a sec' },
    { user: 'me',    color: accent,    time: '14:29', text: 'omw — the radial mode looks unreal' },
    { user: 'alex',  color: '#60a5fa', time: '14:31', text: 'also the bass response is way better now 🔥' },
    { user: 'jules', color: '#a78bfa', time: '14:32', text: 'shipping the build today still?' },
  ];
  return (
    <HFTile title="Discord — # design-log" density={density}
            badge={<span style={{ background: '#22c55e', width: 6, height: 6, borderRadius: 999 }} />}
            headRight={<span style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)' }}>4 online</span>}
            style={{ height: '100%' }}>
      <div style={{ display: 'flex', height: '100%' }}>
        <div style={{ width: 44, padding: '8px 0', display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'center', borderRight: '1px solid rgba(255,255,255,0.05)', background: 'rgba(0,0,0,0.2)' }}>
          {[
            { c: accent, active: true, l: 'D' },
            { c: '#fb7185', l: 'P' },
            { c: '#60a5fa', l: 'M' },
            { c: '#a78bfa', l: 'A' },
            { c: '#facc15', l: 'G' },
          ].map((s, i) => (
            <div key={i} style={{
              width: 30, height: 30,
              borderRadius: s.active ? 9 : 999,
              background: s.active ? `linear-gradient(135deg, ${accent}, ${accent}aa)` : 'rgba(255,255,255,0.07)',
              border: s.active ? 'none' : '1px solid rgba(255,255,255,0.08)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: s.active ? '#000' : 'rgba(255,255,255,0.7)',
              fontSize: 12, fontWeight: 700,
              boxShadow: s.active ? `0 0 16px ${accent}66` : 'none',
            }}>{s.l}</div>
          ))}
        </div>
        <div style={{ width: 130, padding: '10px 8px', borderRight: '1px solid rgba(255,255,255,0.05)' }}>
          <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 8, padding: '0 6px' }}>Channels</div>
          {[
            { n: '# general' },
            { n: '# design-log', active: true, unread: 2 },
            { n: '# eng' },
            { n: '# random' },
            { n: '# music', unread: 5 },
          ].map((c) => (
            <div key={c.n} style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '5px 8px', fontSize: 11.5, color: c.active ? '#fff' : 'rgba(255,255,255,0.6)',
              background: c.active ? 'rgba(255,255,255,0.06)' : 'transparent',
              borderRadius: 5, marginBottom: 1,
            }}>
              <span>{c.n}</span>
              {c.unread != null && <span style={{ background: accent, color: '#000', fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 6 }}>{c.unread}</span>}
            </div>
          ))}
        </div>
        <div style={{ flex: 1, padding: 12, display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0, overflow: 'hidden' }}>
          {messages.map((m, i) => (
            <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
              <div style={{ width: 26, height: 26, borderRadius: 999, background: m.color + '33', border: `1px solid ${m.color}66`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: m.color, fontSize: 11, fontWeight: 700, flexShrink: 0 }}>
                {m.user[0].toUpperCase()}
              </div>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                  <span style={{ fontSize: 11.5, fontWeight: 600, color: m.color }}>{m.user}</span>
                  <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)' }}>{m.time}</span>
                </div>
                <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.85)', lineHeight: 1.45 }}>{m.text}</div>
              </div>
            </div>
          ))}
          <div style={{ flex: 1 }} />
          <div style={{ background: 'rgba(0,0,0,0.3)', borderRadius: 8, padding: '8px 10px', fontSize: 11, color: 'rgba(255,255,255,0.4)', border: '1px solid rgba(255,255,255,0.05)' }}>
            Message # design-log
          </div>
        </div>
      </div>
    </HFTile>
  );
}

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

export function SpotifyTile({ density, accent, accent2, track, onPick: _onPick, playback, spectrumRef }: {
  density: Density;
  accent: string;
  accent2: string;
  track: Track;
  onPick: (t: Track) => void;
  playback?: Playback | null;
  spectrumRef?: MutableRefObject<SpectrumState>;
}) {
  const [tab, setTab] = useState<SpotifyTab>('now');
  return (
    <HFTile
      title="Now playing"
      density={density}
      badge={<SpotifyBadge playback={playback} accent={accent} />}
      style={{ height: '100%' }}
    >
      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <SpotifyTabBar tab={tab} setTab={setTab} accent={accent} />
        <div style={{ flex: 1, minHeight: 0, position: 'relative', display: 'flex', flexDirection: 'column' }}>
          {tab === 'now' && (
            <SpotifyNowView
              accent={accent} accent2={accent2} track={track}
              playback={playback} spectrumRef={spectrumRef}
            />
          )}
          {tab === 'lyrics' && <SpotifyLyricsView accent={accent} playback={playback} />}
          {tab === 'upnext' && <SpotifyUpNextView accent={accent} />}
        </div>
      </div>
    </HFTile>
  );
}

function SpotifyBadge({ playback, accent }: { playback?: Playback | null; accent: string }) {
  const liveBadgeColor = playback?.playing ? '#22c55e' : accent;
  const liveBadgeText = playback ? (playback.playing ? '● LIVE' : '⏸ PAUSED') : '● LIVE';
  return (
    <span style={{ fontSize: 9, color: liveBadgeColor, padding: '2px 6px', borderRadius: 4, background: liveBadgeColor + '15', border: `1px solid ${liveBadgeColor}33`, letterSpacing: '.05em' }}>
      {liveBadgeText}
    </span>
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

function SpotifyNowView({ accent, accent2, track, playback, spectrumRef }: {
  accent: string; accent2: string; track: Track;
  playback?: Playback | null;
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
      {/* Spotify Web API volume */}
      <SpotifyVolumeRow accent={accent} accent2={accent2} />
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

  if (state.premium_required) {
    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        <SpotifyConnectionHeader onDisconnect={() => disconnect()} />
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
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'rgba(255,255,255,0.45)', fontSize: 11 }}>
          Nothing queued.
        </div>
      </div>
    );
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <SpotifyConnectionHeader onDisconnect={() => disconnect()} />
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
    const tick = () => {
      const bands = spectrumRef.current.bands;
      const live = spectrumRef.current.live;
      const level = spectrumRef.current.level;
      for (let i = 0; i < COUNT; i++) {
        let h: number;
        if (live && bands.length > 0) {
          // Map across the energetic lower-mid range (same trick as the
          // viz hero waveform — the highest bands are usually silent).
          const t_norm = i / (COUNT - 1);
          const biased = Math.pow(t_norm, 1.4);
          const maxBand = Math.floor(bands.length * 0.7);
          const idx = Math.min(maxBand - 1, Math.floor(biased * maxBand));
          h = Math.max(0.05, Math.min(1, (bands[idx] ?? 0) * 0.65 + level * 0.35 + 0.05));
        } else {
          h = 0.08;
        }
        const el = refs.current[i];
        if (el) el.style.transform = `scaleY(${h})`;
      }
      raf = requestAnimationFrame(tick);
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

// ── Today calendar ───────────────────────────────────────────────────────────
export function CalendarTile({ density, accent }: { density: Density; accent: string }) {
  const events = [
    { time: '15:00', title: 'Standup', dur: '15m', color: '#22c55e', soon: true },
    { time: '16:00', title: 'Focus block · viz tuning', dur: '90m', color: accent },
    { time: '17:30', title: 'Design review w/ Maya', dur: '45m', color: '#fb7185' },
  ];
  return (
    <HFTile title="Today · Apr 29" density={density}
            headRight={<span style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)' }}>4 events</span>}
            style={{ height: '100%' }}>
      <div style={{ position: 'absolute', inset: 0, padding: 10, display: 'flex', flexDirection: 'column', gap: 6, overflow: 'hidden' }}>
        {events.map((e, i) => (
          <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <div style={{ width: 3, height: 28, background: e.color, borderRadius: 2, flexShrink: 0, boxShadow: e.soon ? `0 0 8px ${e.color}` : 'none' }} />
            <div style={{ minWidth: 50, fontSize: 11, fontFamily: '"JetBrains Mono", ui-monospace, monospace', color: e.soon ? '#fff' : 'rgba(255,255,255,0.6)' }}>{e.time}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.title}</div>
              <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)' }}>{e.dur}{e.soon && ' · in 28 min'}</div>
            </div>
          </div>
        ))}
      </div>
    </HFTile>
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

// ── Web tile (Linear) ────────────────────────────────────────────────────────
export function WebTile({ density, accent, url, title }: { density: Density; accent: string; url: string; title: string }) {
  return (
    <HFTile title={title} density={density}
            headRight={<span style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', fontFamily: '"JetBrains Mono", ui-monospace, monospace' }}>{url}</span>}
            style={{ height: '100%' }}>
      <div style={{ position: 'absolute', inset: 0, padding: 10, display: 'flex', flexDirection: 'column', gap: 6, overflow: 'hidden' }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', paddingBottom: 6, borderBottom: '1px solid rgba(255,255,255,0.06)', flexShrink: 0 }}>
          <div style={{ width: 22, height: 22, borderRadius: 5, background: `linear-gradient(135deg, ${accent}, ${accent}88)` }} />
          <div style={{ fontSize: 12, fontWeight: 600 }}>Linear · Inbox</div>
          <div style={{ flex: 1 }} />
          <span style={{ fontSize: 10, color: accent, padding: '2px 6px', background: accent + '15', borderRadius: 4 }}>3 new</span>
        </div>
        {[
          { p: 'M2-441', t: 'Visualizer ambient idle drop', s: 'In Progress', c: '#facc15' },
          { p: 'M2-442', t: 'Top processes drilldown', s: 'Todo', c: '#94a3b8' },
          { p: 'M2-438', t: 'WebView2 shared env', s: 'In Review', c: accent },
        ].map((t) => (
          <div key={t.p} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '6px 4px' }}>
            <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', fontFamily: '"JetBrains Mono", ui-monospace, monospace', minWidth: 50 }}>{t.p}</span>
            <span style={{ fontSize: 12, flex: 1, color: '#fff' }}>{t.t}</span>
            <span style={{ fontSize: 10, color: t.c, padding: '2px 6px', background: t.c + '15', borderRadius: 3 }}>{t.s}</span>
          </div>
        ))}
      </div>
    </HFTile>
  );
}

// ── Sysmon ───────────────────────────────────────────────────────────────────
export function SysMonTile({ density, accent, accent2, history }: { density: Density; accent: string; accent2: string; history: SysmonHistory }) {
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
  const top = history.latest.top.length > 0
    ? history.latest.top.slice(0, 4)
    : [
        { name: 'chrome.exe', cpu: 12.4 },
        { name: 'Hub.exe', cpu: 1.2 },
        { name: 'Discord.exe', cpu: 3.1 },
        { name: 'Code.exe', cpu: 4.7 },
      ];
  return (
    <HFTile title="System · live" density={density}
            headRight={<span style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)' }}>1Hz · Ryzen 7 / RTX 4070</span>}
            style={{ height: '100%' }}>
      <div style={{ display: 'flex', height: '100%', padding: '8px 0', minHeight: 0 }}>
        <Cell k="CPU" v={history.latest.cpu_pct_text} sub={history.latest.cpu_sub} data={history.cpu} color={accent} />
        <Cell k="RAM" v={history.latest.ram_text} sub={history.latest.ram_sub} data={history.ram} color={accent2} />
        <Cell k="GPU" v={history.latest.gpu_pct_text} sub={history.latest.gpu_sub} data={history.gpu} color="#facc15" />
        <Cell k="NET" v={history.latest.net_text} sub={history.latest.net_sub} data={history.net} color="#22c55e" />
        <div style={{ flex: 0.9, display: 'flex', flexDirection: 'column', gap: 4, padding: '0 14px', justifyContent: 'center' }}>
          <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: '.08em' }}>Top processes</div>
          {top.map((p, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10.5, fontFamily: '"JetBrains Mono", ui-monospace, monospace', color: i === 1 ? accent : 'rgba(255,255,255,0.7)' }}>
              <span>{p.name}</span><span>{p.cpu.toFixed(1)}%</span>
            </div>
          ))}
        </div>
      </div>
    </HFTile>
  );
}

// ── Clock ────────────────────────────────────────────────────────────────────
export function ClockTile({ density, accent, accent2 }: { density: Density; accent: string; accent2: string }) {
  const [time, setTime] = React.useState(() => new Date());
  React.useEffect(() => {
    const id = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  const hh = String(time.getHours()).padStart(2, '0');
  const mm = String(time.getMinutes()).padStart(2, '0');
  const ss = String(time.getSeconds()).padStart(2, '0');
  return (
    <HFTile title="Now" density={density}
            headRight={<span style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)' }}>Knoxville</span>}
            style={{ height: '100%' }}>
      <div style={{ padding: 12, height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', minHeight: 0, overflow: 'hidden' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
            <span style={{ fontSize: 44, fontWeight: 700, fontFamily: '"JetBrains Mono", ui-monospace, monospace', letterSpacing: '-0.04em', lineHeight: 0.9, color: '#fff' }}>{hh}:{mm}</span>
            <span style={{ fontSize: 18, fontWeight: 500, fontFamily: '"JetBrains Mono", ui-monospace, monospace', color: accent, lineHeight: 1 }}>:{ss}</span>
          </div>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', marginTop: 6 }}>
            {time.toLocaleDateString(undefined, { weekday: 'short', month: 'long', day: 'numeric' })} · Week {weekNumber(time)}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 36, height: 36, borderRadius: 999, background: `linear-gradient(135deg, ${accent2}, ${accent})`, position: 'relative', overflow: 'hidden', flexShrink: 0 }}>
            <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(circle at 30% 30%, rgba(255,255,255,0.4), transparent 60%)' }} />
          </div>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: '#fff', fontFamily: '"JetBrains Mono", ui-monospace, monospace' }}>62°</div>
            <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.5)' }}>partly cloudy · feels 60°</div>
          </div>
        </div>
      </div>
    </HFTile>
  );
}

function weekNumber(d: Date): number {
  const onejan = new Date(d.getFullYear(), 0, 1);
  return Math.ceil(((d.getTime() - onejan.getTime()) / 86400000 + onejan.getDay() + 1) / 7);
}

// ── Up next strip ────────────────────────────────────────────────────────────
export function UpNextTile({ density, accent }: { density: Density; accent: string }) {
  return (
    <HFTile title="Up next" density={density}
            headRight={<span style={{ fontSize: 10, color: '#22c55e' }}>● in 28m</span>}
            style={{ height: '100%' }}>
      <div style={{ padding: 12, height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', minHeight: 0, overflow: 'hidden' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <span style={{ fontSize: 10, color: '#22c55e', textTransform: 'uppercase', letterSpacing: '.08em', fontWeight: 700 }}>● Standup</span>
            <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', fontFamily: '"JetBrains Mono", ui-monospace, monospace' }}>15:00 — 15:15</span>
          </div>
          <div style={{ fontSize: 14, fontWeight: 500, color: '#fff', marginBottom: 12 }}>Daily standup · Design</div>
          <div style={{ display: 'flex', marginBottom: 10 }}>
            {['#fb7185', '#60a5fa', '#a78bfa', accent].map((c, i) => (
              <div key={i} style={{ width: 22, height: 22, borderRadius: 999, background: c + '33', border: '2px solid #16181c', marginLeft: i ? -6 : 0, fontSize: 10, color: c, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700 }}>
                {['M', 'A', 'J', 'Y'][i]}
              </div>
            ))}
            <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.5)', alignSelf: 'center', marginLeft: 8 }}>4 attendees</span>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button style={{ flex: 1, background: accent, color: '#000', border: 'none', borderRadius: 6, padding: '8px 10px', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>Join Zoom</button>
          <button style={{ background: 'rgba(255,255,255,0.06)', color: '#fff', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 6, padding: '8px 10px', fontSize: 11, cursor: 'pointer' }}>Snooze</button>
        </div>
      </div>
    </HFTile>
  );
}

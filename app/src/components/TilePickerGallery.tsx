import React, { useEffect } from 'react';
import type { TileType, TileInstance, Rect, Orientation } from '../state/layout';
import {
  DEFAULT_LANDSCAPE_LAYOUT,
  DEFAULT_PORTRAIT_LAYOUT,
  findEmptyRect,
  findInstance,
} from '../state/layout';

const TILE_META: Record<TileType, { icon: string; label: string; description: string; multiInstance: boolean }> = {
  viz:     { icon: '◢', label: 'Audio visualizer',  description: '27 styles reactive to system audio',  multiInstance: false },
  spotify: { icon: '♪', label: 'Now playing',       description: 'Track, lyrics, queue, volume',         multiInstance: false },
  discord: { icon: '◇', label: 'Discord voice',     description: 'Voice channel members + speaking',     multiInstance: false },
  claude:  { icon: '⌘', label: 'Claude Code',       description: 'Active session log',                   multiInstance: false },
  mixer:   { icon: '♬', label: 'Audio mixer',       description: 'Master volume + per-app sessions',     multiInstance: false },
  notes:   { icon: '✎', label: 'Todos',             description: 'Quick task list',                      multiInstance: false },
  sysmon:  { icon: '▤', label: 'System monitor',    description: 'CPU / RAM / GPU / network',            multiInstance: false },
  clock:   { icon: '◐', label: 'Now & forecast',    description: 'Time + weather',                       multiInstance: false },
  streamDeck: { icon: '▦', label: 'Stream Deck',     description: 'Programmable button grid — actions, profile switching, playback', multiInstance: true },
  weatherRadar: { icon: '☂', label: 'Weather radar',  description: 'Animated precipitation map centered on your saved location', multiInstance: false },
  pomodoro: { icon: '◷', label: 'Pomodoro', description: 'Focus / break interval timer with daily counter', multiInstance: false },
  sun: { icon: '☀', label: 'Sun & golden hour', description: 'Sunrise, sunset, golden hour times for your saved location', multiInstance: false },
  aurora: { icon: '🌌', label: 'Aurora & moon', description: 'KP index, aurora visibility, moon phase', multiInstance: false },
  airQuality: { icon: '🌫', label: 'Air quality', description: 'AQI, UV index, PM2.5/PM10 for your saved location', multiInstance: false },
  stocks: { icon: '📈', label: 'Stock ticker', description: 'Live quotes for your watchlist (configurable)', multiInstance: true },
  tides: { icon: '🌊', label: 'Tide chart', description: 'Next high/low tides from NOAA station', multiInstance: false },
  githubPrs: { icon: '⊕', label: 'GitHub PRs', description: 'Open pull requests assigned, requested, authored', multiInstance: false },
  streamChat: { icon: '💬', label: 'Stream chat', description: 'Live Twitch chat scroll for any channel', multiInstance: true },
  phoneNotifs: { icon: '📱', label: 'Phone notifs', description: 'Mirror phone notifications via ntfy.sh topic', multiInstance: false },
  homeAssistant: { icon: '🏠', label: 'Smart home', description: 'Home Assistant entities — toggle, status', multiInstance: false },
  scratchpad: { icon: '✎', label: 'Scratchpad', description: 'Free-form notes that persist per tile', multiInstance: true },
  quote: { icon: '❝', label: 'Quote of the day', description: 'Daily inspirational quote', multiInstance: false },
  onThisDay: { icon: '📜', label: 'On this day', description: 'Wikipedia events / births / deaths from history', multiInstance: false },
  randomWiki: { icon: '🎲', label: 'Random Wikipedia', description: 'Refreshes hourly — ambient learning engine', multiInstance: false },
  wordOfDay: { icon: '📖', label: 'Word of the day', description: 'Definition + etymology of an interesting word', multiInstance: false },
  iss: { icon: '🛰', label: 'ISS · live', description: 'International Space Station position + map dot', multiInstance: false },
  launches: { icon: '🚀', label: 'Space launches', description: 'Upcoming rocket launches with countdown', multiInstance: false },
  dailyChallenge: { icon: '⚡', label: 'Daily challenge', description: 'LeetCode daily problem with difficulty + topics', multiInstance: false },
  pollen: { icon: '🌾', label: 'Pollen & smoke', description: 'Pollen counts (grass, ragweed, …) + wildfire PM2.5', multiInstance: false },
  birds: { icon: '🐦', label: 'Recent birds', description: 'eBird observations near you (needs free key)', multiInstance: false },
  solarFlare: { icon: '☀', label: 'Sun · X-ray', description: 'NOAA flare class + live SDO sun image', multiInstance: false },
  lightning: { icon: '⚡', label: 'Lightning · live', description: 'Real-time strikes within 800 km via Blitzortung', multiInstance: false },
  aircraft: { icon: '✈', label: 'Aircraft overhead', description: 'Live planes within 80 km via OpenSky Network', multiInstance: false },
  activeWindow: { icon: '🪟', label: 'Active windows', description: 'Time spent per app today', multiInstance: false },
  docker: { icon: '🐳', label: 'Docker', description: 'Local container list + running state', multiInstance: false },
  energy: { icon: '⚡', label: 'Energy', description: 'Solar production + grid consumption from HA', multiInstance: false },
};

const ORDER: TileType[] = [
  'viz', 'spotify', 'discord', 'claude', 'mixer', 'notes', 'sysmon', 'clock',
  'streamDeck', 'weatherRadar', 'pomodoro', 'sun', 'aurora',
  'airQuality', 'stocks', 'tides', 'githubPrs', 'streamChat',
  'phoneNotifs', 'homeAssistant',
  'scratchpad', 'quote', 'onThisDay', 'randomWiki', 'wordOfDay',
  'iss', 'launches', 'dailyChallenge', 'pollen', 'birds',
  'solarFlare', 'lightning', 'aircraft', 'activeWindow', 'docker', 'energy',
];

export function TilePickerGallery({
  orientation, canvas, tiles, profileName, accent,
  onAdd, onRemove, onClose,
}: {
  orientation: Orientation;
  canvas: { w: number; h: number };
  tiles: TileInstance[];
  profileName: string;
  accent: string;
  onAdd: (type: TileType, rect: Rect) => void;
  onRemove: (instanceId: string) => void;
  onClose: () => void;
}) {
  // Esc closes the modal.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  const defaults = orientation === 'portrait' ? DEFAULT_PORTRAIT_LAYOUT : DEFAULT_LANDSCAPE_LAYOUT;

  const visibleRects = tiles.map((t) => t.rect);

  const handleClick = (type: TileType) => {
    const meta = TILE_META[type];

    if (meta.multiInstance) {
      // Always add a new instance — multi-instance types never toggle from the gallery.
      const preferred = defaults[type];
      const rect = findEmptyRect(visibleRects, preferred, canvas);
      onAdd(type, rect);
      onClose();
      return;
    }

    // Singleton path
    const existingInstance = findInstance(tiles, type);
    if (!existingInstance) {
      const preferred = defaults[type];
      const rect = findEmptyRect(visibleRects, preferred, canvas);
      onAdd(type, rect);
      onClose();
    } else if (type === 'viz') {
      // Viz cannot be removed. Defensive guard; the card is also rendered
      // disabled below.
      return;
    } else {
      onRemove(existingInstance.instanceId);
      onClose();
    }
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: 'absolute', inset: 0, zIndex: 70,
        background: 'rgba(8,9,12,0.55)', backdropFilter: 'blur(2px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(720px, 90%)', maxHeight: '80%',
          background: 'rgba(20,22,28,0.98)', backdropFilter: 'blur(20px)',
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: 12, boxShadow: '0 24px 60px rgba(0,0,0,0.5)',
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div style={{
          padding: '14px 18px', borderBottom: '1px solid rgba(255,255,255,0.06)',
          display: 'flex', alignItems: 'center', gap: 10,
        }}>
          <div style={{ width: 8, height: 8, background: accent, borderRadius: 2 }} />
          <span style={{ fontSize: 13, fontWeight: 600, color: '#fff' }}>Tiles</span>
          <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)', fontFamily: '"JetBrains Mono", ui-monospace, monospace' }}>
            · "{profileName}"
          </span>
          <button onClick={onClose} title="Close" style={{
            marginLeft: 'auto', padding: '4px 10px', fontSize: 12,
            background: 'transparent', color: 'rgba(255,255,255,0.55)',
            border: '1px solid rgba(255,255,255,0.1)', borderRadius: 5, cursor: 'pointer',
          }}>×</button>
        </div>

        {/* Card grid */}
        <div style={{
          padding: 14, overflow: 'auto',
          display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12,
        }}>
          {ORDER.map((id) => {
            const meta = TILE_META[id];
            const instanceCount = tiles.filter((t) => t.type === id).length;
            const isHidden = instanceCount === 0;
            const isViz = id === 'viz';
            const disabled = isViz && instanceCount > 0;
            const cursor = disabled ? 'not-allowed' : 'pointer';
            const title = disabled ? 'The visualizer cannot be hidden' : meta.description;
            return (
              <button
                key={id}
                onClick={() => !disabled && handleClick(id)}
                title={title}
                style={{
                  position: 'relative',
                  display: 'flex', flexDirection: 'column',
                  alignItems: 'center', justifyContent: 'center',
                  gap: 8, padding: 14,
                  height: 140,
                  background: isHidden ? 'rgba(255,255,255,0.03)' : `${accent}10`,
                  border: isHidden ? '1px solid rgba(255,255,255,0.08)' : `1px solid ${accent}55`,
                  borderRadius: 10, cursor,
                  color: 'rgba(255,255,255,0.85)',
                  opacity: disabled ? 0.55 : 1,
                  transition: 'background .12s, border-color .12s',
                }}
              >
                {/* "Added" badge in top-right corner when visible */}
                {instanceCount > 0 && (
                  <span style={{
                    position: 'absolute', top: 6, right: 8,
                    fontSize: 10, fontWeight: 700,
                    color: accent, fontFamily: '"JetBrains Mono", ui-monospace, monospace',
                  }}>{meta.multiInstance ? `×${instanceCount}` : '+'}</span>
                )}
                <span style={{ fontSize: 28, lineHeight: 1 }}>{meta.icon}</span>
                <span style={{ fontSize: 12, fontWeight: 600 }}>{meta.label}</span>
                <span style={{
                  fontSize: 10, color: 'rgba(255,255,255,0.45)',
                  textAlign: 'center', lineHeight: 1.3,
                  display: '-webkit-box', WebkitLineClamp: 2 as any, WebkitBoxOrient: 'vertical' as any,
                  overflow: 'hidden',
                }}>
                  {meta.description}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

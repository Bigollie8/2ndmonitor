import { UpdateCheckRow } from './UpdateCheckRow';
import React, { useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type { VizMode, AccentTheme, Density, WeatherLocation } from '../types';
import type { AudioSource } from '../state/audioSource';
import type { ClockFormatSetting } from '../state/dateTime';
import type { TempUnitSetting, WindUnitSetting } from '../state/units';
import { effectiveSensitivity, sourceKey } from '../state/audioSource';
import { AudioSourcePicker } from './AudioSourcePicker';
import { useAudioSource } from '../state/useAudioSource';
import type { AudioSourceState, SourceOption } from '../state/useAudioSource';
import type { GeocodeResult } from '../state/weatherLocation';
import { redactLocation, REDACTED_TEXT } from '../state/streamer';
import { ACCENT_PALETTES } from '../data';
import { useVizStyles } from './useVizStyles';
import { defaultBookmarks, type Bookmark } from './browser-player';
import { isTauri } from '../state/tauri';
import { IS_MAC } from '../state/platform';
import {
  LS_URL, LS_PUBKEY, DEFAULT_URL, DEFAULT_PUBKEY, cfgUrl, cfgPubkey, isDefaultServer,
} from '../state/marketplaceConfig';

const MONO = '"JetBrains Mono", ui-monospace, monospace';
const HAIRLINE = '1px solid rgba(255,255,255,0.05)';

// Shared by MarketplaceServerEditor and MarketplaceAccountEditor — both are
// label-above-input stacked fields inside the Marketplace pane.
const fieldInputStyle: React.CSSProperties = {
  width: '100%', fontSize: 11.5, padding: '6px 9px', marginTop: 3,
  background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.08)',
  borderRadius: 6, color: '#fff', outline: 'none', boxSizing: 'border-box',
};
const fieldLabelStyle: React.CSSProperties = {
  fontSize: 10.5, color: 'rgba(255,255,255,0.45)',
};

export type PerfMode = 'uncapped' | 'high' | 'balanced' | 'battery' | 'custom';

export interface VizColorOverride {
  enabled: boolean;
  accent: string;
  accent2: string;
}

/** The slice of tweak state the Settings window reads/writes. Kept narrow on
 *  purpose — App's full TweakState (profiles, todos, pomodoro, …) stays out. */
export interface SettingsValues {
  vizMode: VizMode;
  vizArtBg: boolean;
  /** What the visualizer listens to — the whole system mix, or one app
   *  included/excluded. See state/audioSource.ts. */
  vizAudioSource: AudioSource;
  vizSensitivityBySource: Record<string, number>;
  vizSmoothing: number;
  /** Adaptive gain for the visualizer (0.8.6). */
  vizAutoGain: boolean;
  vizColorOverride: VizColorOverride;
  lyricsOverlayEnabled: boolean;
  accentTheme: AccentTheme;
  density: Density;
  weatherLocation: WeatherLocation;
  perfMode: PerfMode;
  perfCustomFps: number;
  perfCustomDpr: number;
  perfCustomAudioHz: number;
  perfDebug: boolean;
  audioDebug: boolean;
  videoEnabled: boolean;
  videoBookmarks: Bookmark[];
  closeToTray: boolean;
  /** Liquid glass — translucent surfaces + acrylic. See state/theme.ts. */
  glassEnabled: boolean;
  /** 0–100; 0 = clear glass, 100 = most opaque frosted. */
  glassStrength: number;
  /** Auto-hide top bar — slides away until the mouse hits the top edge. */
  autoHideTopBar: boolean;
  /** Streamer mode — hides maps and location details in every tile. */
  streamerMode: boolean;
  /** Platform-wide clock format — every clock in the app (0.7.2 §3). */
  clockFormat: ClockFormatSetting;
  /** Platform-wide temperature unit — weather tiles + temps strip (0.7.2 §3). */
  tempUnit: TempUnitSetting;
  /** Platform-wide wind-speed unit — forecast tile (0.8.1). */
  windUnit: WindUnitSetting;
  /** The catalog removal list — see state/removedContent.ts. Needed here
   *  because the Visualizer pane's style dropdown is a picker. */
  catalogRemoved: string[];
}

export type SettingsSetter = <K extends keyof SettingsValues>(key: K, value: SettingsValues[K]) => void;

/** Launch-at-startup state backed by the tauri-plugin-autostart registry
 *  entry (Windows) / login item (macOS). The plugin is the source of truth
 *  — no Tweaks persistence — so the toggle always reflects what the OS will
 *  actually do at next login. `enabled === null` means "still loading"
 *  (control should be disabled). */
export function useAutostart(): [boolean | null, (next: boolean) => void] {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  useEffect(() => {
    if (!isTauri) { setEnabled(false); return; }
    let cancelled = false;
    void import('@tauri-apps/plugin-autostart')
      .then(({ isEnabled }) => isEnabled())
      .then((v) => { if (!cancelled) setEnabled(v); })
      .catch(() => { if (!cancelled) setEnabled(false); });
    return () => { cancelled = true; };
  }, []);
  const toggle = useCallback((next: boolean) => {
    setEnabled(next);
    void (async () => {
      try {
        const { enable, disable } = await import('@tauri-apps/plugin-autostart');
        if (next) await enable(); else await disable();
      } catch (err) {
        console.warn('autostart toggle failed', err);
        setEnabled(!next);
      }
    })();
  }, []);
  return [enabled, toggle];
}

// ---------------------------------------------------------------------------
// Row + pane model. Every setting is ONE row: label + hint left, control
// right (or below when `stacked`). Search filters rows across all panes by
// substring on label + hint.
// ---------------------------------------------------------------------------

interface RowDef {
  id: string;
  label: string;
  hint?: string;
  /** Full-width control rendered below the label instead of to its right. */
  stacked?: boolean;
  control: ReactNode;
}

interface PaneDef {
  id: string;
  icon: string;
  title: string;
  rows: RowDef[];
}

export function SettingsWindow({
  values: v, set, accent, accent2, accentLinked, trackTitle,
  onOpenContentLibrary, onOpenMarket, onOpenProfile, onOpenCommunity, onReplayOnboarding, onResetLayout, onExportSettings, onImportSettings, onClose,
}: {
  values: SettingsValues;
  set: SettingsSetter;
  accent: string;
  accent2: string;
  accentLinked: boolean;
  trackTitle: string;
  /** Closes Settings and opens the content library (App owns both). */
  onOpenContentLibrary?: () => void;
  /** Closes Settings and opens the full-bleed market (App owns both). */
  onOpenMarket?: () => void;
  /** Closes Settings and opens the profile popout (App owns both). */
  onOpenProfile?: () => void;
  /** Closes Settings and opens the community home (App owns both). */
  onOpenCommunity?: () => void;
  onReplayOnboarding: () => void;
  onResetLayout: () => void;
  onExportSettings?: () => void;
  onImportSettings?: () => void;
  onClose: () => void;
}) {
  const [activePane, setActivePane] = useState('visualizer');
  const [query, setQuery] = useState('');
  const { styles: vizStyles } = useVizStyles(v.catalogRemoved);
  const { options: sourceOptions, status: audioSourceStatus } = useAudioSource();
  const panes: PaneDef[] = [
    {
      id: 'visualizer', icon: '◢', title: 'Visualizer',
      rows: [
        {
          id: 'viz-style', label: 'Style',
          hint: 'Rendering style for the audio visualizer — press V to cycle',
          control: (
            <SettingsSelect<VizMode>
              value={v.vizMode}
              options={vizStyles.map((s) => ({
                value: s.id,
                label: s.label,
                group: s.source === 'bundle' ? 'Installed' : undefined,
              }))}
              onChange={(m) => set('vizMode', m)}
            />
          ),
        },
        {
          id: 'viz-artbg', label: 'Album-art backdrop',
          hint: 'Blur the current album art behind the visualizer',
          control: <Toggle checked={v.vizArtBg} onChange={(c) => set('vizArtBg', c)} accent={accent} />,
        },
        {
          id: 'viz-audio-source', label: 'Audio source',
          hint: 'Which apps the visualizer reacts to — up to 4, or the whole mix',
          control: (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
              {/* Not gated on `supported`: an explicit pick is exactly what
                  re-arms per-app capture on the Rust side, so disabling the
                  picker on a sticky `supported: false` would remove the only
                  way to ask again. */}
              <AudioSourcePicker
                value={v.vizAudioSource}
                options={sourceOptions}
                onChange={(s) => set('vizAudioSource', s)}
                accent={accent}
              />
              <AudioSourceStatusLine status={audioSourceStatus} options={sourceOptions} />
            </div>
          ),
        },
        {
          id: 'viz-sensitivity', label: 'Sensitivity',
          hint: 'Input gain for the selected source — remembered per source',
          control: (
            <SliderControl
              value={effectiveSensitivity(v.vizSensitivityBySource, v.vizAudioSource)} min={0.3} max={2.5} step={0.05}
              format={(x) => `${x.toFixed(2)}×`} accent={accent}
              onChange={(x) => set('vizSensitivityBySource', { ...v.vizSensitivityBySource, [sourceKey(v.vizAudioSource)]: x })}
            />
          ),
        },
        {
          id: 'viz-auto-gain', label: 'Adaptive gain',
          hint: 'Boost quiet playback so reactivity doesn’t depend on app volume — loud playback is unchanged',
          control: <Toggle checked={v.vizAutoGain} onChange={(c) => set('vizAutoGain', c)} accent={accent} />,
        },
        {
          id: 'viz-smoothing', label: 'Smoothing',
          hint: 'Temporal smoothing — higher is calmer, slower to react',
          control: (
            <SliderControl
              value={v.vizSmoothing} min={0} max={0.95} step={0.05}
              format={(x) => x.toFixed(2)} accent={accent}
              onChange={(x) => set('vizSmoothing', x)}
            />
          ),
        },
        {
          id: 'viz-color-override', label: 'Color override',
          hint: 'Fixed accent / accent2 for the visualizer only, ignoring the theme',
          control: (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {v.vizColorOverride.enabled && (
                <>
                  <input
                    type="color" value={v.vizColorOverride.accent}
                    onChange={(e) => set('vizColorOverride', { ...v.vizColorOverride, accent: e.target.value })}
                    style={colorInputStyle} title="Viz accent"
                  />
                  <input
                    type="color" value={v.vizColorOverride.accent2}
                    onChange={(e) => set('vizColorOverride', { ...v.vizColorOverride, accent2: e.target.value })}
                    style={colorInputStyle} title="Viz accent2"
                  />
                </>
              )}
              <Toggle
                checked={v.vizColorOverride.enabled}
                onChange={(c) => set('vizColorOverride', { ...v.vizColorOverride, enabled: c })}
                accent={accent}
              />
            </div>
          ),
        },
        {
          id: 'viz-lyrics', label: 'Lyrics overlay',
          hint: 'Show synced lyrics over the visualizer',
          control: <Toggle checked={v.lyricsOverlayEnabled} onChange={(c) => set('lyricsOverlayEnabled', c)} accent={accent} />,
        },
      ],
    },
    {
      id: 'appearance', icon: '◐', title: 'Appearance',
      rows: [
        {
          id: 'appearance-accent', label: 'Accent theme',
          hint: accentLinked ? `Theme-linked — colors come from "${trackTitle}"` : 'Manual palette',
          control: (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ display: 'flex', gap: 4 }}>
                <div style={{ width: 18, height: 18, borderRadius: 4, background: accent, border: '1px solid rgba(255,255,255,0.15)' }} />
                <div style={{ width: 18, height: 18, borderRadius: 4, background: accent2, border: '1px solid rgba(255,255,255,0.15)' }} />
              </div>
              <SettingsSelect<AccentTheme>
                value={v.accentTheme}
                options={(Object.keys(ACCENT_PALETTES) as AccentTheme[]).map((k) => ({ value: k, label: ACCENT_PALETTES[k].label }))}
                onChange={(x) => set('accentTheme', x)}
              />
            </div>
          ),
        },
        {
          id: 'appearance-density', label: 'Tile density',
          hint: 'Padding and type scale inside tiles',
          control: (
            <Segmented<Density>
              value={v.density}
              options={['compact', 'regular', 'spacious']}
              onChange={(x) => set('density', x)}
              accent={accent}
            />
          ),
        },
        {
          id: 'appearance-clock-format', label: 'Time format',
          hint: 'Every clock in the app — System follows your OS locale',
          control: (
            <Segmented<ClockFormatSetting>
              value={v.clockFormat}
              options={['system', '12h', '24h']}
              labels={{ system: 'System' }}
              onChange={(x) => set('clockFormat', x)}
              accent={accent}
            />
          ),
        },
        {
          id: 'appearance-glass', label: 'Liquid glass',
          hint: 'See the desktop through the app (Windows acrylic). Adds GPU cost on top of the visualizer and can stutter while dragging the window.',
          control: <Toggle checked={v.glassEnabled} onChange={(c) => set('glassEnabled', c)} accent={accent} />,
        },
        {
          id: 'appearance-glass-strength', label: 'Glass strength',
          hint: '0 = clear glass, 100 = opaque frosted',
          control: (
            <SliderControl
              value={v.glassStrength} min={0} max={100} step={1}
              format={(x) => `${Math.round(x)}`}
              accent={accent}
              onChange={(x) => set('glassStrength', x)}
            />
          ),
        },
        {
          id: 'appearance-autohide-topbar', label: 'Auto-hide top bar',
          hint: 'Slides away until you move the mouse to the top edge',
          control: <Toggle checked={v.autoHideTopBar} onChange={(c) => set('autoHideTopBar', c)} accent={accent} />,
        },
        {
          id: 'appearance-streamer', label: 'Streamer mode',
          hint: "Hides maps and location details so screenshares can't reveal where you are",
          control: <Toggle checked={v.streamerMode} onChange={(c) => set('streamerMode', c)} accent={accent} />,
        },
      ],
    },
    {
      id: 'tiles', icon: '⊞', title: 'Tiles',
      rows: [
        {
          id: 'content-library', label: 'Content library',
          hint: 'Add and remove tiles and visualizers for the active profile from one place — search, categories, and explicit per-item controls.',
          control: <SettingsButton label="Open content library →" onClick={() => onOpenContentLibrary?.()} accent={accent} />,
        },
        {
          id: 'market', label: 'Market',
          hint: 'Browse the marketplace full-screen — shelves, filters, sorting, and a detail page per bundle. Installing and removing what you already have stays in the content library.',
          control: <SettingsButton label="Open market →" onClick={() => onOpenMarket?.()} accent={accent} />,
        },
      ],
    },
    {
      id: 'marketplace', icon: '⇄', title: 'Marketplace',
      rows: [
        {
          id: 'marketplace-community', label: 'Community',
          hint: 'Creators, the forum and the shoutbox.',
          control: <SettingsButton label="Open community →" onClick={() => onOpenCommunity?.()} accent={accent} />,
        },
        {
          id: 'marketplace-profile', label: 'Profile & account',
          hint: 'Sign in, create an account, and manage how you appear on the marketplace. Moved to its own window in 0.9.0 — becoming a creator is not a preference.',
          control: <SettingsButton label="Open profile →" onClick={() => onOpenProfile?.()} accent={accent} />,
        },
        {
          id: 'marketplace-server', label: 'Server & signing key', stacked: true,
          hint: 'The app ships pointed at the official marketplace. To use your own server, enter its URL and the signing public key it prints on startup — the app verifies the index signature and every bundle’s checksum before installing.',
          control: <MarketplaceServerEditor accent={accent} />,
        },
      ],
    },
    {
      id: 'weather', icon: '☂', title: 'Weather & location',
      rows: [
        {
          id: 'weather-location', label: 'Location', stacked: true,
          hint: 'Used by weather, radar, sun, air quality, pollen and other location-aware tiles',
          control: (
            <SettingsWeatherSearch
              current={v.weatherLocation}
              onPick={(loc) => set('weatherLocation', loc)}
              accent={accent}
              streamer={v.streamerMode}
            />
          ),
        },
        {
          id: 'weather-temp-unit', label: 'Temperature',
          hint: 'Weather tiles and the temps strip — System resolves by locale',
          control: (
            <Segmented<TempUnitSetting>
              value={v.tempUnit}
              options={['system', 'f', 'c']}
              labels={{ system: 'System', f: '°F', c: '°C' }}
              onChange={(x) => set('tempUnit', x)}
              accent={accent}
            />
          ),
        },
        {
          id: 'weather-wind-unit', label: 'Wind speed',
          hint: 'Forecast tile — System resolves by locale',
          control: (
            <Segmented<WindUnitSetting>
              value={v.windUnit}
              options={['system', 'mph', 'kph']}
              labels={{ system: 'System', mph: 'mph', kph: 'km/h' }}
              onChange={(x) => set('windUnit', x)}
              accent={accent}
            />
          ),
        },
      ],
    },
    {
      id: 'performance', icon: '⚡', title: 'Performance',
      rows: [
        {
          id: 'performance-mode', label: 'Performance mode',
          hint: PERF_MODE_HINTS[v.perfMode],
          control: (
            <Segmented<PerfMode>
              value={v.perfMode}
              options={['battery', 'balanced', 'high', 'uncapped', 'custom']}
              onChange={(x) => set('perfMode', x)}
              accent={accent}
            />
          ),
        },
        // The three knobs behind every preset, individually tunable (0.9.1).
        // Rendered only in Custom mode; the saved values survive preset
        // switches, so Custom always comes back to the user's last tuning.
        ...(v.perfMode === 'custom' ? [
          {
            id: 'performance-custom-fps', label: 'Frame-rate cap',
            hint: 'Top speed for visualizer drawing — 0 removes the cap entirely',
            control: (
              <SliderControl
                value={v.perfCustomFps} min={0} max={165} step={5}
                format={(x) => (x === 0 ? 'uncapped' : `${x} fps`)} accent={accent}
                onChange={(x) => set('perfCustomFps', x)}
              />
            ),
          },
          {
            id: 'performance-custom-dpr', label: 'Render resolution',
            hint: 'Pixel-density cap for visualizer canvases — lower is cheaper on the GPU, never above your display’s native ratio',
            control: (
              <SliderControl
                value={v.perfCustomDpr} min={0.5} max={2} step={0.25}
                format={(x) => `${x.toFixed(2)}×`} accent={accent}
                onChange={(x) => set('perfCustomDpr', x)}
              />
            ),
          },
          {
            id: 'performance-custom-audiohz', label: 'Audio update rate',
            hint: 'How often the spectrum refreshes per second — the biggest CPU knob while music plays',
            control: (
              <SliderControl
                value={v.perfCustomAudioHz} min={5} max={60} step={5}
                format={(x) => `${x} Hz`} accent={accent}
                onChange={(x) => set('perfCustomAudioHz', x)}
              />
            ),
          },
        ] : []),
      ],
    },
    {
      id: 'system', icon: '⚙', title: 'System',
      rows: [
        {
          id: 'system-version', label: 'Version',
          hint: 'The build you are running right now',
          control: (
            <span style={{
              fontSize: 11.5, fontFamily: MONO, color: 'rgba(255,255,255,0.75)',
              userSelect: 'text',
            }}>{__APP_VERSION__}</span>
          ),
        },
        {
          id: 'system-updates', label: 'App updates',
          hint: 'Check GitHub for a newer version — nothing downloads or installs unless you choose to',
          control: <UpdateCheckRow accent={accent} />,
        },
        {
          id: 'system-autostart', label: 'Launch at startup',
          hint: IS_MAC
            ? 'Start the hub automatically when you sign in'
            : 'Start the hub automatically when you sign in to Windows',
          control: <AutostartSwitch accent={accent} />,
        },
        {
          id: 'system-tray', label: 'Close to tray',
          hint: 'The window close button hides to the system tray instead of quitting — quit from the tray menu',
          control: <Toggle checked={v.closeToTray} onChange={(c) => set('closeToTray', c)} accent={accent} />,
        },
        {
          id: 'system-bookmarks', label: 'Streaming bookmarks', stacked: true,
          hint: 'Launchpad shortcuts for the streaming browser on the visualizer tile',
          control: (
            <BookmarksEditor
              enabled={v.videoEnabled}
              bookmarks={v.videoBookmarks}
              setEnabled={(x) => set('videoEnabled', x)}
              setBookmarks={(next) => set('videoBookmarks', next)}
              accent={accent}
            />
          ),
        },
      ],
    },
    {
      id: 'advanced', icon: '▸', title: 'Advanced',
      rows: [
        {
          id: 'advanced-perfdebug', label: 'Perf debug HUD',
          hint: 'Long-task observer, GPU spike ring buffer, per-viz draw-rate and ResizeObserver counters',
          control: <Toggle checked={v.perfDebug} onChange={(c) => set('perfDebug', c)} accent={accent} />,
        },
        {
          id: 'advanced-audiodebug', label: 'Audio debug HUD',
          hint: 'Small live / fps / levels readout over the visualizer',
          control: <Toggle checked={v.audioDebug} onChange={(c) => set('audioDebug', c)} accent={accent} />,
        },
        {
          id: 'advanced-onboarding', label: 'Replay onboarding',
          hint: 'Run the first-launch setup flow again',
          control: <SettingsButton label="Replay" onClick={onReplayOnboarding} />,
        },
        {
          id: 'advanced-reset-layout', label: 'Reset layout',
          hint: 'Clear all tiles for this profile and orientation, then add the ones you want in edit mode',
          control: <SettingsButton label="Reset" onClick={onResetLayout} />,
        },
        {
          id: 'advanced-export', label: 'Export settings',
          hint: 'Save all settings to a JSON file. API keys and tokens are stored separately (encrypted) and are never included.',
          control: <SettingsButton label="Export…" onClick={() => onExportSettings?.()} />,
        },
        {
          id: 'advanced-import', label: 'Import settings',
          hint: 'Load settings from an exported JSON file — merges over current settings',
          control: <SettingsButton label="Import…" onClick={() => onImportSettings?.()} />,
        },
      ],
    },
  ];

  const q = query.trim().toLowerCase();
  const searching = q.length > 0;
  const matches = (row: RowDef) => `${row.label} ${row.hint ?? ''}`.toLowerCase().includes(q);
  const filtered = searching
    ? panes
        .map((p) => ({ pane: p, rows: p.rows.filter(matches) }))
        .filter((g) => g.rows.length > 0)
    : [];
  const current = panes.find((p) => p.id === activePane) ?? panes[0]!;

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{
        position: 'fixed', inset: 0, zIndex: 2000,
        background: 'rgba(0,0,0,0.55)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      <div style={{
        width: 820, maxWidth: '90%', maxHeight: '85vh',
        display: 'flex', flexDirection: 'column',
        background: 'var(--surface-overlay, rgba(20,22,28,0.98))',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 12,
        boxShadow: '0 24px 60px rgba(0,0,0,0.5)',
        color: '#fff', overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '12px 16px', borderBottom: '1px solid rgba(255,255,255,0.06)',
          flexShrink: 0,
        }}>
          <div style={{ width: 8, height: 8, borderRadius: 2, background: accent, boxShadow: `0 0 8px ${accent}66` }} />
          <span style={{ fontSize: 13, fontWeight: 600 }}>Settings</span>
          <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)', fontFamily: MONO }}>⌘,</span>
          <div style={{ flex: 1 }} />
          <input
            type="text" value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search settings…"
            autoFocus
            spellCheck={false}
            style={{
              width: 200, fontSize: 11.5, padding: '5px 9px',
              background: 'rgba(0,0,0,0.3)',
              border: '1px solid rgba(255,255,255,0.08)',
              borderRadius: 6, color: '#fff', outline: 'none',
            }}
          />
          <button
            onClick={onClose} title="Close (Esc)"
            style={{
              width: 24, height: 24, borderRadius: 6, border: 'none',
              background: 'transparent', color: 'rgba(255,255,255,0.5)',
              fontSize: 14, lineHeight: 1, cursor: 'pointer',
            }}
          >×</button>
        </div>

        {/* Body: left nav + content pane */}
        <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
          <div style={{
            width: 180, flexShrink: 0, padding: 10,
            borderRight: HAIRLINE, overflowY: 'auto',
            display: 'flex', flexDirection: 'column', gap: 2,
            opacity: searching ? 0.5 : 1,
          }}>
            {panes.map((p) => {
              const active = !searching && p.id === activePane;
              return (
                <button
                  key={p.id}
                  onClick={() => { setActivePane(p.id); setQuery(''); }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    padding: '7px 10px', fontSize: 11.5, textAlign: 'left',
                    borderRadius: 7, cursor: 'pointer',
                    background: active ? `${accent}14` : 'transparent',
                    border: active ? `1px solid ${accent}44` : '1px solid transparent',
                    color: active ? accent : 'rgba(255,255,255,0.6)',
                    fontWeight: active ? 600 : 400,
                  }}
                >
                  <span style={{ width: 14, textAlign: 'center', fontSize: 12 }}>{p.icon}</span>
                  {p.title}
                </button>
              );
            })}
          </div>

          <div style={{ flex: 1, minWidth: 0, minHeight: 380, padding: '20px 24px', overflowY: 'auto' }}>
            {searching ? (
              filtered.length === 0 ? (
                <div style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.4)', padding: '20px 0' }}>
                  No settings match "{query.trim()}"
                </div>
              ) : (
                filtered.map((g, gi) => (
                  <div key={g.pane.id} style={{ marginTop: gi === 0 ? 0 : 20 }}>
                    <PaneHeading icon={g.pane.icon} title={g.pane.title} />
                    {g.rows.map((row, i) => (
                      <SettingRow key={row.id} row={row} isLast={i === g.rows.length - 1} />
                    ))}
                  </div>
                ))
              )
            ) : (
              <>
                <PaneHeading icon={current.icon} title={current.title} />
                {current.rows.map((row, i) => (
                  <SettingRow key={row.id} row={row} isLast={i === current.rows.length - 1} />
                ))}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

const PERF_MODE_HINTS: Record<PerfMode, string> = {
  uncapped: 'Native DPR · uncapped fps · 60 Hz audio · always animating',
  high:     'DPR cap 1.5× · 120 fps · 60 Hz audio · pauses when nothing plays',
  balanced: 'DPR cap 1× · 60 fps · 30 Hz audio · pauses when nothing plays',
  battery:  'DPR cap 1× · 30 fps · 15 Hz audio · pauses when nothing plays',
  custom:   'Tune each knob yourself — the presets above set these same three',
};

function PaneHeading({ icon, title }: { icon: string; title: string }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4,
      fontSize: 10, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase',
      color: 'rgba(255,255,255,0.4)',
    }}>
      <span style={{ fontSize: 11 }}>{icon}</span>
      {title}
    </div>
  );
}

function SettingRow({ row, isLast }: { row: RowDef; isLast: boolean }) {
  return (
    <div style={{
      display: 'flex',
      flexDirection: row.stacked ? 'column' : 'row',
      alignItems: row.stacked ? 'stretch' : 'center',
      justifyContent: 'space-between',
      gap: row.stacked ? 10 : 16,
      padding: '12px 0',
      borderBottom: isLast ? 'none' : HAIRLINE,
    }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 12.5, fontWeight: 600, color: '#fff' }}>{row.label}</div>
        {row.hint && (
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', marginTop: 2, lineHeight: 1.45 }}>
            {row.hint}
          </div>
        )}
      </div>
      <div style={row.stacked ? undefined : { flexShrink: 0, maxWidth: '58%' }}>{row.control}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Dark-themed controls (the old dev-panel primitives were styled for a light
// background; these follow the modal's glass aesthetic instead).
// ---------------------------------------------------------------------------

function Toggle({ checked, onChange, accent, disabled }: {
  checked: boolean;
  onChange: (next: boolean) => void;
  accent: string;
  disabled?: boolean;
}) {
  return (
    <button
      role="switch" aria-checked={checked} disabled={disabled}
      onClick={() => onChange(!checked)}
      style={{
        width: 34, height: 20, borderRadius: 10, position: 'relative',
        cursor: disabled ? 'not-allowed' : 'pointer', padding: 0,
        background: checked ? accent : 'rgba(255,255,255,0.12)',
        border: '1px solid rgba(255,255,255,0.1)',
        transition: 'background .15s', opacity: disabled ? 0.5 : 1,
        flexShrink: 0,
      }}
    >
      <span style={{
        position: 'absolute', top: 2, left: checked ? 16 : 2,
        width: 14, height: 14, borderRadius: '50%',
        background: checked ? '#0b0c10' : '#fff',
        transition: 'left .15s',
      }} />
    </button>
  );
}

function SettingsSelect<T extends string>({ value, options, onChange }: {
  value: T;
  /** `group` is optional — used by the viz style dropdown to set installed
   *  bundles apart from built-ins under an "Installed" optgroup. Options
   *  without a group render flat, at top, in array order. `disabled` greys
   *  out an option without removing it — kept generic for whichever caller
   *  needs it; the audio-source picker deliberately does not use it (see
   *  the comment at its call site). */
  options: { value: T; label: string; group?: string; disabled?: boolean }[];
  onChange: (v: T) => void;
}) {
  const ungrouped = options.filter((o) => !o.group);
  const groups = new Map<string, { value: T; label: string; disabled?: boolean }[]>();
  for (const o of options) {
    if (!o.group) continue;
    const list = groups.get(o.group) ?? [];
    list.push(o);
    groups.set(o.group, list);
  }
  const optionStyle = { background: '#14161c', color: '#fff' };
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as T)}
      style={{
        appearance: 'none', WebkitAppearance: 'none',
        fontSize: 11.5, padding: '5px 24px 5px 9px',
        background: 'rgba(0,0,0,0.3)',
        backgroundImage: 'url("data:image/svg+xml;utf8,<svg xmlns=\'http://www.w3.org/2000/svg\' width=\'10\' height=\'6\' viewBox=\'0 0 10 6\'><path fill=\'rgba(255,255,255,.5)\' d=\'M0 0h10L5 6z\'/></svg>")',
        backgroundRepeat: 'no-repeat', backgroundPosition: 'right 8px center',
        border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6,
        color: '#fff', outline: 'none', cursor: 'pointer', maxWidth: 220,
      }}
    >
      {ungrouped.map((o) => (
        <option key={o.value} value={o.value} disabled={o.disabled} style={optionStyle}>
          {o.label}
        </option>
      ))}
      {[...groups.entries()].map(([label, opts]) => (
        <optgroup key={label} label={label} style={optionStyle}>
          {opts.map((o) => (
            <option key={o.value} value={o.value} disabled={o.disabled} style={optionStyle}>
              {o.label}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}

// ---------------------------------------------------------------------------
// Audio-source status line — the muted note under the source picker
// explaining why the active source doesn't match what was asked for. Reads
// straight off the `audio:source` payload (via useAudioSource); no
// re-derivation of "is it really live" happens here.
// ---------------------------------------------------------------------------

function AudioSourceStatusLine({ status, options }: {
  status: AudioSourceState | null;
  options: SourceOption[];
}) {
  if (!status) return null;
  if (status.supported === false) {
    // `reason` carries whatever `audio_loopback::start` actually failed
    // with — often a transient activation error, not a missing OS feature.
    // The build-number message is a fallback for when Rust didn't send one,
    // not an assertion about the cause.
    return (
      <div style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.4)', textAlign: 'right' }}>
        {status.reason ?? (IS_MAC ? 'Per-app audio needs macOS 14.2 or newer' : 'Per-app audio needs Windows 11 (build 20348+)')}
      </div>
    );
  }
  if (status.requested.mode === 'apps') {
    const missing = status.requested.exes.filter((exe) => !status.live_exes.includes(exe));
    if (missing.length > 0) {
      const names = missing.map((exe) => options.find((o) => o.exe === exe)?.name ?? exe).join(', ');
      return (
        <div style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.4)', textAlign: 'right' }}>
          {names} {missing.length === 1 ? "isn't" : "aren't"} playing — contributing silence until it starts
        </div>
      );
    }
  }
  return null;
}

function Segmented<T extends string>({ value, options, onChange, accent, labels }: {
  value: T;
  options: T[];
  onChange: (v: T) => void;
  accent: string;
  /** Optional per-option display text (e.g. 'f' → '°F'). Defaults to the raw value. */
  labels?: Partial<Record<T, string>>;
}) {
  return (
    <div style={{
      display: 'flex', padding: 2, borderRadius: 7,
      background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.06)',
      userSelect: 'none',
    }}>
      {options.map((o) => {
        const active = o === value;
        return (
          <button
            key={o} type="button" onClick={() => onChange(o)}
            style={{
              padding: '4px 10px', fontSize: 10.5, borderRadius: 5,
              background: active ? `${accent}22` : 'transparent',
              border: active ? `1px solid ${accent}44` : '1px solid transparent',
              color: active ? accent : 'rgba(255,255,255,0.55)',
              fontWeight: active ? 600 : 400, cursor: 'pointer', lineHeight: 1.3,
            }}
          >{labels?.[o] ?? o}</button>
        );
      })}
    </div>
  );
}

function SliderControl({ value, min, max, step, format, accent, onChange }: {
  value: number;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
  accent: string;
  onChange: (v: number) => void;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <span style={{ fontSize: 10.5, fontFamily: MONO, color: 'rgba(255,255,255,0.5)', minWidth: 40, textAlign: 'right' }}>
        {format(value)}
      </span>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        style={{ width: 150, accentColor: accent }}
      />
    </div>
  );
}

function SettingsButton({ label, onClick, accent }: { label: string; onClick: () => void; accent?: string }) {
  return (
    <button
      type="button" onClick={onClick}
      style={{
        padding: '5px 14px', fontSize: 11.5, fontWeight: 600,
        borderRadius: 6, cursor: 'pointer',
        background: accent ? `${accent}22` : 'rgba(255,255,255,0.08)',
        border: accent ? `1px solid ${accent}44` : '1px solid rgba(255,255,255,0.12)',
        color: accent ?? 'rgba(255,255,255,0.85)',
      }}
    >{label}</button>
  );
}

function AutostartSwitch({ accent }: { accent: string }) {
  const [enabled, toggle] = useAutostart();
  return <Toggle checked={enabled === true} disabled={enabled === null} onChange={toggle} accent={accent} />;
}

// ---------------------------------------------------------------------------
// Marketplace account — sign in to rate bundles. The session token is never
// visible here: useMarketplaceAuth (state/marketplaceAuth.ts) only ever hands
// this component a state tag ('checking' | 'signed-out' | 'signing-in' |
// 'signed-in' | 'error'), a masked email, or the server's own failure message
// — the actual token stays Rust-side in the DPAPI secret store end to end.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Marketplace server config — URL + pinned signing pubkey. Lifted from the
// old MarketplaceTab.tsx unchanged in validation behavior: URL must start
// with https:// (the Rust client refuses anything else), pubkey must be 64
// hex characters. Reads/writes the same `marketplace.url` / `marketplace.pubkey`
// localStorage keys, via the shared state/marketplaceConfig module (the same
// module ContentLibrary imports), so a user override survives the move and
// there is exactly one place the pinned key lives.
// ---------------------------------------------------------------------------

function MarketplaceServerEditor({ accent }: { accent: string }) {
  const [url, setUrl] = useState(cfgUrl);
  const [pubkey, setPubkey] = useState(cfgPubkey);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  const save = () => {
    // The Rust client refuses anything but https, so reject it here too.
    if (!url.trim().startsWith('https://')) {
      setError('Server URL must start with https://');
      setSaved(false);
      return;
    }
    if (!/^[0-9a-f]{64}$/i.test(pubkey.trim())) {
      setError('Signing public key must be 64 hex characters');
      setSaved(false);
      return;
    }
    localStorage.setItem(LS_URL, url.trim());
    localStorage.setItem(LS_PUBKEY, pubkey.trim());
    setError('');
    setSaved(true);
  };

  const reset = () => {
    localStorage.removeItem(LS_URL);
    localStorage.removeItem(LS_PUBKEY);
    setUrl(DEFAULT_URL);
    setPubkey(DEFAULT_PUBKEY);
    setError('');
    setSaved(true);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 460 }}>
      <div>
        <label style={fieldLabelStyle}>Server URL</label>
        <input
          value={url}
          onChange={(e) => { setUrl(e.target.value); setSaved(false); }}
          placeholder="https://market.example.com"
          spellCheck={false}
          style={fieldInputStyle}
        />
      </div>
      <div>
        <label style={fieldLabelStyle}>Signing public key (hex)</label>
        <input
          value={pubkey}
          onChange={(e) => { setPubkey(e.target.value); setSaved(false); }}
          placeholder="64 hex chars"
          spellCheck={false}
          style={{ ...fieldInputStyle, fontFamily: MONO }}
        />
      </div>
      {error && <div style={{ color: '#fb7185', fontSize: 11 }}>{error}</div>}
      {saved && !error && <div style={{ color: accent, fontSize: 11 }}>Saved — reopen the content library to reload.</div>}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <SettingsButton label="Save" onClick={save} accent={accent} />
        {!isDefaultServer() && <SettingsButton label="Use official server" onClick={reset} />}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Weather location search.
// ---------------------------------------------------------------------------

function SettingsWeatherSearch({ current, onPick, accent, streamer }: {
  current: WeatherLocation;
  onPick: (loc: WeatherLocation) => void;
  accent: string;
  /** While on: label masked, input read-only (0.7.1 §2). */
  streamer: boolean;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<GeocodeResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) { setResults([]); setErr(null); return; }
    setLoading(true); setErr(null);
    const id = setTimeout(async () => {
      try {
        const { geocode } = await import('../state/weatherLocation');
        const data = await geocode(q);
        setResults(data);
      } catch (e: any) {
        setErr(String(e?.message ?? e));
      } finally {
        setLoading(false);
      }
    }, 350);
    return () => clearTimeout(id);
  }, [query]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.55)', display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <span>Current</span>
        <span style={{ fontFamily: MONO, fontSize: 10.5, color: accent }}>{redactLocation(current.label, streamer)}</span>
      </div>
      <input
        type="text" value={streamer ? REDACTED_TEXT : query}
        readOnly={streamer}
        onChange={(e) => { if (!streamer) setQuery(e.target.value); }}
        placeholder="Search a city…"
        spellCheck={false}
        style={{
          fontSize: 11.5, padding: '6px 9px',
          background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: 6, color: '#fff', outline: 'none',
        }}
      />
      {streamer && (
        <div style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.4)' }}>
          Turn off streamer mode to edit your location.
        </div>
      )}
      {loading && <div style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.4)' }}>Searching…</div>}
      {err && <div style={{ fontSize: 10.5, color: '#fb7185' }}>{err}</div>}
      {!streamer && results.length > 0 && (
        <div style={{
          display: 'flex', flexDirection: 'column', gap: 2,
          background: 'rgba(0,0,0,0.25)', border: HAIRLINE, borderRadius: 6, padding: 4,
        }}>
          {results.map((r, i) => (
            <button
              key={i}
              onClick={() => {
                onPick({ label: r.label, lat: r.lat, lon: r.lon });
                setQuery('');
                setResults([]);
              }}
              style={{
                textAlign: 'left', padding: '4px 8px', borderRadius: 4,
                background: 'transparent', border: 'none', cursor: 'pointer',
                fontSize: 11.5, color: 'rgba(255,255,255,0.85)',
              }}
            >
              <div style={{ fontWeight: 500 }}>{r.label}</div>
              <div style={{ fontSize: 9.5, color: 'rgba(255,255,255,0.4)', fontFamily: MONO }}>
                {r.lat.toFixed(3)}, {r.lon.toFixed(3)}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Streaming-bookmarks editor: launchpad enable toggle, add/remove,
// restore defaults, auto-disable when the list empties.
// ---------------------------------------------------------------------------

const BOOKMARK_PALETTE = ['#fb7185', '#60a5fa', '#a78bfa', '#facc15', '#7cf5d4', '#fb923c', '#22c55e', '#ec4899'];

function BookmarksEditor({ enabled, bookmarks, setEnabled, setBookmarks, accent }: {
  enabled: boolean;
  bookmarks: Bookmark[];
  setEnabled: (v: boolean) => void;
  setBookmarks: (next: Bookmark[]) => void;
  accent: string;
}) {
  const [draftName, setDraftName] = useState('');
  const [draftUrl, setDraftUrl] = useState('');
  const [draftLetters, setDraftLetters] = useState('');

  // If bookmarks list goes empty while enabled, auto-disable so the launchpad
  // doesn't show its empty-state placeholder by surprise.
  useEffect(() => {
    if (enabled && bookmarks.length === 0) setEnabled(false);
  }, [enabled, bookmarks.length, setEnabled]);

  const add = () => {
    const name = draftName.trim();
    const url = draftUrl.trim();
    if (!name || !url) return;
    if (!/^https?:\/\//i.test(url)) return;
    const letters = (draftLetters.trim() || name.slice(0, 2)).toUpperCase().slice(0, 3);
    const id = (typeof crypto !== 'undefined' && crypto.randomUUID)
      ? crypto.randomUUID() : `bm_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const color = BOOKMARK_PALETTE[bookmarks.length % BOOKMARK_PALETTE.length]!;
    setBookmarks([...bookmarks, { id, name, url, letters, color }]);
    setDraftName(''); setDraftUrl(''); setDraftLetters('');
  };
  const remove = (id: string) => setBookmarks(bookmarks.filter((b) => b.id !== id));
  const restore = () => setBookmarks(defaultBookmarks());

  const canEnable = bookmarks.length > 0;
  const canAdd = !!draftName.trim() && !!draftUrl.trim() && /^https?:\/\//i.test(draftUrl.trim());

  const inputStyle: React.CSSProperties = {
    fontSize: 11, padding: '6px 9px',
    background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: 6, color: '#fff', outline: 'none', fontFamily: MONO,
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
          color: canEnable ? 'rgba(255,255,255,0.75)' : 'rgba(255,255,255,0.35)',
        }}
        title={canEnable ? '' : 'Add at least one bookmark'}
      >
        <span style={{ fontSize: 11.5, fontWeight: 500 }}>Show streaming launchpad</span>
        <Toggle
          checked={enabled && canEnable}
          disabled={!canEnable}
          onChange={setEnabled}
          accent={accent}
        />
      </div>

      {/* Bookmark list */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        {bookmarks.map((b) => (
          <div key={b.id} style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '4px 6px', fontSize: 11,
            background: 'rgba(0,0,0,0.25)',
            border: HAIRLINE,
            borderRadius: 6,
          }}>
            <span style={{
              width: 22, height: 22, borderRadius: 4,
              background: b.color, color: '#fff', fontWeight: 700, fontSize: 10,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              flexShrink: 0,
            }}>{b.letters}</span>
            <span style={{ flex: 1, color: 'rgba(255,255,255,0.8)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {b.name}
            </span>
            <button
              onClick={() => remove(b.id)}
              title={`Remove ${b.name}`}
              style={{
                background: 'transparent', border: 'none', cursor: 'pointer',
                color: 'rgba(255,255,255,0.45)', fontSize: 13, padding: '0 4px', lineHeight: 1,
              }}
            >×</button>
          </div>
        ))}
      </div>

      {/* Add form */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <input
          type="text" value={draftName} placeholder="Name (e.g. YouTube)"
          onChange={(e) => setDraftName(e.target.value)}
          maxLength={32}
          style={inputStyle}
        />
        <input
          type="text" value={draftUrl} placeholder="https://..."
          onChange={(e) => setDraftUrl(e.target.value)}
          spellCheck={false} maxLength={512}
          style={inputStyle}
        />
        <div style={{ display: 'flex', gap: 4 }}>
          <input
            type="text" value={draftLetters} placeholder="Letters"
            onChange={(e) => setDraftLetters(e.target.value)}
            maxLength={3}
            style={{ ...inputStyle, width: 64, flex: 'none' }}
          />
          <button
            onClick={add}
            disabled={!canAdd}
            style={{
              flex: 1, fontSize: 11, fontWeight: 600, padding: '5px 10px',
              borderRadius: 6, border: `1px solid ${accent}44`, cursor: canAdd ? 'pointer' : 'not-allowed',
              background: `${accent}22`, color: accent,
              opacity: canAdd ? 1 : 0.4,
            }}
          >Add bookmark</button>
        </div>
      </div>
      <button
        onClick={restore}
        style={{
          fontSize: 10.5, color: 'rgba(255,255,255,0.45)', background: 'transparent',
          border: 'none', padding: 0, textAlign: 'left', cursor: 'pointer',
        }}
      >Restore default bookmarks</button>
    </div>
  );
}

const colorInputStyle: React.CSSProperties = {
  width: 28, height: 22, padding: 0,
  border: '1px solid rgba(255,255,255,0.15)', borderRadius: 4,
  cursor: 'pointer', background: 'transparent',
};

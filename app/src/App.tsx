import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import type { TileType, Layout, TileInstance, OrientationLayout, Rect } from './state/layout';
import {
  DEFAULT_LANDSCAPE_LAYOUT,
  DEFAULT_PORTRAIT_LAYOUT,
  DEFAULT_BUNDLE_TILE_RECT,
  migrateLegacyProfileToOrientations,
  useCanvas,
  useOrientation,
  newId,
  ALL_TILE_TYPES,
  migrateLayoutHiddenToTiles,
  findInstance,
  addInstance,
  removeInstance,
  updateInstance,
} from './state/layout';
import { isBundleTile } from './tiles/tileRegistry';
import type { Track, Profile, AccentTheme, VizMode, Density, Todo, WeatherLocation } from './types';
import {
  DEFAULT_POMODORO_STATE,
  DEFAULT_POMODORO_SETTINGS,
  type PomodoroState,
  type PomodoroSettings,
} from './state/pomodoro';
import { TRACKS, ACCENT_PALETTES } from './data';
import { useTweaks } from './state/useTweaks';
import { useSysmon, useNowPlaying, useSpectrumRef } from './state/tauri';
import { VizHero, setVizDprCap, setVizMaxFps, getVizMaxFps } from './components/viz';
import * as perfDebug from './perf/debug';
import { PerfDebugHUD } from './perf/PerfDebugHUD';
import { useVizStyles } from './components/useVizStyles';
import { remapRetiredVizMode } from './state/contentRegistry';
import { defaultBookmarks, type Bookmark } from './components/browser-player';
import {
  SpotifyTile, NotesTile,
  SysMonTile,
} from './components/tiles';
import { EditModeOverlay } from './components/edit';
import { TileLibrary } from './components/TileLibrary';
import { ProfileSwitcher } from './components/profile';
import { Onboarding } from './components/onboarding';
import { TileFrame } from './components/TileFrame';
import { SettingsWindow } from './components/settings';
import { TileSkeleton } from './components/tileStates';
import { parseStreamDeckConfig } from './state/actions';

// Standalone tiles are lazy-loaded per-tile so the initial bundle only pays
// for what's actually visible in the active profile/orientation. Kept EAGER:
// './components/tiles' (Spotify/Notes/Sysmon — entangled with boot), VizHero,
// TileFrame, EditModeOverlay, TileLibrary, ProfileSwitcher, Onboarding,
// SettingsWindow (see imports above/below).
const VizGallery = lazy(() => import('./components/viz-gallery').then((m) => ({ default: m.VizGallery })));
const ClaudeCodeTile = lazy(() => import('./components/claude-tile').then((m) => ({ default: m.ClaudeCodeTile })));
const DiscordTile = lazy(() => import('./components/discord-tile').then((m) => ({ default: m.DiscordTile })));
const NowAndForecastTile = lazy(() => import('./components/forecast-tile').then((m) => ({ default: m.NowAndForecastTile })));
const AudioMixerTile = lazy(() => import('./components/audio-mixer-tile').then((m) => ({ default: m.AudioMixerTile })));
const StreamDeckTile = lazy(() => import('./components/StreamDeckTile').then((m) => ({ default: m.StreamDeckTile })));
const RadarTile = lazy(() => import('./components/RadarTile').then((m) => ({ default: m.RadarTile })));
const PomodoroTile = lazy(() => import('./components/PomodoroTile').then((m) => ({ default: m.PomodoroTile })));
const SunTile = lazy(() => import('./components/SunTile').then((m) => ({ default: m.SunTile })));
const AuroraTile = lazy(() => import('./components/AuroraTile').then((m) => ({ default: m.AuroraTile })));
const AirQualityTile = lazy(() => import('./components/AirQualityTile').then((m) => ({ default: m.AirQualityTile })));
const StocksTile = lazy(() => import('./components/StocksTile').then((m) => ({ default: m.StocksTile })));
const TidesTile = lazy(() => import('./components/TidesTile').then((m) => ({ default: m.TidesTile })));
const GithubPrsTile = lazy(() => import('./components/GithubPrsTile').then((m) => ({ default: m.GithubPrsTile })));
const StreamChatTile = lazy(() => import('./components/StreamChatTile').then((m) => ({ default: m.StreamChatTile })));
const PhoneNotifsTile = lazy(() => import('./components/PhoneNotifsTile').then((m) => ({ default: m.PhoneNotifsTile })));
const HomeAssistantTile = lazy(() => import('./components/HomeAssistantTile').then((m) => ({ default: m.HomeAssistantTile })));
const ScratchpadTile = lazy(() => import('./components/ScratchpadTile').then((m) => ({ default: m.ScratchpadTile })));
const QuoteTile = lazy(() => import('./components/QuoteTile').then((m) => ({ default: m.QuoteTile })));
const OnThisDayTile = lazy(() => import('./components/OnThisDayTile').then((m) => ({ default: m.OnThisDayTile })));
const RandomWikiTile = lazy(() => import('./components/RandomWikiTile').then((m) => ({ default: m.RandomWikiTile })));
const WordOfDayTile = lazy(() => import('./components/WordOfDayTile').then((m) => ({ default: m.WordOfDayTile })));
const IssTile = lazy(() => import('./components/IssTile').then((m) => ({ default: m.IssTile })));
const LaunchesTile = lazy(() => import('./components/LaunchesTile').then((m) => ({ default: m.LaunchesTile })));
const DailyChallengeTile = lazy(() => import('./components/DailyChallengeTile').then((m) => ({ default: m.DailyChallengeTile })));
const PollenTile = lazy(() => import('./components/PollenTile').then((m) => ({ default: m.PollenTile })));
const BirdsTile = lazy(() => import('./components/BirdsTile').then((m) => ({ default: m.BirdsTile })));
const SolarFlareTile = lazy(() => import('./components/SolarFlareTile').then((m) => ({ default: m.SolarFlareTile })));
const LightningTile = lazy(() => import('./components/LightningTile').then((m) => ({ default: m.LightningTile })));
const AircraftTile = lazy(() => import('./components/AircraftTile').then((m) => ({ default: m.AircraftTile })));
const ActiveWindowTile = lazy(() => import('./components/ActiveWindowTile').then((m) => ({ default: m.ActiveWindowTile })));
const DockerTile = lazy(() => import('./components/DockerTile').then((m) => ({ default: m.DockerTile })));
const EnergyTile = lazy(() => import('./components/EnergyTile').then((m) => ({ default: m.EnergyTile })));

// Vite injects `import.meta.env` at build time; the project has no
// vite-env.d.ts / "vite/client" types reference, so declare the one flag we
// use. The dev-only Tweaks panel that used to read DEV here is gone
// (superseded by the Settings window); kept in case future dev-only gating
// needs it again.
declare global {
  interface ImportMeta {
    readonly env: { readonly DEV: boolean };
  }
}

interface VizColorOverride {
  enabled: boolean;
  accent: string;
  accent2: string;
}

interface TweakState extends Record<string, unknown> {
  vizMode: VizMode;
  accentTheme: AccentTheme;
  density: Density;
  vizArtBg: boolean;
  vizSensitivity: number;
  vizSmoothing: number;
  vizColorOverride: VizColorOverride;
  lyricsOverlayEnabled: boolean;
  /** When true AND there's at least one bookmark, the viz tile renders the
   *  streaming-browser launchpad / child webview instead of the audio
   *  visualizer. The viz surface and album-art backdrop are skipped (and
   *  `paused` flips on) to save GPU when a child webview is active. */
  videoEnabled: boolean;
  /** User-editable launchpad cards. Persisted via Tweaks. */
  videoBookmarks: Bookmark[];
  /** URL currently loaded in the Tauri child webview, or null when the
   *  launchpad grid is showing. */
  videoCurrentUrl: string | null;
  perfMode: 'uncapped' | 'high' | 'balanced' | 'battery';
  /** When true, mounts the perf-debug HUD and starts long-task / GPU spike
   *  instrumentation. Off by default; flip from Settings when investigating
   *  GPU spikes. */
  perfDebug: boolean;
  /** When true, the small live/fps/levels readout overlays the viz. Off by
   *  default — only useful for diagnosing why a viz isn't reacting. */
  audioDebug: boolean;
  /** When true, the window close button hides to the system tray instead of
   *  quitting the app. Quit is then only available from the tray menu. */
  closeToTray: boolean;
  todos: Todo[];
  weatherLocation: WeatherLocation;
  pomodoro: { state: PomodoroState; settings: PomodoroSettings };
  // Profile system: layout + tile visibility live INSIDE the active profile.
  profiles: Profile[];
  activeProfileId: string;
  onboardingDone: boolean;
}

const TWEAK_DEFAULTS: TweakState = {
  vizMode: 'bars',
  accentTheme: 'auto',
  density: 'compact',
  vizArtBg: false,
  vizSensitivity: 1.0,
  vizSmoothing: 0.0,
  vizColorOverride: { enabled: false, accent: '#a78bfa', accent2: '#ec4899' },
  lyricsOverlayEnabled: true,
  videoEnabled: false,
  videoBookmarks: defaultBookmarks(),
  videoCurrentUrl: null,
  perfMode: 'balanced',
  perfDebug: false,
  audioDebug: false,
  closeToTray: true,
  todos: [],
  weatherLocation: { label: 'Knoxville, TN', lat: 35.9606, lon: -83.9207 },
  pomodoro: {
    state: { ...DEFAULT_POMODORO_STATE },
    settings: { ...DEFAULT_POMODORO_SETTINGS },
  },
  profiles: [],
  activeProfileId: '',
  onboardingDone: false,
};

const PROFILE_DEFAULT_COLORS = ['#a78bfa', '#f59e0b', '#22d3ee', '#22c55e', '#f472b6', '#60a5fa', '#facc15', '#f97316'];

/** Migration: legacy shape (top-level `layout`/`hidden`, no `profiles`) → new
 *  profile-shaped state. Idempotent: returns input unchanged if already migrated. */
function migrateTweaks(loaded: Record<string, unknown>): Record<string, unknown> {
  // Old `quality` perfMode was renamed to `uncapped`. Same behavior; just clearer label.
  if (loaded.perfMode === 'quality') {
    loaded.perfMode = 'uncapped';
  }
  // 12 built-in viz styles were retired from the binary and now live in the
  // shop as `bundle:` ids. A saved selection naming one of them is rewritten
  // here so it keeps working the moment the user installs its replacement —
  // and falls back to Bars via HiFiVizSurface's dispatch until they do.
  if (typeof loaded.vizMode === 'string') {
    loaded.vizMode = remapRetiredVizMode(loaded.vizMode);
  }
  const profilesField = loaded.profiles;
  // True first launch: nothing was loaded from disk at all (no profiles, no
  // legacy layout, no todos). Used below to seed demo todos.
  const isFirstLaunch = !loaded.profiles && !loaded.todos && !loaded.layout;

  let result: Record<string, unknown>;
  if (Array.isArray(profilesField) && profilesField.length > 0) {
    result = loaded;
  } else {
    const legacyLayout = (loaded.layout as Layout | undefined) ?? {};
    const legacyHidden = (loaded.hidden as Partial<Record<TileType, boolean>> | undefined) ?? {};
    const next: Record<string, unknown> = { ...loaded };
    delete next.layout;
    delete next.hidden;

    const seeded: Profile[] = [
      migrateLegacyProfileToOrientations({
        id: newId(), name: 'Work', color: PROFILE_DEFAULT_COLORS[0]!,
        layout: legacyLayout, hidden: legacyHidden,
      }),
      migrateLegacyProfileToOrientations({
        id: newId(), name: 'Gaming', color: PROFILE_DEFAULT_COLORS[1]!,
        layout: {}, hidden: {},
      }),
      migrateLegacyProfileToOrientations({
        id: newId(), name: 'Chill', color: PROFILE_DEFAULT_COLORS[2]!,
        layout: {}, hidden: {},
      }),
    ];
    next.profiles = seeded;
    next.activeProfileId = seeded[0]!.id;

    // Seed two demo todos on absolute-first launch (only when nothing was loaded)
    // so the Notes tile isn't empty when a friend opens the app.
    if (isFirstLaunch) {
      next.todos = [
        { id: newId(), text: 'Try clicking ⛶ on the visualizer for immersive mode', done: false, createdAt: Date.now() - 2000 },
        { id: newId(), text: 'Press V to cycle visualizer styles', done: false, createdAt: Date.now() - 1000 },
      ];
    }
    result = next;
  }

  // Orientation migration: profiles loaded from disk in legacy shape (no `landscape`/
  // `portrait`) get fraction-converted to the orientation-aware shape. Idempotent —
  // already-migrated profiles pass through unchanged. Runs BEFORE mixer migration
  // so the latter can read `p.landscape.layout`.
  if (!result.orientation_migration_v1) {
    const profiles = result.profiles as Array<Record<string, unknown>> | undefined;
    if (profiles) {
      result.profiles = profiles.map((p) =>
        migrateLegacyProfileToOrientations(p as Parameters<typeof migrateLegacyProfileToOrientations>[0])
      );
    }
    result.orientation_migration_v1 = true;
  }

  // Mixer tile (added 2026-05): hide it on profiles that already have a saved
  // layout — those rail positions were anchored before the new tile existed,
  // so auto-inserting would visually overlap them. Fresh installs and brand-new
  // profiles get the mixer visible by default. Idempotent via flag.
  if (!result.mixer_migration_v1) {
    const profiles = result.profiles as Array<Record<string, unknown>> | undefined;
    if (profiles) {
      result.profiles = profiles.map((p) => {
        const landscape = p.landscape as { layout?: Layout; hidden?: Partial<Record<TileType, boolean>> } | undefined;
        const hasCustomLandscape = Object.keys(landscape?.layout ?? {}).length > 0;
        if (!hasCustomLandscape) return p;
        return {
          ...p,
          landscape: { ...landscape, hidden: { ...landscape?.hidden, mixer: true } },
        };
      });
    }
    result.mixer_migration_v1 = true;
  }

  // Tile-array migration: each orientation's {layout, hidden} becomes {tiles}.
  // Idempotent via the v1 flag. Defensive fallback: if migration produces an
  // empty array but the source had data, use full defaults.
  if (!result.tile_array_migration_v1) {
    const profiles = result.profiles as Array<Record<string, unknown>> | undefined;
    if (profiles) {
      result.profiles = profiles.map((p) => {
        const profile = p as Record<string, unknown>;
        const migrateOrientation = (
          slotRaw: unknown,
          defaults: Record<TileType, Rect>,
        ): { tiles: TileInstance[] } => {
          const slot = slotRaw as { layout?: Layout; hidden?: Partial<Record<TileType, boolean>>; tiles?: TileInstance[] } | undefined;
          if (slot?.tiles) return { tiles: slot.tiles };
          const layout = slot?.layout ?? {};
          const hidden = slot?.hidden ?? {};
          let tiles = migrateLayoutHiddenToTiles(layout, hidden, defaults);
          const hadData = Object.keys(layout).length > 0 || Object.keys(hidden).length > 0;
          if (tiles.length === 0 && hadData) {
            tiles = ALL_TILE_TYPES.map((type) => ({
              instanceId: newId(), type, rect: defaults[type],
            }));
          }
          return { tiles };
        };
        return {
          ...profile,
          landscape: migrateOrientation(profile.landscape, DEFAULT_LANDSCAPE_LAYOUT),
          portrait: migrateOrientation(profile.portrait, DEFAULT_PORTRAIT_LAYOUT),
        };
      });
    }
    result.tile_array_migration_v1 = true;
  }
  return result;
}

export default function App() {
  const [t, setTweak, replaceTweaks] = useTweaks<TweakState>(TWEAK_DEFAULTS, { migrate: migrateTweaks });
  useEffect(() => {
    if (t.profiles.length > 0 && t.activeProfileId) return;
    const seeded: Profile[] = [
      migrateLegacyProfileToOrientations({ id: newId(), name: 'Work',   color: PROFILE_DEFAULT_COLORS[0]!, layout: {}, hidden: {} }),
      migrateLegacyProfileToOrientations({ id: newId(), name: 'Gaming', color: PROFILE_DEFAULT_COLORS[1]!, layout: {}, hidden: {} }),
      migrateLegacyProfileToOrientations({ id: newId(), name: 'Chill',  color: PROFILE_DEFAULT_COLORS[2]!, layout: {}, hidden: {} }),
    ];
    setTweak('profiles', seeded);
    setTweak('activeProfileId', seeded[0]!.id);
  }, [t.profiles.length, t.activeProfileId, setTweak]);

  useEffect(() => {
    // First-ever launch: profile system is ready AND user hasn't completed onboarding.
    if (!t.onboardingDone && t.profiles.length > 0 && t.activeProfileId) {
      setShowOnboarding(true);
    }
    // We DO want this to fire whenever onboardingDone toggles to false (e.g., user
    // clicks "Replay onboarding" in Settings). But auto-trigger only on
    // initial state where it's already false.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [manualTrack, setManualTrack] = useState<Track>(TRACKS[0]!);
  const [editMode, setEditMode] = useState(false);
  const [snapEnabled, setSnapEnabled] = useState(true);
  const [showSwitcher, setShowSwitcher] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [showGallery, setShowGallery] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showTileLibrary, setShowTileLibrary] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [selectedInstanceId, setSelectedInstanceId] = useState<string>('');
  // Transient "theme synced" toast: holds the track title being announced, or
  // null when hidden. Set by the effect below when accent is track-linked and
  // the title changes; auto-cleared after 2s.
  const [themeToast, setThemeToast] = useState<string | null>(null);
  const { styles: vizStyles, loaded: vizStylesLoaded } = useVizStyles();
  const spectrumRef = useSpectrumRef();
  const { track: livePlaying, playback: livePlayback, sourceAppId: liveSourceAppId } = useNowPlaying();
  // Real GSMTC track wins when it's available; otherwise the user's manual
  // selection from the "Up next" list (or the initial demo) drives the theme.
  const track: Track = livePlaying ?? manualTrack;
  const setTrack = setManualTrack;

  const palette = ACCENT_PALETTES[t.accentTheme];
  const accent = palette.accent ?? track.accent;
  const accent2 = palette.accent2 ?? track.accent2;
  const accentLinked = t.accentTheme === 'auto';
  const vizAccent  = t.vizColorOverride.enabled ? t.vizColorOverride.accent  : accent;
  const vizAccent2 = t.vizColorOverride.enabled ? t.vizColorOverride.accent2 : accent2;

  useEffect(() => {
    document.documentElement.style.setProperty('--accent', accent);
    document.documentElement.style.setProperty('--accent2', accent2);
  }, [accent, accent2]);

  // Theme-sync toast: when the accent follows the track ("auto" theme) and the
  // track title changes, announce it for 2 seconds. Skips the initial mount
  // (prev === null) so app launch doesn't toast. Timer is cleared on re-fire
  // and unmount via the effect cleanup.
  const prevToastTitleRef = useRef<string | null>(null);
  useEffect(() => {
    const prev = prevToastTitleRef.current;
    prevToastTitleRef.current = track.title;
    if (!accentLinked || prev === null || prev === track.title) return;
    setThemeToast(track.title);
    const id = setTimeout(() => setThemeToast(null), 2000);
    return () => clearTimeout(id);
  }, [accentLinked, track.title]);

  // Perf-debug instrumentation: enable/disable the long-task observer +
  // ResizeObserver-wrap + window-resize counter as the user toggles. When off,
  // every record* call short-circuits, so the data feeds below cost ~nothing.
  useEffect(() => {
    if (t.perfDebug) perfDebug.enable();
    else perfDebug.disable();
  }, [t.perfDebug]);

  // Mirror the close-to-tray tweak into the Rust runtime flag that the
  // window's CloseRequested handler reads. Browser dev has no Tauri backend.
  useEffect(() => {
    (async () => {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        await invoke('set_close_to_tray', { enabled: t.closeToTray });
      } catch { /* browser dev — no tauri */ }
    })();
  }, [t.closeToTray]);

  // Feed perf-mode + viz-mode into the debug context so spike snapshots include
  // them; cheap unconditional call, the module ignores when not enabled.
  useEffect(() => {
    perfDebug.recordContext(t.perfMode, t.vizMode);
  }, [t.perfMode, t.vizMode]);

  useEffect(() => {
    let audioHz = 30;
    switch (t.perfMode) {
      case 'uncapped':
        setVizDprCap(window.devicePixelRatio || 1);
        setVizMaxFps(0);
        audioHz = 60;
        break;
      case 'high':
        setVizDprCap(1.5);
        setVizMaxFps(120);
        audioHz = 60;
        break;
      case 'balanced':
        setVizDprCap(1.0);
        setVizMaxFps(60);
        audioHz = 30;
        break;
      case 'battery':
        setVizDprCap(1.0);
        setVizMaxFps(30);
        audioHz = 15;
        break;
    }
    // Push the audio FFT rate to Rust. Halving it on Balanced/Battery is the
    // biggest single CPU win when audio is actively playing.
    void import('@tauri-apps/api/core').then(({ invoke }) => {
      invoke('set_audio_emit_hz', { hz: audioHz }).catch(() => {});
    });
    // Nudge canvases to re-read their bounding rect with the new DPR.
    // ResizeObserver fires on subtree size changes; window resize is the cheap
    // trigger that all our viz already listen to.
    window.dispatchEvent(new Event('resize'));
  }, [t.perfMode]);

  useEffect(() => {
    // Whenever the saved location changes (including initial load from disk),
    // tell Rust so the next emit is for the right city.
    void import('./state/weatherLocation').then(({ pushLocationToRust }) =>
      pushLocationToRust(t.weatherLocation),
    );
  }, [t.weatherLocation]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const cmd = e.metaKey || e.ctrlKey;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName ?? '';
      const editing = tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable === true;
      if (cmd && e.key === 'e') { e.preventDefault(); setEditMode((m) => !m); }
      else if (cmd && e.key === ',') { e.preventDefault(); setShowSettings((s) => !s); }
      else if (cmd && (e.key === '1' || e.key === '2' || e.key === '3')) {
        e.preventDefault();
        const idx = parseInt(e.key, 10) - 1;
        const p = t.profiles[idx];
        if (p) setTweak('activeProfileId', p.id);
      }
      else if (e.key === 'Escape') {
        if (showShortcuts) setShowShortcuts(false);
        else if (showTileLibrary) setShowTileLibrary(false);
        else if (showSettings) setShowSettings(false);
        else if (showGallery) setShowGallery(false);
        else if (showSwitcher) setShowSwitcher(false);
        else if (showOnboarding) setShowOnboarding(false);
        else if (editMode) setEditMode(false);
      }
      else if (!editing && !cmd && e.key === '?') {
        // Toggle the shortcut cheat sheet. Opens only when no other modal is
        // up (it would z-fight and confuse the Esc cascade); "?" again closes.
        if (showShortcuts) {
          e.preventDefault();
          setShowShortcuts(false);
        } else if (!showTileLibrary && !showSettings && !showGallery && !showSwitcher && !showOnboarding) {
          e.preventDefault();
          setShowShortcuts(true);
        }
      }
      else if (!editing && !cmd && (e.key === 'v' || e.key === 'V')) {
        // Guard on vizStylesLoaded — same root cause as the Critical fixed in
        // Task 9. Before visualizers_list resolves, a `bundle:` t.vizMode has
        // no match in `ids`, so indexOf is -1 and (−1+1)%len lands on index 0
        // — silently persisting 'bars' over the user's actual selection. Make
        // cycling a no-op until the catalog is known rather than guessing.
        if (!vizStylesLoaded) return;
        const ids = vizStyles.map((s) => s.id);
        const i = ids.indexOf(t.vizMode);
        setTweak('vizMode', ids[(i + 1) % ids.length] ?? 'bars');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showSwitcher, editMode, showOnboarding, showGallery, showSettings, showTileLibrary, showShortcuts, t.vizMode, t.profiles, setTweak, vizStyles, vizStylesLoaded]);

  const orientation = useOrientation();
  const canvas = useCanvas();

  const overlaysOpen = editMode || showSwitcher || showOnboarding;
  const fallbackProfile = useMemo<Profile>(() => ({
    id: '_fallback', name: 'Default', color: '#a78bfa',
    landscape: { tiles: ALL_TILE_TYPES.map((type) => ({ instanceId: newId(), type, rect: DEFAULT_LANDSCAPE_LAYOUT[type] })) },
    portrait:  { tiles: ALL_TILE_TYPES.map((type) => ({ instanceId: newId(), type, rect: DEFAULT_PORTRAIT_LAYOUT[type] })) },
  }), []);
  const activeProfile: Profile = t.profiles.find((p) => p.id === t.activeProfileId) ?? t.profiles[0] ?? fallbackProfile;
  const activeOrientation = activeProfile[orientation];
  const visibleTileCount = activeOrientation.tiles.length;
  useEffect(() => {
    if (selectedInstanceId && activeOrientation.tiles.some((t) => t.instanceId === selectedInstanceId)) return;
    setSelectedInstanceId(activeOrientation.tiles[0]?.instanceId ?? '');
  }, [activeOrientation.tiles, selectedInstanceId]);
  const updateActiveProfile = (patch: Partial<Profile>) => {
    setTweak('profiles', t.profiles.map((p) =>
      p.id === activeProfile.id ? { ...p, ...patch } : p
    ));
  };
  const updateActiveOrientation = (patch: Partial<OrientationLayout>) => {
    updateActiveProfile({
      [orientation]: { ...activeOrientation, ...patch },
    } as Partial<Profile>);
  };
  const removeTileByType = (type: TileType) => {
    const inst = findInstance(activeOrientation.tiles, type);
    if (!inst) return;
    updateActiveOrientation({ tiles: removeInstance(activeOrientation.tiles, inst.instanceId) });
  };
  const addTileByType = (type: TileType) => {
    if (findInstance(activeOrientation.tiles, type)) return;
    const defaults = orientation === 'portrait' ? DEFAULT_PORTRAIT_LAYOUT : DEFAULT_LANDSCAPE_LAYOUT;
    // A bundle tile (`bundle:<id>`) has no compile-time entry in the default
    // layout maps — fall back to the shared bundle default rect.
    const rect = isBundleTile(type) ? DEFAULT_BUNDLE_TILE_RECT[orientation] : defaults[type];
    updateActiveOrientation({
      tiles: addInstance(activeOrientation.tiles, {
        instanceId: newId(), type, rect,
      }),
    });
  };
  const resetLayout = () => {
    const defaults = orientation === 'portrait' ? DEFAULT_PORTRAIT_LAYOUT : DEFAULT_LANDSCAPE_LAYOUT;
    updateActiveOrientation({
      tiles: ALL_TILE_TYPES.map((type) => ({
        instanceId: newId(), type, rect: defaults[type],
      })),
    });
  };

  const renderTile = (instance: TileInstance) => {
    switch (instance.type) {
      case 'discord':
        return <DiscordTile density={t.density} accent={accent} />;
      case 'spotify':
        return <SpotifyTile density={t.density} accent={accent} accent2={accent2} track={track} onPick={setTrack} playback={livePlayback} sourceAppId={liveSourceAppId} spectrumRef={spectrumRef} />;
      case 'claude':
        return <ClaudeCodeTile density={t.density} accent={accent} />;
      case 'mixer':
        return <AudioMixerTile density={t.density} accent={accent} accent2={accent2} spectrumRef={spectrumRef} />;
      case 'notes':
        return <NotesTile density={t.density} accent={accent} todos={t.todos} setTodos={(next) => setTweak('todos', next)} />;
      case 'sysmon':
        return <SysMonTile density={t.density} accent={accent} accent2={accent2} />;
      case 'clock':
        return <NowAndForecastTile density={t.density} accent={accent} accent2={accent2} />;
      case 'viz':
        return (
          <VizHero
            mode={t.vizMode}
            setMode={(m) => setTweak('vizMode', m)}
            accent={vizAccent}
            accent2={vizAccent2}
            track={track}
            spectrumRef={spectrumRef}
            playback={livePlayback}
            showArtBg={t.vizArtBg}
            sensitivity={t.vizSensitivity}
            smoothing={t.vizSmoothing}
            lyricsOverlayEnabled={t.lyricsOverlayEnabled}
            videoEnabled={t.videoEnabled}
            videoBookmarks={t.videoBookmarks}
            videoCurrentUrl={t.videoCurrentUrl}
            videoAvailable={t.videoBookmarks.length > 0}
            onToggleVideo={() => setTweak('videoEnabled', !t.videoEnabled)}
            onNavigate={(url) => setTweak('videoCurrentUrl', url)}
            onExit={() => setTweak('videoEnabled', false)}
            overlaysOpen={showGallery || editMode || showTileLibrary}
            paused={(t.videoEnabled && t.videoBookmarks.length > 0) || showGallery || (t.perfMode !== 'uncapped' && livePlayback?.playing !== true)}
            onConfigure={() => setShowGallery(true)}
            audioDebug={t.audioDebug}
          />
        );
      case 'streamDeck':
        return (
          <StreamDeckTile
            config={parseStreamDeckConfig(instance.config)}
            setConfig={(next) => updateActiveOrientation({
              tiles: updateInstance(activeOrientation.tiles, instance.instanceId, { config: next as unknown as Record<string, unknown> }),
            })}
            editing={editMode}
            density={t.density}
            accent={accent}
            vizMode={t.vizMode}
            setVizMode={(m) => setTweak('vizMode', m)}
            profiles={t.profiles}
            setActiveProfileId={(id) => setTweak('activeProfileId', id)}
          />
        );
      case 'weatherRadar':
        return (
          <RadarTile
            density={t.density}
            accent={accent}
            location={t.weatherLocation}
          />
        );
      case 'pomodoro':
        return (
          <PomodoroTile
            density={t.density}
            accent={accent}
            editing={editMode}
            state={t.pomodoro.state}
            setState={(next) => setTweak('pomodoro', { ...t.pomodoro, state: next })}
            settings={t.pomodoro.settings}
            setSettings={(next) => setTweak('pomodoro', { ...t.pomodoro, settings: next })}
          />
        );
      case 'sun':
        return (
          <SunTile
            density={t.density}
            accent={accent}
            location={t.weatherLocation}
          />
        );
      case 'aurora':
        return (
          <AuroraTile
            density={t.density}
            accent={accent}
            location={t.weatherLocation}
          />
        );
      case 'airQuality':
        return (
          <AirQualityTile
            density={t.density}
            accent={accent}
            location={t.weatherLocation}
          />
        );
      case 'stocks':
        return (
          <StocksTile
            instanceId={instance.instanceId}
            density={t.density}
            accent={accent}
            editing={editMode}
            config={instance.config as Record<string, unknown> | undefined}
            setConfig={(next) => updateActiveOrientation({
              tiles: updateInstance(activeOrientation.tiles, instance.instanceId, { config: next }),
            })}
          />
        );
      case 'tides':
        return (
          <TidesTile
            density={t.density}
            accent={accent}
            editing={editMode}
            config={instance.config as Record<string, unknown> | undefined}
            setConfig={(next) => updateActiveOrientation({
              tiles: updateInstance(activeOrientation.tiles, instance.instanceId, { config: next }),
            })}
          />
        );
      case 'githubPrs':
        return (
          <GithubPrsTile
            density={t.density}
            accent={accent}
            editing={editMode}
          />
        );
      case 'streamChat':
        return (
          <StreamChatTile
            instanceId={instance.instanceId}
            density={t.density}
            accent={accent}
            editing={editMode}
            config={instance.config as Record<string, unknown> | undefined}
            setConfig={(next) => updateActiveOrientation({
              tiles: updateInstance(activeOrientation.tiles, instance.instanceId, { config: next }),
            })}
          />
        );
      case 'phoneNotifs':
        return (
          <PhoneNotifsTile
            density={t.density}
            accent={accent}
            editing={editMode}
          />
        );
      case 'homeAssistant':
        return (
          <HomeAssistantTile
            density={t.density}
            accent={accent}
            editing={editMode}
          />
        );
      case 'scratchpad':
        return (
          <ScratchpadTile
            instanceId={instance.instanceId}
            density={t.density}
            accent={accent}
          />
        );
      case 'quote':
        return <QuoteTile density={t.density} accent={accent} />;
      case 'onThisDay':
        return <OnThisDayTile density={t.density} accent={accent} />;
      case 'randomWiki':
        return <RandomWikiTile density={t.density} accent={accent} />;
      case 'wordOfDay':
        return <WordOfDayTile density={t.density} accent={accent} />;
      case 'iss':
        return <IssTile density={t.density} accent={accent} location={t.weatherLocation} />;
      case 'launches':
        return <LaunchesTile density={t.density} accent={accent} />;
      case 'dailyChallenge':
        return <DailyChallengeTile density={t.density} accent={accent} />;
      case 'pollen':
        return <PollenTile density={t.density} accent={accent} editing={editMode} location={t.weatherLocation} />;
      case 'birds':
        return (
          <BirdsTile
            density={t.density}
            accent={accent}
            editing={editMode}
            location={t.weatherLocation}
          />
        );
      case 'solarFlare':
        return <SolarFlareTile density={t.density} accent={accent} />;
      case 'lightning':
        return <LightningTile density={t.density} accent={accent} location={t.weatherLocation} />;
      case 'aircraft':
        return <AircraftTile density={t.density} accent={accent} location={t.weatherLocation} />;
      case 'activeWindow':
        return <ActiveWindowTile density={t.density} accent={accent} />;
      case 'docker':
        return <DockerTile density={t.density} accent={accent} />;
      case 'energy':
        return (
          <EnergyTile
            density={t.density}
            accent={accent}
            accent2={accent2}
            editing={editMode}
            config={instance.config as Record<string, unknown> | undefined}
            setConfig={(next) => updateActiveOrientation({
              tiles: updateInstance(activeOrientation.tiles, instance.instanceId, { config: next }),
            })}
          />
        );
      default:
        // Bundle tiles (`bundle:<id>`) are a real TileType as of the tile-
        // registry work, but nothing yet creates a TileInstance of one —
        // rendering its view.json payload is a later task in the
        // marketplace-tiles plan. Render nothing rather than throw.
        return null;
    }
  };

  return (
    <div style={{ width: '100vw', height: '100vh', background: '#000', overflow: 'hidden' }}>
      <div data-canvas-root style={{
        width: '100%', height: '100%',
        background: '#06070a', position: 'relative', overflow: 'hidden',
      }}>
        <TopChrome
          accent={accent} editMode={editMode} setEditMode={setEditMode}
          profiles={t.profiles}
          activeProfileId={t.activeProfileId}
          setActiveProfileId={(id) => setTweak('activeProfileId', id)}
          onSwitcher={() => setShowSwitcher(true)}
          onOnboarding={() => setShowOnboarding(true)}
          onSettings={() => setShowSettings(true)}
          onShortcuts={() => setShowShortcuts(true)}
        />
        {accentLinked && !showOnboarding && themeToast !== null && (
          <ThemeToast accent={accent} title={themeToast} />
        )}
        {activeOrientation.tiles.map((instance) => {
          return (
            <TileFrame
              key={instance.instanceId}
              id={instance.instanceId}
              rect={instance.rect}
              editing={editMode}
              snap={snapEnabled}
              selected={selectedInstanceId === instance.instanceId}
              onSelect={() => setSelectedInstanceId(instance.instanceId)}
              onChange={(r) => updateActiveOrientation({
                tiles: updateInstance(activeOrientation.tiles, instance.instanceId, { rect: r }),
              })}
              accent={accent}
            >
              <Suspense fallback={<TileSkeleton rows={3} />}>
                {renderTile(instance)}
              </Suspense>
            </TileFrame>
          );
        })}
        <BottomStatus
          accent={accent}
          onSwitcher={() => setShowSwitcher(true)}
          profileName={activeProfile.name}
          tileCount={visibleTileCount}
        />
        {editMode && (
          <EditModeOverlay
            accent={accent}
            accent2={accent2}
            onExit={() => setEditMode(false)}
            onRemove={(instanceId) => updateActiveOrientation({
              tiles: removeInstance(activeOrientation.tiles, instanceId),
            })}
            onAdd={(type, rect) => updateActiveOrientation({
              tiles: addInstance(activeOrientation.tiles, {
                instanceId: newId(), type, rect,
              }),
            })}
            tiles={activeOrientation.tiles}
            setTiles={(next) => updateActiveOrientation({ tiles: next })}
            selectedInstanceId={selectedInstanceId}
            setSelectedInstanceId={setSelectedInstanceId}
            snap={snapEnabled}
            setSnap={setSnapEnabled}
            profileName={activeProfile.name}
          />
        )}
        {showSwitcher && (
          <ProfileSwitcher
            accent={accent}
            profiles={t.profiles}
            activeProfileId={t.activeProfileId}
            setActiveProfileId={(id) => setTweak('activeProfileId', id)}
            setProfiles={(next) => setTweak('profiles', next)}
            onClose={() => setShowSwitcher(false)}
          />
        )}
        {showOnboarding && (
          <Onboarding
            accent={accent}
            profiles={t.profiles}
            onFinish={(result) => {
              // Apply user choices to tweaks. If result is undefined (Skip setup),
              // we still mark onboardingDone but don't apply anything.
              if (result?.profileId) {
                setTweak('activeProfileId', result.profileId);
              }
              if (result?.hiddenForActive) {
                const targetId = result.profileId ?? t.activeProfileId;
                const hiddenMap = result.hiddenForActive!;
                setTweak('profiles', t.profiles.map((p) => {
                  if (p.id !== targetId) return p;
                  const hideTypes = (Object.keys(hiddenMap) as TileType[]).filter((type) => hiddenMap[type]);
                  let landTiles = p.landscape.tiles;
                  let portTiles = p.portrait.tiles;
                  for (const type of hideTypes) {
                    const li = findInstance(landTiles, type);
                    if (li) landTiles = removeInstance(landTiles, li.instanceId);
                    const pi = findInstance(portTiles, type);
                    if (pi) portTiles = removeInstance(portTiles, pi.instanceId);
                  }
                  return { ...p, landscape: { tiles: landTiles }, portrait: { tiles: portTiles } };
                }));
              }
              setTweak('onboardingDone', true);
              setShowOnboarding(false);
            }}
          />
        )}
        {showGallery && (
          <Suspense fallback={null}>
            <VizGallery
              accent={vizAccent}
              accent2={vizAccent2}
              spectrumRef={spectrumRef}
              currentMode={t.vizMode}
              sensitivity={t.vizSensitivity}
              smoothing={t.vizSmoothing}
              onPick={(m) => setTweak('vizMode', m)}
              onClose={() => setShowGallery(false)}
            />
          </Suspense>
        )}
        {showTileLibrary && (
          <TileLibrary
            orientation={orientation}
            canvas={canvas}
            tiles={activeOrientation.tiles}
            profileName={activeProfile.name}
            accent={accent}
            onAdd={(type, rect) => updateActiveOrientation({
              tiles: addInstance(activeOrientation.tiles, {
                instanceId: newId(), type, rect,
              }),
            })}
            onRemove={(instanceId) => updateActiveOrientation({
              tiles: removeInstance(activeOrientation.tiles, instanceId),
            })}
            onClose={() => setShowTileLibrary(false)}
          />
        )}
      </div>

      {showSettings && (
        <SettingsWindow
          values={t}
          // TweakState is a strict superset of SettingsValues (same keys, same
          // types), but TS can't prove the per-key correspondence across two
          // generic signatures — hence the unknown bridge. Callers stay typed.
          set={(key, value) => setTweak(key, value as unknown as TweakState[typeof key])}
          accent={accent}
          accent2={accent2}
          accentLinked={accentLinked}
          trackTitle={track.title}
          onOpenTileLibrary={() => { setShowSettings(false); setShowTileLibrary(true); }}
          onReplayOnboarding={() => { setShowSettings(false); setShowOnboarding(true); }}
          onResetLayout={resetLayout}
          onExportSettings={async () => {
            try {
              const { invoke } = await import('@tauri-apps/api/core');
              await invoke('tweaks_export', { json: JSON.stringify(t) });
            } catch (err) {
              console.warn('settings export/import failed:', err);
            }
          }}
          onImportSettings={async () => {
            try {
              const { invoke } = await import('@tauri-apps/api/core');
              const text = await invoke<string | null>('tweaks_import');
              if (text) replaceTweaks(JSON.parse(text) as Record<string, unknown>);
            } catch (err) {
              console.warn('settings export/import failed:', err);
            }
          }}
          onClose={() => setShowSettings(false)}
        />
      )}

      {showShortcuts && (
        <ShortcutsOverlay accent={accent} onClose={() => setShowShortcuts(false)} />
      )}

      {t.perfDebug && <PerfDebugHUD />}
    </div>
  );
}

function TopChrome({ accent, editMode, setEditMode, profiles, activeProfileId, setActiveProfileId, onSwitcher, onOnboarding, onSettings, onShortcuts }: {
  accent: string;
  editMode: boolean;
  setEditMode: (b: boolean) => void;
  profiles: Profile[];
  activeProfileId: string;
  setActiveProfileId: (id: string) => void;
  onSwitcher: () => void;
  onOnboarding: () => void;
  onSettings: () => void;
  onShortcuts: () => void;
}) {
  const visibleProfiles = profiles.slice(0, 4);
  const overflow = Math.max(0, profiles.length - visibleProfiles.length);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  // Anchored ⋯ menu: outside pointerdown or Esc closes. The Esc handler lives
  // on document (bubbles before App's window-level cascade) and stops
  // propagation so closing the menu doesn't also pop an overlay.
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setMenuOpen(false);
      }
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  const ghostButton: React.CSSProperties = {
    padding: '5px 10px', fontSize: 11, borderRadius: 6,
    background: 'transparent', color: 'rgba(255,255,255,0.7)',
    border: '1px solid rgba(255,255,255,0.1)',
    cursor: 'pointer', fontWeight: 600,
  };
  const menuItem: React.CSSProperties = {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
    width: '100%', padding: '7px 10px', fontSize: 11.5, borderRadius: 5,
    background: 'transparent', color: 'rgba(255,255,255,0.75)',
    border: 'none', cursor: 'pointer', textAlign: 'left', fontWeight: 500,
  };

  return (
    <div style={{
      position: 'absolute', top: 0, left: 0, right: 0, height: 56,
      background: 'rgba(8,9,12,0.85)', backdropFilter: 'blur(10px)',
      borderBottom: '1px solid rgba(255,255,255,0.05)',
      display: 'flex', alignItems: 'center', padding: '0 18px', gap: 16, zIndex: 10,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ width: 16, height: 16, borderRadius: 5, background: `linear-gradient(135deg, ${accent}, ${accent}99)`, boxShadow: `0 0 12px ${accent}66` }} />
        <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: '-0.01em' }}>Hub</span>
      </div>
      <div style={{ width: 1, height: 18, background: 'rgba(255,255,255,0.08)' }} />
      <div style={{ display: 'flex', gap: 4 }}>
        {visibleProfiles.map((p) => {
          const active = p.id === activeProfileId;
          return (
            <button key={p.id} onClick={() => setActiveProfileId(p.id)} style={{
              padding: '5px 12px', fontSize: 11, borderRadius: 6,
              background: active ? `${p.color}22` : 'transparent',
              color: active ? p.color : 'rgba(255,255,255,0.5)',
              border: active ? `1px solid ${p.color}66` : '1px solid transparent',
              cursor: 'pointer', fontWeight: active ? 600 : 400,
            }}>{p.name}</button>
          );
        })}
        <button onClick={onSwitcher} title="Open profile switcher" style={{
          padding: '5px 8px', fontSize: 11, borderRadius: 6,
          background: 'transparent', color: 'rgba(255,255,255,0.4)',
          border: '1px solid transparent', cursor: 'pointer',
        }}>{overflow > 0 ? `+${overflow} More` : '⌃ More'}</button>
      </div>
      <div style={{ flex: 1 }} />
      <button onClick={() => setEditMode(!editMode)} style={{
        ...ghostButton,
        display: 'flex', alignItems: 'center', gap: 7,
        background: editMode ? accent : 'transparent',
        color: editMode ? '#000' : 'rgba(255,255,255,0.7)',
        border: editMode ? '1px solid transparent' : '1px solid rgba(255,255,255,0.1)',
      }}>
        <span>✎ Edit</span>
        <span style={{
          fontSize: 9.5, fontFamily: '"JetBrains Mono", ui-monospace, monospace',
          color: editMode ? 'rgba(0,0,0,0.55)' : 'rgba(255,255,255,0.35)',
          fontWeight: 500, letterSpacing: '.03em',
        }}>⌘E</span>
      </button>
      <button onClick={onSettings} title="Settings (⌘,)" style={{ ...ghostButton, padding: '5px 9px' }}>⚙</button>
      <div ref={menuRef} style={{ position: 'relative' }}>
        <button
          onClick={() => setMenuOpen((o) => !o)}
          title="More"
          style={{
            ...ghostButton, padding: '5px 9px',
            background: menuOpen ? 'rgba(255,255,255,0.08)' : 'transparent',
          }}
        >⋯</button>
        {menuOpen && (
          <div style={{
            position: 'absolute', top: 'calc(100% + 6px)', right: 0, minWidth: 190,
            background: 'rgba(20,22,28,0.96)', border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: 8, padding: 4, zIndex: 30,
            boxShadow: '0 12px 40px rgba(0,0,0,0.5)',
          }}>
            <button
              onClick={() => { setMenuOpen(false); onOnboarding(); }}
              style={menuItem}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.06)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
            >
              <span>Replay setup</span>
              <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)' }}>↻</span>
            </button>
            <button
              onClick={() => { setMenuOpen(false); onShortcuts(); }}
              style={menuItem}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.06)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
            >
              <span>Keyboard shortcuts</span>
              <span style={{
                fontSize: 10, fontFamily: '"JetBrains Mono", ui-monospace, monospace',
                color: 'rgba(255,255,255,0.4)',
                background: 'rgba(255,255,255,0.06)', borderRadius: 4, padding: '1px 6px',
              }}>?</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/** Transient "theme synced" pill just under the top bar. Fades in on mount
 *  (opacity transition kicked off one frame after mount) and fades back out
 *  shortly before the parent unmounts it at the 2s mark. Re-keyed re-renders
 *  restart the cycle via the [title] dep. */
function ThemeToast({ accent, title }: { accent: string; title: string }) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    setVisible(false);
    const raf = requestAnimationFrame(() => setVisible(true));
    const hide = setTimeout(() => setVisible(false), 1700);
    return () => { cancelAnimationFrame(raf); clearTimeout(hide); };
  }, [title]);
  return (
    <div style={{
      position: 'absolute', top: 64, left: '50%', transform: 'translateX(-50%)',
      zIndex: 11, pointerEvents: 'none',
      fontSize: 10, color: accent, padding: '4px 10px',
      background: 'rgba(8,9,12,0.85)', backdropFilter: 'blur(8px)',
      borderRadius: 5, border: `1px solid ${accent}44`,
      boxShadow: `0 4px 18px rgba(0,0,0,0.4), 0 0 12px ${accent}22`,
      letterSpacing: '.05em', whiteSpace: 'nowrap',
      opacity: visible ? 1 : 0, transition: 'opacity 260ms ease',
    }}>
      ◐ Theme synced to “{title}”
    </div>
  );
}

const SHORTCUT_ROWS: ReadonlyArray<readonly [string, string]> = [
  ['V', 'Cycle visualizer style'],
  ['⌘E', 'Edit layout'],
  ['⌘,', 'Settings'],
  ['⌘1/2/3', 'Switch profile'],
  ['Esc', 'Close overlays'],
  ['?', 'This overlay'],
];

/** Centered keyboard-shortcut cheat sheet. Opened by "?" or the ⋯ menu;
 *  closed by Esc (front of App's cascade), "?" again, or backdrop click. */
function ShortcutsOverlay({ accent, onClose }: { accent: string; onClose: () => void }) {
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 70,
        background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 420, maxWidth: 'calc(100vw - 48px)',
          background: 'rgba(20,22,28,0.96)', border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: 12, padding: '18px 20px 10px',
          boxShadow: '0 24px 80px rgba(0,0,0,0.6)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: '-0.01em', color: 'rgba(255,255,255,0.9)' }}>
            Keyboard shortcuts
          </span>
          <span style={{
            fontSize: 10, fontFamily: '"JetBrains Mono", ui-monospace, monospace',
            color: accent, background: `${accent}15`, border: `1px solid ${accent}44`,
            borderRadius: 4, padding: '1px 7px',
          }}>?</span>
        </div>
        {SHORTCUT_ROWS.map(([keys, desc], i) => (
          <div key={keys} style={{
            display: 'flex', alignItems: 'center', gap: 14, padding: '9px 0',
            borderTop: i === 0 ? 'none' : '1px solid rgba(255,255,255,0.05)',
          }}>
            <span style={{
              minWidth: 64, textAlign: 'center',
              fontSize: 11, fontFamily: '"JetBrains Mono", ui-monospace, monospace',
              color: 'rgba(255,255,255,0.85)',
              background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.08)',
              borderRadius: 5, padding: '3px 8px',
            }}>{keys}</span>
            <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.65)' }}>{desc}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Measures actual rAF frame interval as a rolling average and returns FPS.
 *  Updates state once per second so we don't trash React with 60Hz re-renders.
 *  Also pushes the rolling rate into perf-debug for spike snapshots. */
function useFrameRate(): number {
  const [fps, setFps] = useState(60);
  useEffect(() => {
    let raf = 0;
    let frames = 0;
    let last = performance.now();
    const tick = (now: number) => {
      frames++;
      if (now - last >= 1000) {
        const rate = Math.round((frames * 1000) / (now - last));
        setFps(rate);
        perfDebug.recordFps(rate);
        frames = 0;
        last = now;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  return fps;
}

function BottomStatus({
  accent, onSwitcher, profileName, tileCount,
}: {
  accent: string;
  onSwitcher: () => void;
  profileName: string;
  tileCount: number;
}) {
  // The 1Hz sysmon subscription and rAF frame counter live HERE, not in App:
  // this bar is the only chrome that displays them, and keeping them out of
  // the root means the ~36 tile subtrees no longer reconcile every second.
  const sysmon = useSysmon();
  const fps = useFrameRate();
  const app = sysmon.latest.app;
  // GPU spike feed for perf-debug snapshots rides along with the only
  // remaining chrome-level sysmon subscriber.
  useEffect(() => {
    perfDebug.recordGpuSample(app?.gpu);
  }, [app?.gpu]);
  const cpuText = app ? `${app.cpu.toFixed(1)}%` : '—';
  const ramText = app ? (app.ram_mb >= 1024 ? `${(app.ram_mb / 1024).toFixed(2)} GB` : `${Math.round(app.ram_mb)} MB`) : '—';
  const gpuText = app && app.gpu != null ? `${app.gpu.toFixed(0)}%` : '—';
  // Effective viz draw rate = min(rAF rate, configured cap). When uncapped, just rAF.
  const cap = getVizMaxFps();
  const effectiveFps = cap > 0 ? Math.min(fps, cap) : fps;
  const fpsText = cap > 0 ? `${effectiveFps} fps · cap ${cap}` : `${fps} fps`;
  // Color based on whether the cap is being met or we're falling behind.
  const target = cap > 0 ? cap : 60;
  const fpsColor = effectiveFps >= target * 0.92 ? '#22c55e' : effectiveFps >= target * 0.5 ? '#facc15' : '#fb7185';
  return (
    <div style={{
      position: 'absolute', bottom: 0, left: 0, right: 0, height: 32,
      background: 'rgba(8,9,12,0.85)', backdropFilter: 'blur(10px)',
      borderTop: '1px solid rgba(255,255,255,0.05)',
      display: 'flex', alignItems: 'center', padding: '0 18px', gap: 18, zIndex: 10,
      fontSize: 10.5, color: 'rgba(255,255,255,0.45)', fontFamily: '"JetBrains Mono", ui-monospace, monospace',
    }}>
      <span style={{ color: accent }}>● {tileCount} tile{tileCount === 1 ? '' : 's'}</span>
      <span title="App CPU usage">CPU {cpuText}</span>
      <span title="App resident memory">RAM {ramText}</span>
      <span title="App GPU usage (via NVML, NVIDIA only)">GPU {gpuText}</span>
      <span title="Render frame rate" style={{ color: fpsColor }}>{fpsText}</span>
      <span>Audio: WASAPI loopback</span>
      <div style={{ flex: 1 }} />
      <button onClick={onSwitcher} style={{ background: 'transparent', border: 'none', color: 'rgba(255,255,255,0.45)', fontFamily: 'inherit', fontSize: 'inherit', cursor: 'pointer', padding: 0 }}>{profileName}</button>
      <span style={{ color: 'rgba(255,255,255,0.25)' }}>·</span>
      <span>⌘E edit · V cycle viz · ⌘1/2/3 profile</span>
    </div>
  );
}

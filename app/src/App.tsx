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
  findEmptyRect,
  addInstance,
  removeInstance,
  removeTilesOfType,
  updateInstance,
  remapRetiredTileType,
} from './state/layout';
import { seedStarterProfiles, PROFILE_DEFAULT_COLORS } from './state/starterProfiles';
import { isBundleTile, bundleIdOf } from './tiles/tileRegistry';
import { useTileCatalog } from './tiles/useTileCatalog';
import type { Track, Profile, AccentTheme, VizMode, Density, Todo, WeatherLocation } from './types';
import {
  DEFAULT_POMODORO_STATE,
  DEFAULT_POMODORO_SETTINGS,
  type PomodoroState,
  type PomodoroSettings,
} from './state/pomodoro';
import { TRACKS, ACCENT_PALETTES } from './data';
import { useTweaks } from './state/useTweaks';
import type { AudioSource } from './state/audioSource';
import { describeAudioSource, effectiveSensitivity, migrateAudioSource, migrateSensitivity } from './state/audioSource';
import { useAudioSource } from './state/useAudioSource';
import { UpdateToast } from './components/UpdateToast';
import { useSysmon, useNowPlaying, useSpectrumRef } from './state/tauri';
import { applySurfaces, computeSurfaces, glassTintAlpha, DEFAULT_GLASS_STRENGTH } from './state/theme';
import { setWindowHidden } from './state/framePace';
import { VizHero, setVizDprCap, setVizMaxFps, getVizMaxFps } from './components/viz';
import * as perfDebug from './perf/debug';
import { PerfDebugHUD } from './perf/PerfDebugHUD';
import { useVizStyles } from './components/useVizStyles';
import {
  remapRetiredVizMode,
  resolveVizSurface,
  resolvedVizModeLabel,
  bundleIdOf as vizBundleIdOf,
  isBundleMode as isVizBundleMode,
} from './state/contentRegistry';
import { markSeedSettled } from './state/seedStatus';
import { catalogKey } from './state/catalog';
import { defaultBookmarks, type Bookmark } from './components/browser-player';
import {
  SpotifyTile, NotesTile,
  SysMonTile,
} from './components/tiles';
import { EditModeOverlay } from './components/edit';
import { ContentLibrary } from './components/ContentLibrary';
import { ProfileSwitcher } from './components/profile';
import { Onboarding } from './components/onboarding';
import { TileFrame } from './components/TileFrame';
import { SettingsWindow } from './components/settings';
import { TileSkeleton } from './components/tileStates';
import { parseStreamDeckConfig } from './state/actions';

// Standalone tiles are lazy-loaded per-tile so the initial bundle only pays
// for what's actually visible in the active profile/orientation. Kept EAGER:
// './components/tiles' (Spotify/Notes/Sysmon — entangled with boot), VizHero,
// TileFrame, EditModeOverlay, ContentLibrary, ProfileSwitcher, Onboarding,
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
const StreamChatTile = lazy(() => import('./components/StreamChatTile').then((m) => ({ default: m.StreamChatTile })));
const HomeAssistantTile = lazy(() => import('./components/HomeAssistantTile').then((m) => ({ default: m.HomeAssistantTile })));
const ScratchpadTile = lazy(() => import('./components/ScratchpadTile').then((m) => ({ default: m.ScratchpadTile })));
const OnThisDayTile = lazy(() => import('./components/OnThisDayTile').then((m) => ({ default: m.OnThisDayTile })));
const IssTile = lazy(() => import('./components/IssTile').then((m) => ({ default: m.IssTile })));
const PollenTile = lazy(() => import('./components/PollenTile').then((m) => ({ default: m.PollenTile })));
const SolarFlareTile = lazy(() => import('./components/SolarFlareTile').then((m) => ({ default: m.SolarFlareTile })));
const LightningTile = lazy(() => import('./components/LightningTile').then((m) => ({ default: m.LightningTile })));
const AircraftTile = lazy(() => import('./components/AircraftTile').then((m) => ({ default: m.AircraftTile })));
const ActiveWindowTile = lazy(() => import('./components/ActiveWindowTile').then((m) => ({ default: m.ActiveWindowTile })));
const DockerTile = lazy(() => import('./components/DockerTile').then((m) => ({ default: m.DockerTile })));
const EnergyTile = lazy(() => import('./components/EnergyTile').then((m) => ({ default: m.EnergyTile })));
const DeclarativeTile = lazy(() => import('./components/DeclarativeTile').then((m) => ({ default: m.DeclarativeTile })));
const MissingTileCard = lazy(() => import('./components/MissingTileCard').then((m) => ({ default: m.MissingTileCard })));

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
  /** What the visualizer listens to — the whole system mix, or a strict
   *  include list of up to MAX_AUDIO_APPS apps. See state/audioSource.ts. */
  vizAudioSource: AudioSource;
  /** Per-source input gain, keyed by `sourceKey(vizAudioSource)`. Replaces
   *  the old single `vizSensitivity` scalar (migrated in migrateTweaks
   *  below) so switching sources doesn't clobber a tuned gain. */
  vizSensitivityBySource: Record<string, number>;
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
  /** Liquid glass: translucent surfaces + Windows acrylic behind the
   *  transparent window. Off by default — glass off must render
   *  pixel-identical to pre-0.6.6 (see state/theme.ts). */
  glassEnabled: boolean;
  /** 0–100. 0 = clear glass (acrylic cleared), 100 = most opaque frosted. */
  glassStrength: number;
  todos: Todo[];
  weatherLocation: WeatherLocation;
  pomodoro: { state: PomodoroState; settings: PomodoroSettings };
  // Profile system: layout + tile visibility live INSIDE the active profile.
  profiles: Profile[];
  activeProfileId: string;
  onboardingDone: boolean;
  /** The catalog removal list — see state/removedContent.ts. Keys of the form
   *  `${kind}:${id}`. A bundle's key stays here after its folder is deleted,
   *  which is the tombstone that stops a later seed sync from reinstalling
   *  it. Travels with settings export/import like any other tweak. */
  catalogRemoved: string[];
}

/** How long the viz surface will wait for boot seeding before giving up and
 *  resolving against whatever is installed so far. Only reached if `seed_sync`
 *  never settles at all — the normal success and failure paths both latch
 *  immediately. Generous enough that a slow disk unzipping ~30 seed bundles
 *  finishes first, short enough that a hung invoke is a blink, not a session. */
const SEED_SETTLE_WATCHDOG_MS = 8_000;

const TWEAK_DEFAULTS: TweakState = {
  // Bars is a bundle now, not a built-in — this names the seed zip that
  // `seed_sync` installs on first run, so an out-of-the-box install still
  // opens on the classic spectrum analyzer rather than the MilkDrop engine.
  // It is a *preference*, not a guarantee: if the bundle isn't there (seeding
  // hasn't finished, or the user removed it) HiFiVizSurface resolves against
  // the live catalog instead. Nothing downstream may assume this id exists.
  vizMode: 'bundle:bars',
  accentTheme: 'auto',
  density: 'compact',
  vizArtBg: false,
  vizAudioSource: { mode: 'mix' },
  vizSensitivityBySource: {},
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
  glassEnabled: false,
  glassStrength: DEFAULT_GLASS_STRENGTH,
  todos: [],
  weatherLocation: { label: 'Knoxville, TN', lat: 35.9606, lon: -83.9207 },
  pomodoro: {
    state: { ...DEFAULT_POMODORO_STATE },
    settings: { ...DEFAULT_POMODORO_SETTINGS },
  },
  profiles: [],
  activeProfileId: '',
  onboardingDone: false,
  catalogRemoved: [],
};


/** Migration: legacy shape (top-level `layout`/`hidden`, no `profiles`) → new
 *  profile-shaped state. Idempotent: returns input unchanged if already migrated. */
function migrateTweaks(loaded: Record<string, unknown>): Record<string, unknown> {
  // Old `quality` perfMode was renamed to `uncapped`. Same behavior; just clearer label.
  if (loaded.perfMode === 'quality') {
    loaded.perfMode = 'uncapped';
  }
  // All 27 formerly-built-in viz styles were retired from the binary and now
  // live in the shop as `bundle:` ids. A saved selection naming one of them is
  // rewritten here so it keeps working the moment its seed zip installs; until
  // then HiFiVizSurface renders whatever else is in the catalog.
  //
  // `remapRetiredVizMode` returns null only when handed an empty style table,
  // which the compile-time one never is — keep the saved value in that case
  // rather than substituting a constant, which is exactly the hardcoded-'bars'
  // trap this wave removed.
  if (typeof loaded.vizMode === 'string') {
    loaded.vizMode = remapRetiredVizMode(loaded.vizMode) ?? loaded.vizMode;
  }
  // Audio-source sensitivity (added 2026-08): the old single `vizSensitivity`
  // scalar becomes the 'mix' entry of the new per-source map, so upgrading
  // doesn't reset anyone's tuned gain. Runs once — a saved
  // `vizSensitivityBySource` (even `{}`) means this already happened.
  if (loaded.vizSensitivityBySource === undefined && loaded.vizSensitivity !== undefined) {
    loaded.vizSensitivityBySource = migrateSensitivity(loaded.vizSensitivity);
    delete loaded.vizSensitivity;
  }
  // Audio multiselect (0.6.6): the 0.6.4 single-app source becomes a strict
  // include list. `only:x` → `apps:[x]`; `except:x` → `mix` (no equivalent —
  // the changelog notes the downgrade). Saved `only:` sensitivity keys are
  // respelled `apps:` inside migrateSensitivity. Both migrations are
  // idempotent, so re-running on already-migrated state is a no-op.
  if (loaded.vizAudioSource !== undefined) {
    loaded.vizAudioSource = migrateAudioSource(loaded.vizAudioSource);
  }
  if (loaded.vizSensitivityBySource !== undefined) {
    loaded.vizSensitivityBySource = migrateSensitivity(loaded.vizSensitivityBySource);
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

    // Curated starter sets, not the full catalog — seeding with empty
    // layout/hidden used to place every tile type (28 overlapping tiles).
    // A user with real legacy layout data keeps it as their Work profile;
    // Gaming/Chill are always fresh starters either way.
    const starters = seedStarterProfiles();
    const hasLegacyLayout = Object.keys(legacyLayout).length > 0 || Object.keys(legacyHidden).length > 0;
    const seeded: Profile[] = hasLegacyLayout
      ? [
          migrateLegacyProfileToOrientations({
            id: newId(), name: 'Work', color: PROFILE_DEFAULT_COLORS[0]!,
            layout: legacyLayout, hidden: legacyHidden,
          }),
          starters[1]!,
          starters[2]!,
        ]
      : starters;
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

  // Three built-ins retired in favor of published bundles (quote, word of the
  // day, daily challenge). A saved tile instance naming one is rewritten to
  // its bundle id on every load, so an existing placement keeps working the
  // moment the bundle is installed — and falls back to MissingTileCard via
  // renderTile's default case until it is. Mirrors the vizMode remap above.
  {
    const profiles = result.profiles as Array<Record<string, unknown>> | undefined;
    if (profiles) {
      result.profiles = profiles.map((p) => {
        const profile = p as Record<string, unknown>;
        const remapOrientation = (slotRaw: unknown): unknown => {
          const slot = slotRaw as { tiles?: TileInstance[] } | undefined;
          if (!slot?.tiles) return slotRaw;
          return {
            ...slot,
            tiles: slot.tiles.map((inst) => ({
              ...inst,
              type: remapRetiredTileType(inst.type) as TileType,
            })),
          };
        };
        return {
          ...profile,
          landscape: remapOrientation(profile.landscape),
          portrait: remapOrientation(profile.portrait),
        };
      });
    }
  }

  return result;
}

export default function App() {
  const [t, setTweak, replaceTweaks, tweaksHydrated] = useTweaks<TweakState>(TWEAK_DEFAULTS, { migrate: migrateTweaks });
  // Gain for whatever vizAudioSource currently points at — falls back to
  // DEFAULT_SENSITIVITY the first time a given source is picked.
  const vizSensitivity = effectiveSensitivity(t.vizSensitivityBySource, t.vizAudioSource);
  useEffect(() => {
    // Wait for the disk hydrate before deciding storage is truly empty —
    // seeding off the pre-hydrate defaults would race an existing profile
    // list loading from the Tauri file.
    if (!tweaksHydrated) return;
    if (t.profiles.length > 0 && t.activeProfileId) return;
    const seeded = seedStarterProfiles();
    setTweak('profiles', seeded);
    setTweak('activeProfileId', seeded[0]!.id);
  }, [tweaksHydrated, t.profiles.length, t.activeProfileId, setTweak]);

  // First-ever launch: auto-open onboarding once the profile system is ready
  // and the hydrate settled without onboardingDone. This used to run once on
  // mount with [] deps — on a fresh install profiles are seeded AFTER mount,
  // so the check always saw an empty list and onboarding never appeared.
  // The ref limits the auto-trigger to once per session so a later profiles
  // change can't re-open it after the user dismissed it with Esc; "Replay
  // onboarding" in Settings opens it directly and doesn't go through here.
  const onboardingAutoShownRef = useRef(false);
  useEffect(() => {
    if (onboardingAutoShownRef.current || !tweaksHydrated) return;
    if (!t.onboardingDone && t.profiles.length > 0 && t.activeProfileId) {
      onboardingAutoShownRef.current = true;
      setShowOnboarding(true);
    }
  }, [tweaksHydrated, t.onboardingDone, t.profiles.length, t.activeProfileId]);
  const [manualTrack, setManualTrack] = useState<Track>(TRACKS[0]!);
  const [editMode, setEditMode] = useState(false);
  const [snapEnabled, setSnapEnabled] = useState(true);
  const [showSwitcher, setShowSwitcher] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [showGallery, setShowGallery] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showContentLibrary, setShowContentLibrary] = useState(false);
  // Rail row ContentLibrary should open to — e.g. the MilkDrop picker's
  // "browse presets" button (Task 6) opens straight to 'preset:all' instead
  // of the default 'all'. `undefined` means "unset" — every existing opener
  // (the header/nav "Library" buttons below) leaves this unset, so they keep
  // opening to 'all' exactly as before. Reset to `undefined` on close so the
  // NEXT plain open doesn't inherit a stale rail from whatever last set it.
  const [libraryRail, setLibraryRail] = useState<string | undefined>();
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [selectedInstanceId, setSelectedInstanceId] = useState<string>('');
  // Transient "theme synced" toast: holds the track title being announced, or
  // null when hidden. Set by the effect below when accent is track-linked and
  // the title changes; auto-cleared after 2s.
  const [themeToast, setThemeToast] = useState<string | null>(null);
  const { styles: vizStyles, loaded: vizStylesLoaded } = useVizStyles(t.catalogRemoved);
  const { entries: tileCatalog, loaded: tileCatalogLoaded } = useTileCatalog(t.catalogRemoved);
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

  // Liquid glass: stamp the surface tokens on :root immediately (cheap — this
  // is what makes the strength slider feel live) and mirror the acrylic state
  // to the OS, debounced so a slider drag doesn't spam DWM once per
  // pointermove. Runs on mount too, so a persisted glass-on state is applied
  // right after tweaks hydrate (there is a brief opaque first paint before
  // hydration flips glassEnabled — acceptable, it matches today's boot frame).
  useEffect(() => {
    applySurfaces(computeSurfaces(t.glassEnabled, t.glassStrength));
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const { invoke } = await import('@tauri-apps/api/core');
          await invoke('set_glass', {
            enabled: t.glassEnabled,
            tintAlpha: glassTintAlpha(t.glassStrength),
          });
        } catch { /* browser dev — no tauri */ }
      })();
    }, 150);
    return () => clearTimeout(timer);
  }, [t.glassEnabled, t.glassStrength]);

  // Push the chosen audio source to Rust whenever it changes. The tweak
  // store stays the single source of truth; Rust is a follower here — the
  // real outcome (fell back to mix, unsupported, etc.) comes back on the
  // `audio:source` event, not from this call, so failures are swallowed.
  useEffect(() => {
    (async () => {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        await invoke('audio_set_source', { source: t.vizAudioSource });
      } catch { /* browser dev — no tauri, or capture not running yet */ }
    })();
  }, [t.vizAudioSource]);

  // Boot seeding (Critical 1 of the whole-branch review — see spec §5).
  // `seed_sync` installs every seed bundle shipped in resources that isn't
  // already installed and isn't tombstoned, so the base catalog is actually
  // present on a fresh/offline install instead of showing 15 "Install"
  // buttons for content the spec calls pre-installed. It runs exactly once
  // per process, guarded by `ranRef`, and only after `tweaksHydrated`: the
  // hook starts from TWEAK_DEFAULTS (catalogRemoved: []) and hydrates from
  // disk asynchronously, so firing before hydration would hand seed_sync an
  // empty removal list and resurrect content the user deliberately removed —
  // the exact bug the tombstone list exists to prevent.
  //
  // Never blocks the window (fire-and-forget inside an effect, after first
  // paint) and never throws (caught and logged) — a seed failure must not
  // stop the app from booting. The catalog and V-cycle pick up whatever
  // seed_sync installs on their own: `useTileCatalog`/`useVizStyles` already
  // listen for the Rust-side `tiles:changed`/`visualizers:changed` watcher
  // events (tiles.rs/visualizers.rs poll every 2s), which fire the moment
  // seed_sync writes a folder — no extra refresh call needed here.
  //
  // `markSeedSettled()` in the `finally` is what lets the viz surface stop
  // guessing. Until it fires, `useVizStyles` reports `loaded: false` and
  // HiFiVizSurface holds at `pending` (a blank frame) instead of concluding
  // that a bundle the seeder is about to write is missing — see
  // state/seedStatus.ts for why that window exists on every launch, not just
  // a fresh install. It must fire on the failure path too: a seed sync that
  // errored is still an answer, and leaving the latch unset would blank the
  // surface for the rest of the process.
  const seedSyncRanRef = useRef(false);
  useEffect(() => {
    if (!tweaksHydrated || seedSyncRanRef.current) return;
    seedSyncRanRef.current = true;
    // Watchdog. The `finally` below covers every way the invoke can settle,
    // but not one that never settles at all — and the cost of that is a
    // permanently blank visualizer, which is the exact failure this whole
    // wave exists to prevent. Falling back to a possibly-incomplete catalog
    // after a few seconds is strictly better than showing nothing forever.
    // Idempotent with the `finally` (markSeedSettled latches once).
    const watchdog = setTimeout(markSeedSettled, SEED_SETTLE_WATCHDOG_MS);
    void (async () => {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        await invoke('seed_sync', { removed: t.catalogRemoved });
      } catch (err) {
        console.warn('seed_sync failed at startup:', err);
      } finally {
        clearTimeout(watchdog);
        markSeedSettled();
      }
    })();
  }, [tweaksHydrated, t.catalogRemoved]);

  // Feed perf-mode + viz-mode into the debug context so spike snapshots include
  // them; cheap unconditional call, the module ignores when not enabled.
  //
  // Records the RESOLVED mode, not `t.vizMode`. Before the styles were
  // retired the dispatch always rendered exactly the requested mode, so the
  // two were the same string by construction. They are not any more: in the
  // fallback case a snapshot would read `viz:bundle:bars` while MilkDrop is
  // the thing actually burning the GPU, which is precisely backwards for a
  // tool whose entire job is attributing a spike to a surface. Same resolver
  // the surface itself uses, so the two can never disagree.
  const resolvedVizMode = resolvedVizModeLabel(
    resolveVizSurface(t.vizMode, vizStyles, vizStylesLoaded), t.vizMode,
  );
  useEffect(() => {
    perfDebug.recordContext(t.perfMode, resolvedVizMode);
  }, [t.perfMode, resolvedVizMode]);

  // wry never flips document.visibilityState when the parent window is
  // hidden to the tray (SetIsVisible(false) isn't called on a Win32 hide), so
  // the Rust side tells us explicitly. Without this, the rAF viz loop keeps
  // drawing at the FPS cap while minimized to the tray — this is the single
  // app-wide subscription every `useAnimateGate` (hero surface AND every
  // sandboxed catalog-card preview, via `SandboxVizSurface`) reads through
  // `framePace.ts`'s `isWindowHidden()`.
  useEffect(() => {
    // `cancelled` is load-bearing, not boilerplate: `listen()` is async, and
    // under StrictMode the first effect's promise resolves AFTER its cleanup
    // has already run — so without this the first listener is never released
    // and every visibility event is handled twice for the life of the app.
    let cancelled = false;
    let un: (() => void) | undefined;
    (async () => {
      try {
        const { listen } = await import('@tauri-apps/api/event');
        const off = await listen<boolean>('hub://window-visibility', (e) => setWindowHidden(!e.payload));
        if (cancelled) { off(); return; }
        un = off;
      } catch { /* browser dev — no tauri */ }
    })();
    return () => { cancelled = true; un?.(); };
  }, []);

  // wry never flips document.visibilityState when the parent window is
  // hidden to the tray (SetIsVisible(false) isn't called on a Win32 hide), so
  // the Rust side tells us explicitly. Without this, the rAF viz loop keeps
  // drawing at the FPS cap while minimized to the tray.
  useEffect(() => {
    let un: (() => void) | undefined;
    (async () => {
      try {
        const { listen } = await import('@tauri-apps/api/event');
        un = await listen<boolean>('hub://window-visibility', (e) => setWindowHidden(!e.payload));
      } catch { /* browser dev — no tauri */ }
    })();
    return () => { un?.(); };
  }, []);

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
        else if (showContentLibrary) setShowContentLibrary(false);
        else if (showSettings) setShowSettings(false);
        else if (showGallery) setShowGallery(false);
        else if (showSwitcher) setShowSwitcher(false);
        else if (showOnboarding) {
          // Esc counts as "skip setup" — without marking done, the fresh-install
          // auto-trigger would re-open onboarding on every launch.
          setTweak('onboardingDone', true);
          setShowOnboarding(false);
        }
        else if (editMode) setEditMode(false);
      }
      else if (!editing && !cmd && e.key === '?') {
        // Toggle the shortcut cheat sheet. Opens only when no other modal is
        // up (it would z-fight and confuse the Esc cascade); "?" again closes.
        if (showShortcuts) {
          e.preventDefault();
          setShowShortcuts(false);
        } else if (!showContentLibrary && !showSettings && !showGallery && !showSwitcher && !showOnboarding) {
          e.preventDefault();
          setShowShortcuts(true);
        }
      }
      else if (!editing && !cmd && (e.key === 'v' || e.key === 'V')) {
        // Guard on vizStylesLoaded — same root cause as the Critical fixed in
        // Task 9. Before visualizers_list resolves, a `bundle:` t.vizMode has
        // no match in `ids`, so indexOf is -1 and (−1+1)%len lands on index 0
        // — silently persisting the catalog's first style over the user's
        // actual selection. Make cycling a no-op until the catalog is known
        // rather than guessing.
        if (!vizStylesLoaded) return;
        const ids = vizStyles.map((s) => s.id);
        // Every style removed: (i+1) % 0 is NaN, and the old `?? 'bars'`
        // fallback could reactivate a style the user tombstoned on purpose —
        // and now names one that isn't compiled in at all. Nothing to cycle
        // to, so leave vizMode exactly where it is.
        if (ids.length === 0) return;
        const i = ids.indexOf(t.vizMode);
        setTweak('vizMode', ids[(i + 1) % ids.length] ?? ids[0] ?? t.vizMode);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showSwitcher, editMode, showOnboarding, showGallery, showSettings, showContentLibrary, showShortcuts, t.vizMode, t.profiles, setTweak, vizStyles, vizStylesLoaded]);

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
  // Places a new instance of `type` on the active orientation, in the first
  // empty snap-aligned slot near its default rect — the same placement logic
  // the old TileLibrary.onAdd used (see App.tsx at 24f6166^: it called
  // findEmptyRect itself before invoking this same onAdd shape). Unlike
  // addTileByType above, this allows a second instance of a multi-instance
  // type rather than no-op'ing — it backs ContentLibrary's "+ Add" button,
  // the catalog's restored counterpart to placing a tile outside edit mode.
  const addTileInstance = (type: TileType) => {
    const defaults = orientation === 'portrait' ? DEFAULT_PORTRAIT_LAYOUT : DEFAULT_LANDSCAPE_LAYOUT;
    const preferred = isBundleTile(type) ? DEFAULT_BUNDLE_TILE_RECT[orientation] : defaults[type];
    const rect = findEmptyRect(activeOrientation.tiles.map((inst) => inst.rect), preferred, canvas);
    updateActiveOrientation({
      tiles: addInstance(activeOrientation.tiles, { instanceId: newId(), type, rect }),
    });
  };
  // Called by ContentLibrary after a visualizer is actually removed
  // (uninstall done, tombstone written), with its catalog key
  // (`visualizer:<id>`). vizMode is the visualizer's equivalent of a placed
  // tile instance — it names the style currently rendering — and it is
  // persisted, so leaving it pointed at the style just removed would keep it
  // selected (including after a restart) even though the catalog, the V-cycle
  // and the quick-select strip now exclude it. Resets to the first surviving
  // style in the merged catalog.
  //
  // If nothing survives — the user removed the last visualizer — vizMode is
  // left exactly where it is rather than being rewritten to a hardcoded id.
  // That used to be `?? 'bars'`, which silently reactivated a style the user
  // had tombstoned on purpose (and, once Bars stopped being compiled in,
  // pointed at nothing at all). The surface renders its empty state for this
  // case, and restoring anything from the content library makes the stale
  // selection resolve again on the next render.
  const onVisualizerRemoved = (key: string) => {
    const currentId = isVizBundleMode(t.vizMode) ? vizBundleIdOf(t.vizMode) : t.vizMode;
    if (currentId == null || catalogKey('visualizer', currentId) !== key) return;
    const survivor = vizStyles.find((s) => {
      const id = isVizBundleMode(s.id) ? vizBundleIdOf(s.id) : s.id;
      return id != null && catalogKey('visualizer', id) !== key;
    });
    if (survivor) setTweak('vizMode', survivor.id);
  };
  // Reset = empty canvas, not the full catalog. Placing every tile type gave
  // 28 overlapping tiles (only the core eight have a designed layout); starting
  // from nothing and adding via the edit-mode picker is the intended flow.
  const resetLayout = () => {
    updateActiveOrientation({ tiles: [] });
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
        return (
          <AudioMixerTile
            density={t.density} accent={accent} accent2={accent2} spectrumRef={spectrumRef}
            audioSource={t.vizAudioSource}
            onSetAudioSource={(s) => setTweak('vizAudioSource', s)}
          />
        );
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
            sensitivity={vizSensitivity}
            smoothing={t.vizSmoothing}
            lyricsOverlayEnabled={t.lyricsOverlayEnabled}
            videoEnabled={t.videoEnabled}
            videoBookmarks={t.videoBookmarks}
            videoCurrentUrl={t.videoCurrentUrl}
            videoAvailable={t.videoBookmarks.length > 0}
            onToggleVideo={() => setTweak('videoEnabled', !t.videoEnabled)}
            onNavigate={(url) => setTweak('videoCurrentUrl', url)}
            onExit={() => setTweak('videoEnabled', false)}
            overlaysOpen={showGallery || editMode || showContentLibrary}
            paused={(t.videoEnabled && t.videoBookmarks.length > 0) || showGallery || (t.perfMode !== 'uncapped' && livePlayback?.playing !== true)}
            onConfigure={() => setShowGallery(true)}
            audioDebug={t.audioDebug}
            catalogRemoved={t.catalogRemoved}
            onOpenLibrary={(rail) => { setLibraryRail(rail); setShowContentLibrary(true); }}
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
            catalogRemoved={t.catalogRemoved}
          />
        );
      case 'weatherRadar':
        return (
          <RadarTile
            density={t.density}
            accent={accent}
            location={t.weatherLocation}
            config={instance.config as Record<string, unknown> | undefined}
            setConfig={(next) => updateActiveOrientation({
              tiles: updateInstance(activeOrientation.tiles, instance.instanceId, { config: next }),
            })}
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
      case 'onThisDay':
        return <OnThisDayTile density={t.density} accent={accent} />;
      case 'iss':
        return (
          <IssTile
            density={t.density}
            accent={accent}
            location={t.weatherLocation}
            config={instance.config as Record<string, unknown> | undefined}
            setConfig={(next) => updateActiveOrientation({
              tiles: updateInstance(activeOrientation.tiles, instance.instanceId, { config: next }),
            })}
          />
        );
      case 'pollen':
        return <PollenTile density={t.density} accent={accent} editing={editMode} location={t.weatherLocation} />;
      case 'solarFlare':
        return <SolarFlareTile density={t.density} accent={accent} />;
      case 'lightning':
        return (
          <LightningTile
            density={t.density}
            accent={accent}
            location={t.weatherLocation}
            config={instance.config as Record<string, unknown> | undefined}
            setConfig={(next) => updateActiveOrientation({
              tiles: updateInstance(activeOrientation.tiles, instance.instanceId, { config: next }),
            })}
          />
        );
      case 'aircraft':
        return (
          <AircraftTile
            density={t.density}
            accent={accent}
            location={t.weatherLocation}
            config={instance.config as Record<string, unknown> | undefined}
            setConfig={(next) => updateActiveOrientation({
              tiles: updateInstance(activeOrientation.tiles, instance.instanceId, { config: next }),
            })}
          />
        );
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
      default: {
        // Every BuiltinTileType is handled by a case above, so reaching here
        // means instance.type is a `bundle:<id>` tile. Four states:
        //  1. (not bundle — unreachable, handled by the cases above)
        //  2. catalog hasn't loaded yet — render nothing rather than guess.
        //  3. present in the loaded catalog — render its view.json payload.
        //  4. absent from a loaded catalog — offer to install it, without
        //     touching the layout (the slot is the user's to keep or remove).
        if (!isBundleTile(instance.type)) return null;
        if (!tileCatalogLoaded) return null;
        const entry = tileCatalog.find((e) => e.type === instance.type);
        if (!entry) {
          return (
            <MissingTileCard
              bundleId={bundleIdOf(instance.type) ?? instance.type}
              density={t.density}
              accent={accent}
              onOpenLibrary={() => setShowContentLibrary(true)}
            />
          );
        }
        return (
          <DeclarativeTile
            bundleId={entry.bundleId ?? bundleIdOf(instance.type) ?? instance.type}
            instanceId={instance.instanceId}
            density={t.density}
            accent={accent}
            editing={editMode}
          />
        );
      }
    }
  };

  return (
    <div style={{ width: '100vw', height: '100vh', background: 'transparent', overflow: 'hidden' }}>
      {/* ^ was '#000' — always covered by the opaque canvas below when glass
          is off, so 'transparent' is pixel-identical; with glass on it must
          not block the desktop. The canvas div is the ONE layer that carries
          --surface-canvas (stacking it twice would double-darken the glass). */}
      <div data-canvas-root style={{
        width: '100%', height: '100%',
        background: 'var(--surface-canvas, #06070a)', position: 'relative', overflow: 'hidden',
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
          audioSource={t.vizAudioSource}
        />
        {editMode && (
          <EditModeOverlay
            accent={accent}
            accent2={accent2}
            onExit={() => setEditMode(false)}
            onRemove={(instanceId) => updateActiveOrientation({
              tiles: removeInstance(activeOrientation.tiles, instanceId),
            })}
            onOpenLibrary={() => setShowContentLibrary(true)}
            tiles={activeOrientation.tiles}
            setTiles={(next) => updateActiveOrientation({ tiles: next })}
            selectedInstanceId={selectedInstanceId}
            setSelectedInstanceId={setSelectedInstanceId}
            snap={snapEnabled}
            setSnap={setSnapEnabled}
            profileName={activeProfile.name}
            catalogRemoved={t.catalogRemoved}
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
              sensitivity={vizSensitivity}
              smoothing={t.vizSmoothing}
              onPick={(m) => setTweak('vizMode', m)}
              onClose={() => setShowGallery(false)}
              catalogRemoved={t.catalogRemoved}
            />
          </Suspense>
        )}
        {showContentLibrary && (
          <ContentLibrary
            accent={accent}
            accent2={vizAccent2}
            spectrumRef={spectrumRef}
            catalogRemoved={t.catalogRemoved}
            setCatalogRemoved={(next) => setTweak('catalogRemoved', next)}
            onRemoveTileInstances={(type) => setTweak('profiles', t.profiles.map((p) => ({
              ...p,
              landscape: { tiles: removeTilesOfType(p.landscape.tiles, type) },
              portrait: { tiles: removeTilesOfType(p.portrait.tiles, type) },
            })))}
            onAddTileInstance={addTileInstance}
            onVisualizerRemoved={onVisualizerRemoved}
            onClose={() => { setShowContentLibrary(false); setLibraryRail(undefined); }}
            initialRail={libraryRail}
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
          onOpenContentLibrary={() => { setShowSettings(false); setShowContentLibrary(true); }}
          onReplayOnboarding={() => { setShowSettings(false); setShowOnboarding(true); }}
          // Close Settings and drop into edit mode so the empty canvas lands
          // with the "+ Add tile" picker one click away.
          onResetLayout={() => { resetLayout(); setShowSettings(false); setEditMode(true); }}
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

      <UpdateToast accent={accent} />
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
      background: 'var(--surface-chrome, rgba(8,9,12,0.85))', backdropFilter: 'blur(10px)',
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
            background: 'var(--surface-overlay, rgba(20,22,28,0.96))', border: '1px solid rgba(255,255,255,0.08)',
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
      background: 'var(--surface-chrome, rgba(8,9,12,0.85))', backdropFilter: 'blur(8px)',
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
          background: 'var(--surface-overlay, rgba(20,22,28,0.96))', border: '1px solid rgba(255,255,255,0.08)',
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
  accent, onSwitcher, profileName, tileCount, audioSource,
}: {
  accent: string;
  onSwitcher: () => void;
  profileName: string;
  tileCount: number;
  audioSource: AudioSource;
}) {
  // The 1Hz sysmon subscription and rAF frame counter live HERE, not in App:
  // this bar is the only chrome that displays them, and keeping them out of
  // the root means the ~36 tile subtrees no longer reconcile every second.
  const sysmon = useSysmon();
  const fps = useFrameRate();
  // `audioSource` (the tweak) is the requested source and updates the moment
  // the user picks one — no round trip needed. `status.live_exes` is the
  // only thing that has to come from Rust: which of the requested app(s), if
  // any, actually have a live capture right now (an app might be requested
  // but not yet playing anything).
  const { status: audioSourceStatus, options: audioSourceOptions, refresh: refreshAudioSourceOptions } = useAudioSource();
  // `options` is fetched once on mount, and this bar never unmounts — left
  // alone, the friendly-name list would be frozen at whatever was playing
  // at launch (usually nothing) for the rest of the session, so the status
  // text falls back to the raw exe forever. Re-fetch whenever the app the
  // capture is actually bound to changes: that's the one moment a new name
  // might have become resolvable, and it only fires on real transitions
  // (a fresh app attaching, or a reattach after one quits/relaunches) —
  // not a polling loop.
  const liveExesKey = audioSourceStatus ? audioSourceStatus.live_exes.join('+') : '';
  useEffect(() => {
    if (liveExesKey) refreshAudioSourceOptions();
  }, [liveExesKey, refreshAudioSourceOptions]);
  // "Spotify + Discord", "Spotify (not running)", "all system audio" — the
  // literal truth, no "(waiting)" states: there is no fallback to wait out.
  const audioSourceText = describeAudioSource(
    audioSource,
    (exe) => audioSourceOptions.find((o) => o.exe === exe)?.name ?? exe,
    audioSourceStatus ? audioSourceStatus.live_exes : null,
  );
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
      background: 'var(--surface-chrome, rgba(8,9,12,0.85))', backdropFilter: 'blur(10px)',
      borderTop: '1px solid rgba(255,255,255,0.05)',
      display: 'flex', alignItems: 'center', padding: '0 18px', gap: 18, zIndex: 10,
      fontSize: 10.5, color: 'rgba(255,255,255,0.45)', fontFamily: '"JetBrains Mono", ui-monospace, monospace',
    }}>
      <span style={{ color: accent }}>● {tileCount} tile{tileCount === 1 ? '' : 's'}</span>
      <span title="App CPU usage">CPU {cpuText}</span>
      <span title="App resident memory">RAM {ramText}</span>
      <span title="App GPU usage (via NVML, NVIDIA only)">GPU {gpuText}</span>
      <span title="Render frame rate" style={{ color: fpsColor }}>{fpsText}</span>
      <span title="What the visualizer is listening to">Audio: {audioSourceText}</span>
      <div style={{ flex: 1 }} />
      <button onClick={onSwitcher} style={{ background: 'transparent', border: 'none', color: 'rgba(255,255,255,0.45)', fontFamily: 'inherit', fontSize: 'inherit', cursor: 'pointer', padding: 0 }}>{profileName}</button>
      <span style={{ color: 'rgba(255,255,255,0.25)' }}>·</span>
      <span>⌘E edit · V cycle viz · ⌘1/2/3 profile</span>
    </div>
  );
}

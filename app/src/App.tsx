import { useEffect, useState } from 'react';
import type { TileId, Layout } from './state/layout';
import { DEFAULT_LAYOUT } from './state/layout';
import type { Track, Profile, AccentTheme, VizMode, Density, Todo, WeatherLocation, AppMetrics } from './types';
import type { GeocodeResult } from './state/weatherLocation';
import { TRACKS, ACCENT_PALETTES } from './data';
import { useTweaks } from './state/useTweaks';
import { useSysmon, useNowPlaying, useSpectrumRef } from './state/tauri';
import { VizHero, setVizDprCap, setVizMaxFps, getVizMaxFps } from './components/viz';
import { VizGallery, VIZ_STYLES } from './components/viz-gallery';
import {
  SpotifyTile, NotesTile,
  SysMonTile,
} from './components/tiles';
import { ClaudeCodeTile } from './components/claude-tile';
import { DiscordTile } from './components/discord-tile';
import { NowAndForecastTile } from './components/forecast-tile';
import { EditModeOverlay } from './components/edit';
import { ProfileSwitcher } from './components/profile';
import { Onboarding } from './components/onboarding';
import { TileFrame } from './components/TileFrame';
import {
  TweaksPanel, TweakSection, TweakRadio, TweakSelect, TweakButton,
} from './components/tweaks';
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
  perfMode: 'uncapped' | 'high' | 'balanced' | 'battery';
  todos: Todo[];
  weatherLocation: WeatherLocation;
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
  perfMode: 'balanced',
  todos: [],
  weatherLocation: { label: 'Knoxville, TN', lat: 35.9606, lon: -83.9207 },
  profiles: [],
  activeProfileId: '',
  onboardingDone: false,
};

const PROFILE_DEFAULT_COLORS = ['#a78bfa', '#f59e0b', '#22d3ee', '#22c55e', '#f472b6', '#60a5fa', '#facc15', '#f97316'];

function newId(): string {
  return (typeof crypto !== 'undefined' && crypto.randomUUID)
    ? crypto.randomUUID()
    : `p_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

/** Migration: legacy shape (top-level `layout`/`hidden`, no `profiles`) → new
 *  profile-shaped state. Idempotent: returns input unchanged if already migrated. */
function migrateTweaks(loaded: Record<string, unknown>): Record<string, unknown> {
  // Old `quality` perfMode was renamed to `uncapped`. Same behavior; just clearer label.
  if (loaded.perfMode === 'quality') {
    loaded.perfMode = 'uncapped';
  }
  const profilesField = loaded.profiles;
  // True first launch: nothing was loaded from disk at all (no profiles, no
  // legacy layout, no todos). Used below to seed demo todos.
  const isFirstLaunch = !loaded.profiles && !loaded.todos && !loaded.layout;

  if (Array.isArray(profilesField) && profilesField.length > 0) {
    return loaded;
  }
  const legacyLayout = (loaded.layout as Layout | undefined) ?? {};
  const legacyHidden = (loaded.hidden as Partial<Record<TileId, boolean>> | undefined) ?? {};
  const next: Record<string, unknown> = { ...loaded };
  delete next.layout;
  delete next.hidden;

  const seeded: Profile[] = [
    { id: newId(), name: 'Work',   color: PROFILE_DEFAULT_COLORS[0]!, layout: legacyLayout, hidden: legacyHidden },
    { id: newId(), name: 'Gaming', color: PROFILE_DEFAULT_COLORS[1]!, layout: {},           hidden: {} },
    { id: newId(), name: 'Chill',  color: PROFILE_DEFAULT_COLORS[2]!, layout: {},           hidden: {} },
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
  return next;
}

const ALL_TILES: { id: TileId; label: string }[] = [
  { id: 'discord', label: 'Discord' },
  { id: 'spotify', label: 'Now playing' },
  { id: 'claude',  label: 'Claude Code' },
  { id: 'notes',   label: 'Todos' },
  { id: 'sysmon',  label: 'System monitor' },
  { id: 'clock',   label: 'Now & forecast' },
  { id: 'viz',     label: 'Audio visualizer' },
];

export default function App() {
  const [t, setTweak] = useTweaks<TweakState>(TWEAK_DEFAULTS, { migrate: migrateTweaks });
  useEffect(() => {
    if (t.profiles.length > 0 && t.activeProfileId) return;
    const seeded: Profile[] = [
      { id: newId(), name: 'Work',   color: PROFILE_DEFAULT_COLORS[0]!, layout: {}, hidden: {} },
      { id: newId(), name: 'Gaming', color: PROFILE_DEFAULT_COLORS[1]!, layout: {}, hidden: {} },
      { id: newId(), name: 'Chill',  color: PROFILE_DEFAULT_COLORS[2]!, layout: {}, hidden: {} },
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
    // clicks "First-launch onboarding" in Tweaks to replay it). But auto-trigger
    // only on initial state where it's already false.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [manualTrack, setManualTrack] = useState<Track>(TRACKS[0]!);
  const [editMode, setEditMode] = useState(false);
  const [showSwitcher, setShowSwitcher] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [showGallery, setShowGallery] = useState(false);
  const [selectedTileId, setSelectedTileId] = useState<TileId>('viz');
  const sysmon = useSysmon();
  const spectrumRef = useSpectrumRef();
  const { track: livePlaying, playback: livePlayback } = useNowPlaying();
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
      else if (cmd && (e.key === '1' || e.key === '2' || e.key === '3')) {
        e.preventDefault();
        const idx = parseInt(e.key, 10) - 1;
        const p = t.profiles[idx];
        if (p) setTweak('activeProfileId', p.id);
      }
      else if (e.key === 'Escape') {
        if (showGallery) setShowGallery(false);
        else if (showSwitcher) setShowSwitcher(false);
        else if (showOnboarding) setShowOnboarding(false);
        else if (editMode) setEditMode(false);
      }
      else if (!editing && !cmd && (e.key === 'v' || e.key === 'V')) {
        const ids = VIZ_STYLES.map((s) => s.id);
        const i = ids.indexOf(t.vizMode);
        setTweak('vizMode', ids[(i + 1) % ids.length] ?? 'bars');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showSwitcher, editMode, showOnboarding, showGallery, t.vizMode, t.profiles, setTweak]);

  // Scale 2560x1440 design canvas to fit viewport.
  const [scale, setScale] = useState(1);
  useEffect(() => {
    const fit = () => {
      const s = Math.min(window.innerWidth / 2560, window.innerHeight / 1440);
      setScale(s);
    };
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, []);

  const overlaysOpen = editMode || showSwitcher || showOnboarding;
  const activeProfile: Profile = t.profiles.find((p) => p.id === t.activeProfileId) ?? t.profiles[0] ?? {
    id: '_fallback', name: 'Default', color: '#a78bfa', layout: {}, hidden: {},
  };
  const hidden = activeProfile.hidden;
  const activeLayout: Layout = activeProfile.layout;
  const visibleTileCount = ALL_TILES.filter(({ id }) => !hidden[id]).length;
  const fps = useFrameRate();

  const updateActiveProfile = (patch: Partial<Profile>) => {
    setTweak('profiles', t.profiles.map((p) =>
      p.id === activeProfile.id ? { ...p, ...patch } : p
    ));
  };
  const setHidden = (id: TileId, hide: boolean) => {
    updateActiveProfile({ hidden: { ...hidden, [id]: hide || undefined } });
  };

  const renderTile = (id: TileId) => {
    switch (id) {
      case 'discord':
        return <DiscordTile density={t.density} accent={accent} />;
      case 'spotify':
        return <SpotifyTile density={t.density} accent={accent} accent2={accent2} track={track} onPick={setTrack} playback={livePlayback} spectrumRef={spectrumRef} />;
      case 'claude':
        return <ClaudeCodeTile density={t.density} accent={accent} />;
      case 'notes':
        return <NotesTile density={t.density} accent={accent} todos={t.todos} setTodos={(next) => setTweak('todos', next)} />;
      case 'sysmon':
        return <SysMonTile density={t.density} accent={accent} accent2={accent2} history={sysmon} />;
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
            paused={showGallery || (t.perfMode === 'battery' && livePlayback?.playing !== true)}
            onConfigure={() => setShowGallery(true)}
          />
        );
    }
  };

  return (
    <div style={{ width: '100vw', height: '100vh', background: '#000', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
      <div data-canvas-root style={{
        width: 2560, height: 1440,
        transform: `scale(${scale})`, transformOrigin: 'center center',
        flexShrink: 0, background: '#06070a', position: 'relative', overflow: 'hidden', borderRadius: 8,
      }}>
        <TopChrome
          accent={accent} editMode={editMode} setEditMode={setEditMode}
          accentLinked={accentLinked} track={track}
          profiles={t.profiles}
          activeProfileId={t.activeProfileId}
          setActiveProfileId={(id) => setTweak('activeProfileId', id)}
          onSwitcher={() => setShowSwitcher(true)}
          onOnboarding={() => setShowOnboarding(true)}
        />
        {ALL_TILES.map(({ id }) => {
          if (hidden[id]) return null;
          const rect = activeLayout[id] ?? DEFAULT_LAYOUT[id];
          return (
            <TileFrame
              key={id}
              id={id}
              rect={rect}
              editing={editMode}
              selected={selectedTileId === id}
              onSelect={() => setSelectedTileId(id)}
              onChange={(r) => updateActiveProfile({ layout: { ...activeLayout, [id]: r } })}
              accent={accent}
            >
              {renderTile(id)}
            </TileFrame>
          );
        })}
        <BottomStatus
          accent={accent}
          onSwitcher={() => setShowSwitcher(true)}
          profileName={activeProfile.name}
          tileCount={visibleTileCount}
          app={sysmon.latest.app}
          fps={fps}
        />
        {editMode && (
          <EditModeOverlay
            accent={accent}
            accent2={accent2}
            onExit={() => setEditMode(false)}
            onRemove={(id) => setHidden(id, true)}
            layout={activeLayout}
            setLayout={(next) => updateActiveProfile({ layout: next })}
            selectedId={selectedTileId}
            setSelectedId={setSelectedTileId}
            hiddenIds={(Object.keys(hidden) as TileId[]).filter((k) => hidden[k])}
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
                setTweak('profiles', t.profiles.map((p) =>
                  p.id === targetId ? { ...p, hidden: result.hiddenForActive! } : p
                ));
              }
              setTweak('onboardingDone', true);
              setShowOnboarding(false);
            }}
          />
        )}
        {showGallery && (
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
        )}
      </div>

      <TweaksPanel title="Tweaks" defaultOpen={true}>
        <TweakSection label="Visualizer" />
        <TweakRadio<VizMode>
          label="Mode" value={t.vizMode}
          options={['bars', 'waveform', 'radial', 'particles', 'ambient']}
          onChange={(v) => setTweak('vizMode', v)} />
        <TweakButton label="Browse all 27 styles" onClick={() => setShowGallery(true)} />
        <label style={{
          display: 'flex', alignItems: 'center', gap: 8, padding: '3px 0',
          cursor: 'pointer', userSelect: 'none', color: 'rgba(41,38,27,0.85)',
        }}>
          <input
            type="checkbox"
            checked={t.vizArtBg}
            onChange={(e) => setTweak('vizArtBg', e.target.checked)}
            style={{ accentColor: '#29261b', width: 13, height: 13 }}
          />
          <span style={{ fontSize: 11.5, fontWeight: 500 }}>Album-art backdrop</span>
        </label>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '4px 0' }}>
          <label style={{ fontSize: 11, fontWeight: 500, color: 'rgba(41,38,27,0.85)', display: 'flex', justifyContent: 'space-between' }}>
            <span>Sensitivity</span>
            <span style={{ fontFamily: '"JetBrains Mono", ui-monospace, monospace', color: 'rgba(41,38,27,0.55)' }}>
              {t.vizSensitivity.toFixed(2)}×
            </span>
          </label>
          <input
            type="range" min={0.3} max={2.5} step={0.05}
            value={t.vizSensitivity}
            onChange={(e) => setTweak('vizSensitivity', parseFloat(e.target.value))}
            style={{ accentColor: '#29261b', width: '100%' }}
          />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '4px 0' }}>
          <label style={{ fontSize: 11, fontWeight: 500, color: 'rgba(41,38,27,0.85)', display: 'flex', justifyContent: 'space-between' }}>
            <span>Smoothing</span>
            <span style={{ fontFamily: '"JetBrains Mono", ui-monospace, monospace', color: 'rgba(41,38,27,0.55)' }}>
              {t.vizSmoothing.toFixed(2)}
            </span>
          </label>
          <input
            type="range" min={0} max={0.95} step={0.05}
            value={t.vizSmoothing}
            onChange={(e) => setTweak('vizSmoothing', parseFloat(e.target.value))}
            style={{ accentColor: '#29261b', width: '100%' }}
          />
        </div>
        <label style={{
          display: 'flex', alignItems: 'center', gap: 8, padding: '3px 0',
          cursor: 'pointer', userSelect: 'none', color: 'rgba(41,38,27,0.85)',
        }}>
          <input
            type="checkbox"
            checked={t.vizColorOverride.enabled}
            onChange={(e) => setTweak('vizColorOverride', { ...t.vizColorOverride, enabled: e.target.checked })}
            style={{ accentColor: '#29261b', width: 13, height: 13 }}
          />
          <span style={{ fontSize: 11.5, fontWeight: 500 }}>Color override (viz only)</span>
        </label>
        {t.vizColorOverride.enabled && (
          <div style={{ display: 'flex', gap: 8, padding: '4px 0', alignItems: 'center' }}>
            <input
              type="color" value={t.vizColorOverride.accent}
              onChange={(e) => setTweak('vizColorOverride', { ...t.vizColorOverride, accent: e.target.value })}
              style={{ width: 28, height: 22, padding: 0, border: '1px solid rgba(0,0,0,0.1)', borderRadius: 4, cursor: 'pointer' }}
            />
            <input
              type="color" value={t.vizColorOverride.accent2}
              onChange={(e) => setTweak('vizColorOverride', { ...t.vizColorOverride, accent2: e.target.value })}
              style={{ width: 28, height: 22, padding: 0, border: '1px solid rgba(0,0,0,0.1)', borderRadius: 4, cursor: 'pointer' }}
            />
            <span style={{ fontSize: 10, color: 'rgba(41,38,27,0.55)', fontFamily: '"JetBrains Mono", ui-monospace, monospace' }}>
              accent / accent2
            </span>
          </div>
        )}
        <TweakSection label="Lyrics" />
        <label style={{
          display: 'flex', alignItems: 'center', gap: 8, padding: '3px 0',
          cursor: 'pointer', userSelect: 'none', color: 'rgba(41,38,27,0.85)',
        }}>
          <input
            type="checkbox"
            checked={t.lyricsOverlayEnabled}
            onChange={(e) => setTweak('lyricsOverlayEnabled', e.target.checked)}
            style={{ accentColor: '#29261b', width: 13, height: 13 }}
          />
          <span style={{ fontSize: 11.5, fontWeight: 500 }}>Show lyrics over visualizer</span>
        </label>
        <TweakSection label="Accent color" />
        <TweakSelect<AccentTheme>
          label="Source" value={t.accentTheme}
          options={(Object.keys(ACCENT_PALETTES) as AccentTheme[]).map((k) => ({ value: k, label: ACCENT_PALETTES[k].label }))}
          onChange={(v) => setTweak('accentTheme', v)} />
        <div style={{ display: 'flex', gap: 6, padding: '4px 0', alignItems: 'center' }}>
          <div style={{ width: 22, height: 22, borderRadius: 5, background: accent, border: '1px solid rgba(0,0,0,0.1)' }} />
          <div style={{ width: 22, height: 22, borderRadius: 5, background: accent2, border: '1px solid rgba(0,0,0,0.1)' }} />
          <span style={{ fontSize: 10, color: 'rgba(41,38,27,0.55)', fontFamily: '"JetBrains Mono", ui-monospace, monospace', marginLeft: 4 }}>
            {accentLinked ? `from "${track.title}"` : 'manual'}
          </span>
        </div>
        <TweakSection label="Layout" />
        <TweakRadio<Density>
          label="Tile density" value={t.density}
          options={['compact', 'regular', 'spacious']}
          onChange={(v) => setTweak('density', v)} />
        <TweakButton label="Reset layout" onClick={() => updateActiveProfile({ layout: {} })} />
        <TweakSection label="Weather" />
        <WeatherSearch
          current={t.weatherLocation}
          onPick={(loc) => setTweak('weatherLocation', loc)}
        />
        <TweakSection label="Performance" />
        <TweakRadio<'uncapped' | 'high' | 'balanced' | 'battery'>
          label="Mode"
          value={t.perfMode}
          options={['uncapped', 'high', 'balanced', 'battery']}
          onChange={(v) => setTweak('perfMode', v)}
        />
        <div style={{ fontSize: 10, color: 'rgba(41,38,27,0.55)', padding: '2px 0 6px', lineHeight: 1.45 }}>
          {t.perfMode === 'uncapped' && 'Native DPR · uncapped fps · 60 Hz audio · no idle pause'}
          {t.perfMode === 'high'     && 'DPR cap 1.5× · 120 fps · 60 Hz audio'}
          {t.perfMode === 'balanced' && 'DPR cap 1× · 60 fps · 30 Hz audio'}
          {t.perfMode === 'battery'  && 'DPR cap 1× · 30 fps · 15 Hz audio · hero pauses when idle'}
        </div>
        <TweakSection label="Tiles · show / hide" />
        {ALL_TILES.filter(({ id }) => id !== 'viz').map((def) => {
          const visible = !hidden[def.id];
          return (
            <label key={def.id} style={{
              display: 'flex', alignItems: 'center', gap: 8, padding: '3px 0',
              cursor: 'pointer', userSelect: 'none',
              color: visible ? 'rgba(41,38,27,0.85)' : 'rgba(41,38,27,0.45)',
            }}>
              <input
                type="checkbox"
                checked={visible}
                onChange={(e) => setHidden(def.id, !e.target.checked)}
                style={{ accentColor: '#29261b', width: 13, height: 13 }}
              />
              <span style={{ fontSize: 11.5, fontWeight: 500 }}>{def.label}</span>
            </label>
          );
        })}
        <TweakSection label="Demo screens" />
        <TweakButton label="Edit mode" onClick={() => setEditMode(true)} />
        <TweakButton label="Profile switcher" onClick={() => setShowSwitcher(true)} />
        <TweakButton label="First-launch onboarding" onClick={() => setShowOnboarding(true)} />
      </TweaksPanel>
    </div>
  );
}

function TopChrome({ accent, editMode, setEditMode, accentLinked, track, profiles, activeProfileId, setActiveProfileId, onSwitcher, onOnboarding }: {
  accent: string;
  editMode: boolean;
  setEditMode: (b: boolean) => void;
  accentLinked: boolean;
  track: Track;
  profiles: Profile[];
  activeProfileId: string;
  setActiveProfileId: (id: string) => void;
  onSwitcher: () => void;
  onOnboarding: () => void;
}) {
  const visibleProfiles = profiles.slice(0, 4);
  const overflow = Math.max(0, profiles.length - visibleProfiles.length);
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
      {accentLinked && (
        <span style={{ fontSize: 10, color: accent, padding: '3px 8px', background: accent + '15', borderRadius: 4, border: `1px solid ${accent}44`, letterSpacing: '.05em' }}>
          ◐ Theme synced to "{track.title}"
        </span>
      )}
      <button onClick={onOnboarding} title="Replay first-launch setup" style={{
        padding: '5px 10px', fontSize: 11, borderRadius: 6,
        background: 'transparent', color: 'rgba(255,255,255,0.5)',
        border: '1px solid rgba(255,255,255,0.1)',
        cursor: 'pointer', fontWeight: 500,
      }}>↻ Setup</button>
      <button onClick={() => setEditMode(!editMode)} style={{
        padding: '5px 10px', fontSize: 11, borderRadius: 6,
        background: editMode ? accent : 'transparent', color: editMode ? '#000' : 'rgba(255,255,255,0.7)',
        border: editMode ? 'none' : '1px solid rgba(255,255,255,0.1)',
        cursor: 'pointer', fontWeight: 600,
      }}>✎ Edit</button>
      <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', fontFamily: '"JetBrains Mono", ui-monospace, monospace' }}>2560×1440</span>
    </div>
  );
}

function WeatherSearch({
  current, onPick,
}: {
  current: WeatherLocation;
  onPick: (loc: WeatherLocation) => void;
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
        const { geocode } = await import('./state/weatherLocation');
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '4px 0' }}>
      <div style={{ fontSize: 11, fontWeight: 500, color: 'rgba(41,38,27,0.85)', display: 'flex', justifyContent: 'space-between' }}>
        <span>Location</span>
        <span style={{ fontFamily: '"JetBrains Mono", ui-monospace, monospace', color: 'rgba(41,38,27,0.55)', fontSize: 10 }}>
          {current.label}
        </span>
      </div>
      <input
        type="text" value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search a city…"
        style={{
          fontSize: 11, padding: '5px 8px',
          background: 'rgba(41,38,27,0.05)', border: '1px solid rgba(41,38,27,0.15)',
          borderRadius: 4, color: 'rgba(41,38,27,0.9)',
        }}
      />
      {loading && <div style={{ fontSize: 10, color: 'rgba(41,38,27,0.5)' }}>Searching…</div>}
      {err && <div style={{ fontSize: 10, color: '#b91c1c' }}>{err}</div>}
      {results.length > 0 && (
        <div style={{
          display: 'flex', flexDirection: 'column', gap: 2,
          background: 'rgba(41,38,27,0.04)', borderRadius: 4, padding: 4,
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
                textAlign: 'left', padding: '4px 6px', borderRadius: 3,
                background: 'transparent', border: 'none', cursor: 'pointer',
                fontSize: 11, color: 'rgba(41,38,27,0.85)',
              }}
            >
              <div style={{ fontWeight: 500 }}>{r.label}</div>
              <div style={{ fontSize: 9, color: 'rgba(41,38,27,0.5)', fontFamily: '"JetBrains Mono", ui-monospace, monospace' }}>
                {r.lat.toFixed(3)}, {r.lon.toFixed(3)}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Measures actual rAF frame interval as a rolling average and returns FPS.
 *  Updates state once per second so we don't trash React with 60Hz re-renders. */
function useFrameRate(): number {
  const [fps, setFps] = useState(60);
  useEffect(() => {
    let raf = 0;
    let frames = 0;
    let last = performance.now();
    const tick = (now: number) => {
      frames++;
      if (now - last >= 1000) {
        setFps(Math.round((frames * 1000) / (now - last)));
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
  accent, onSwitcher, profileName, tileCount, app, fps,
}: {
  accent: string;
  onSwitcher: () => void;
  profileName: string;
  tileCount: number;
  app: AppMetrics | null;
  fps: number;
}) {
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

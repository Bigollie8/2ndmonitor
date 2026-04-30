import { useEffect, useState } from 'react';
import type { Track, Profile, AccentTheme, VizMode, Density } from './types';
import type { Todo, WeatherLocation } from './types';
import type { GeocodeResult } from './state/weatherLocation';
import { TRACKS, ACCENT_PALETTES, getDensity } from './data';
import { useTweaks } from './state/useTweaks';
import { useSysmon, useNowPlaying, useSpectrumRef } from './state/tauri';
import { VizHero } from './components/viz';
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
import {
  TweaksPanel, TweakSection, TweakRadio, TweakSelect, TweakButton,
} from './components/tweaks';

type TileId = 'discord' | 'spotify' | 'claude' | 'notes' | 'linear' | 'sysmon' | 'clock' | 'upnext';

interface VizColorOverride {
  enabled: boolean;
  accent: string;
  accent2: string;
}

interface TweakState extends Record<string, unknown> {
  vizMode: VizMode;
  accentTheme: AccentTheme;
  density: Density;
  hidden: Partial<Record<TileId, boolean>>;
  vizArtBg: boolean;
  vizSensitivity: number;
  vizSmoothing: number;
  vizColorOverride: VizColorOverride;
  todos: Todo[];
  weatherLocation: WeatherLocation;
}

const TWEAK_DEFAULTS: TweakState = {
  vizMode: 'bars',
  accentTheme: 'auto',
  density: 'compact',
  hidden: {},
  vizArtBg: false,
  vizSensitivity: 1.0,
  vizSmoothing: 0.0,
  vizColorOverride: { enabled: false, accent: '#a78bfa', accent2: '#ec4899' },
  todos: [],
  weatherLocation: { label: 'Knoxville, TN', lat: 35.9606, lon: -83.9207 },
};

const RAIL_DEFS: { id: TileId; label: string; row: number }[] = [
  { id: 'discord', label: 'Discord',     row: 1.1 },
  { id: 'spotify', label: 'Now playing', row: 1.0 },
  { id: 'claude',  label: 'Claude Code', row: 1.4 },
  { id: 'notes',   label: 'Notes',       row: 0.6 },
];

const STRIP_DEFS: { id: TileId; label: string; col: number }[] = [
  { id: 'sysmon', label: 'System monitor', col: 1.4 },
  { id: 'clock',  label: 'Now & forecast', col: 2.0 },
];

export default function App() {
  const [t, setTweak] = useTweaks<TweakState>(TWEAK_DEFAULTS);
  const [manualTrack, setManualTrack] = useState<Track>(TRACKS[0]!);
  const [editMode, setEditMode] = useState(false);
  const [profile, setProfile] = useState<Profile>('work');
  const [showSwitcher, setShowSwitcher] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
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
        setProfile((['work', 'gaming', 'chill'] as const)[idx]!);
      }
      else if (e.key === 'Escape') {
        if (showSwitcher) setShowSwitcher(false);
        else if (showOnboarding) setShowOnboarding(false);
        else if (editMode) setEditMode(false);
      }
      else if (!editing && !cmd && (e.key === 'v' || e.key === 'V')) {
        const modes: VizMode[] = ['bars', 'waveform', 'radial', 'particles', 'ambient'];
        const i = modes.indexOf(t.vizMode);
        setTweak('vizMode', modes[(i + 1) % modes.length]!);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showSwitcher, editMode, showOnboarding, t.vizMode, setTweak]);

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

  const gap = getDensity(t.density).gap;
  const overlaysOpen = editMode || showSwitcher || showOnboarding;
  const hidden = t.hidden;
  const visibleRail = RAIL_DEFS.filter((r) => !hidden[r.id]);
  const visibleStrip = STRIP_DEFS.filter((c) => !hidden[c.id]);

  const setHidden = (id: TileId, hide: boolean) => {
    setTweak('hidden', { ...hidden, [id]: hide || undefined });
  };

  const renderRailTile = (id: TileId) => {
    switch (id) {
      case 'discord':
        return <DiscordTile density={t.density} accent={accent} />;
      case 'spotify':
        return <SpotifyTile density={t.density} accent={accent} accent2={accent2} track={track} onPick={setTrack} playback={livePlayback} spectrumRef={spectrumRef} />;
      case 'claude':
        return <ClaudeCodeTile density={t.density} accent={accent} />;
      case 'notes':
        return (
          <NotesTile
            density={t.density}
            accent={accent}
            todos={t.todos}
            setTodos={(next) => setTweak('todos', next)}
          />
        );
      default:
        return null;
    }
  };

  const renderStripTile = (id: TileId) => {
    switch (id) {
      case 'sysmon': return <SysMonTile density={t.density} accent={accent} accent2={accent2} history={sysmon} />;
      case 'clock':  return <NowAndForecastTile density={t.density} accent={accent} accent2={accent2} />;
      default:       return null;
    }
  };

  return (
    <div style={{ width: '100vw', height: '100vh', background: '#000', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
      <div style={{
        width: 2560, height: 1440,
        transform: `scale(${scale})`, transformOrigin: 'center center',
        flexShrink: 0, background: '#06070a', position: 'relative', overflow: 'hidden', borderRadius: 8,
      }}>
        <TopChrome
          accent={accent} editMode={editMode} setEditMode={setEditMode}
          accentLinked={accentLinked} track={track}
          profile={profile} setProfile={setProfile}
          onSwitcher={() => setShowSwitcher(true)}
          onOnboarding={() => setShowOnboarding(true)}
        />
        <div style={{
          position: 'absolute', top: 56, bottom: 32, left: 20, right: 20,
          display: 'grid',
          gridTemplateColumns: '560px 1fr',
          gridTemplateRows: '1fr',
          gap,
        }}>
          <div style={{
            display: 'grid',
            gridTemplateRows: visibleRail.map((r) => `${r.row}fr`).join(' '),
            gap,
            minHeight: 0,
          }}>
            {visibleRail.map((r) => (
              <div key={r.id} style={{ minHeight: 0 }}>{renderRailTile(r.id)}</div>
            ))}
          </div>
          <div style={{ display: 'grid', gridTemplateRows: '1fr 360px', gap, minHeight: 0 }}>
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
            />
            <div style={{
              display: 'grid',
              gridTemplateColumns: visibleStrip.map((c) => `${c.col}fr`).join(' '),
              gap,
              minHeight: 0,
            }}>
              {visibleStrip.map((c) => (
                <div key={c.id} style={{ minWidth: 0 }}>{renderStripTile(c.id)}</div>
              ))}
            </div>
          </div>
        </div>
        <BottomStatus accent={accent} onSwitcher={() => setShowSwitcher(true)} profile={profile} />
        {editMode && (
          <EditModeOverlay
            accent={accent}
            accent2={accent2}
            onExit={() => setEditMode(false)}
            onRemove={(id) => setHidden(id as TileId, true)}
            hiddenIds={(Object.keys(hidden) as TileId[]).filter((k) => hidden[k])}
          />
        )}
        {showSwitcher && <ProfileSwitcher accent={accent} currentProfile={profile} setProfile={setProfile} onClose={() => setShowSwitcher(false)} onCreate={() => setShowSwitcher(false)} />}
        {showOnboarding && <Onboarding accent={accent} onFinish={() => setShowOnboarding(false)} />}
      </div>

      <TweaksPanel title="Tweaks" defaultOpen={true}>
        <TweakSection label="Visualizer" />
        <TweakRadio<VizMode>
          label="Mode" value={t.vizMode}
          options={['bars', 'waveform', 'radial', 'particles', 'ambient']}
          onChange={(v) => setTweak('vizMode', v)} />
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
        <TweakSection label="Weather" />
        <WeatherSearch
          current={t.weatherLocation}
          onPick={(loc) => setTweak('weatherLocation', loc)}
        />
        <TweakSection label="Tiles · show / hide" />
        {[...RAIL_DEFS, ...STRIP_DEFS].map((def) => {
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

function TopChrome({ accent, editMode, setEditMode, accentLinked, track, profile, setProfile, onSwitcher, onOnboarding }: {
  accent: string;
  editMode: boolean;
  setEditMode: (b: boolean) => void;
  accentLinked: boolean;
  track: Track;
  profile: Profile;
  setProfile: (p: Profile) => void;
  onSwitcher: () => void;
  onOnboarding: () => void;
}) {
  const PROFILES: { id: Profile; name: string }[] = [
    { id: 'work', name: 'Work' }, { id: 'gaming', name: 'Gaming' }, { id: 'chill', name: 'Chill' },
  ];
  return (
    <div style={{
      position: 'absolute', top: 0, left: 0, right: 0, height: 56,
      background: 'rgba(8,9,12,0.85)', backdropFilter: 'blur(20px)',
      borderBottom: '1px solid rgba(255,255,255,0.05)',
      display: 'flex', alignItems: 'center', padding: '0 18px', gap: 16, zIndex: 10,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ width: 16, height: 16, borderRadius: 5, background: `linear-gradient(135deg, ${accent}, ${accent}99)`, boxShadow: `0 0 12px ${accent}66` }} />
        <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: '-0.01em' }}>Hub</span>
      </div>
      <div style={{ width: 1, height: 18, background: 'rgba(255,255,255,0.08)' }} />
      <div style={{ display: 'flex', gap: 4 }}>
        {PROFILES.map((p) => {
          const active = profile === p.id;
          return (
            <button key={p.id} onClick={() => setProfile(p.id)} style={{
              padding: '5px 12px', fontSize: 11, borderRadius: 6,
              background: active ? `${accent}20` : 'transparent',
              color: active ? accent : 'rgba(255,255,255,0.5)',
              border: active ? `1px solid ${accent}55` : '1px solid transparent',
              cursor: 'pointer', fontWeight: active ? 600 : 400,
            }}>{p.name}</button>
          );
        })}
        <button onClick={onSwitcher} title="Open profile switcher" style={{
          padding: '5px 8px', fontSize: 11, borderRadius: 6,
          background: 'transparent', color: 'rgba(255,255,255,0.4)',
          border: '1px solid transparent', cursor: 'pointer',
        }}>⌃ More</button>
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

function BottomStatus({ accent, onSwitcher, profile }: { accent: string; onSwitcher: () => void; profile: Profile }) {
  return (
    <div style={{
      position: 'absolute', bottom: 0, left: 0, right: 0, height: 32,
      background: 'rgba(8,9,12,0.85)', backdropFilter: 'blur(20px)',
      borderTop: '1px solid rgba(255,255,255,0.05)',
      display: 'flex', alignItems: 'center', padding: '0 18px', gap: 18, zIndex: 10,
      fontSize: 10.5, color: 'rgba(255,255,255,0.45)', fontFamily: '"JetBrains Mono", ui-monospace, monospace',
    }}>
      <span style={{ color: accent }}>● 8 tiles</span>
      <span>CPU 1.2%</span>
      <span>RAM 142 MB</span>
      <span>GPU 3.1%</span>
      <span>Audio: WASAPI loopback</span>
      <div style={{ flex: 1 }} />
      <button onClick={onSwitcher} style={{ background: 'transparent', border: 'none', color: 'rgba(255,255,255,0.45)', fontFamily: 'inherit', fontSize: 'inherit', cursor: 'pointer', padding: 0 }}>⌘1/2/3 profile · {profile}</button>
      <span style={{ color: 'rgba(255,255,255,0.25)' }}>·</span>
      <span>⌘E edit · ⌘K command · ⌘, settings</span>
    </div>
  );
}

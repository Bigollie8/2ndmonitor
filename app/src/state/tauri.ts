import { useEffect, useRef, useState, type MutableRefObject } from 'react';
import type { SysmonHistory, SysmonSample, Track } from '../types';

export const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

const HISTORY_LEN = 40;

function emptyHistory(): SysmonHistory {
  const zeros = (n: number) => Array.from({ length: HISTORY_LEN }, () => n);
  return {
    cpu: zeros(0.1),
    ram: zeros(0.4),
    gpu: zeros(0.1),
    net: zeros(0.05),
    latest: {
      cpu: 0, ram: 0.4, gpu: 0, net: 0,
      cpu_pct_text: '—', ram_text: '—', gpu_pct_text: '—', net_text: '—',
      cpu_sub: '', ram_sub: '', gpu_sub: '', net_sub: '',
      top: [],
      app: null,
    },
  };
}

// Mock sysmon when running in plain browser (no Tauri host).
function startMockSysmon(onSample: (s: SysmonSample) => void): () => void {
  let cpu = 0.2, ram = 0.4, gpu = 0.3;
  const id = setInterval(() => {
    cpu = Math.max(0.05, Math.min(1, cpu + (Math.random() - 0.5) * 0.15));
    ram = Math.max(0.05, Math.min(1, ram + (Math.random() - 0.5) * 0.04));
    gpu = Math.max(0.05, Math.min(1, gpu + (Math.random() - 0.5) * 0.2));
    const net = Math.random() * 0.7;
    onSample({
      cpu, ram, gpu, net,
      cpu_pct_text: `${Math.round(cpu * 100)}%`,
      ram_text: `${(ram * 32).toFixed(1)}G`,
      gpu_pct_text: `${Math.round(gpu * 100)}%`,
      net_text: `↓${(net * 12).toFixed(1)}`,
      cpu_sub: '4.1 GHz · 58°C',
      ram_sub: `${Math.round(ram * 100)}% of 32 GB`,
      gpu_sub: '6.1G · 64°C',
      net_sub: '↑0.4 MB/s · Wi-Fi',
      top: [
        { name: 'chrome.exe', cpu: 12.4 },
        { name: 'Hub.exe', cpu: 1.2 },
        { name: 'Discord.exe', cpu: 3.1 },
        { name: 'Code.exe', cpu: 4.7 },
      ],
      app: { cpu: 1.5 + Math.random() * 2, ram_mb: 130 + Math.random() * 30, gpu: 2 + Math.random() * 4 },
    });
  }, 1000);
  return () => clearInterval(id);
}

export function useSysmon(): SysmonHistory {
  const [history, setHistory] = useState<SysmonHistory>(emptyHistory);

  useEffect(() => {
    let cancelled = false;
    let cleanup: (() => void) | null = null;

    const handleSample = (s: SysmonSample) => {
      if (cancelled) return;
      setHistory((h) => ({
        cpu: [...h.cpu.slice(1), s.cpu],
        ram: [...h.ram.slice(1), s.ram],
        gpu: [...h.gpu.slice(1), s.gpu],
        net: [...h.net.slice(1), s.net],
        latest: s,
      }));
    };

    if (isTauri) {
      // Live sysmon from the Rust backend.
      import('@tauri-apps/api/event')
        .then(({ listen }) => listen<SysmonSample>('sysmon:tick', (e) => handleSample(e.payload)))
        .then((unlisten) => {
          if (cancelled) { unlisten(); return; }
          cleanup = unlisten;
        })
        .catch((err) => console.error('sysmon listen failed', err));
    } else {
      cleanup = startMockSysmon(handleSample);
    }

    return () => {
      cancelled = true;
      if (cleanup) cleanup();
    };
  }, []);

  return history;
}

// ─────────────────────────────────────────────────────────────────────────────
// Now playing — wraps GSMTC events from the Rust core.
// ─────────────────────────────────────────────────────────────────────────────

interface NowPlayingPayload {
  title: string;
  artist: string;
  album: string;
  has_session: boolean;
  playing: boolean;
  position: number;
  duration: number;
  art_data_url: string | null;
}

export interface Playback {
  /** Last GSMTC-reported position, in seconds. */
  positionAtSync: number;
  /** Track duration in seconds. 0 when unknown. */
  duration: number;
  /** True when player state == Playing. */
  playing: boolean;
  /** performance.now() timestamp when positionAtSync was set, for local tick interpolation. */
  syncedAt: number;
}

// Five accent palettes the GSMTC hash maps into. Mirrors the demo TRACKS list
// so the visual rhythm of the tile design carries over to real tracks.
const NP_PALETTES: { cover: string; accent: string; accent2: string }[] = [
  { cover: 'linear-gradient(135deg, #f97316, #ec4899)', accent: '#fb923c', accent2: '#ec4899' },
  { cover: 'linear-gradient(135deg, #1e3a8a, #06b6d4)', accent: '#06b6d4', accent2: '#3b82f6' },
  { cover: 'linear-gradient(135deg, #7c2d12, #facc15)', accent: '#facc15', accent2: '#f59e0b' },
  { cover: 'linear-gradient(135deg, #be185d, #6d28d9)', accent: '#a78bfa', accent2: '#ec4899' },
  { cover: 'linear-gradient(135deg, #052e2b, #7cf5d4)', accent: '#7cf5d4', accent2: '#a78bfa' },
];

function hashTo(s: string, n: number): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0;
  }
  return h % n;
}

function payloadToTrack(p: NowPlayingPayload): Track | null {
  if (!p.has_session || !p.title) return null;
  const palette = NP_PALETTES[hashTo(p.artist + p.album, NP_PALETTES.length)]!;
  // Use real album art when GSMTC gave us thumbnail bytes; fall back to the
  // procedural gradient otherwise (sources without embedded artwork).
  const cover = p.art_data_url
    ? `center / cover no-repeat url("${p.art_data_url}")`
    : palette.cover;
  return {
    title: p.title,
    artist: p.artist || 'Unknown artist',
    album: p.album || '',
    cover,
    accent: palette.accent,
    accent2: palette.accent2,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Audio spectrum — wraps `audio:spectrum` events from the Rust audio thread.
// Returns a stable ref that the rAF-driven viz renderers can read on every
// frame without triggering React re-renders.
// ─────────────────────────────────────────────────────────────────────────────

export interface SpectrumState {
  bands: Float32Array;
  level: number;
  /** True once we've received at least one frame of real audio. */
  live: boolean;
}

interface AudioFramePayload {
  bands: number[];
  level: number;
}

export function useSpectrumRef(): MutableRefObject<SpectrumState> {
  const ref = useRef<SpectrumState>({
    bands: new Float32Array(64),
    level: 0,
    live: false,
  });

  useEffect(() => {
    if (!isTauri) return;
    let cancelled = false;
    let cleanup: (() => void) | null = null;

    import('@tauri-apps/api/event')
      .then(({ listen }) =>
        listen<AudioFramePayload>('audio:spectrum', (e) => {
          if (cancelled) return;
          const arr = ref.current.bands;
          const src = e.payload.bands;
          const n = Math.min(arr.length, src.length);
          for (let i = 0; i < n; i++) arr[i] = src[i]!;
          ref.current.level = e.payload.level;
          ref.current.live = true;
        })
      )
      .then((unlisten) => {
        if (cancelled) { unlisten(); return; }
        cleanup = unlisten;
      })
      .catch((err) => console.error('audio listen failed', err));

    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, []);

  return ref;
}

export interface NowPlayingState {
  track: Track | null;
  playback: Playback | null;
}

/**
 * Returns the currently-playing track AND timeline data from Windows GSMTC.
 * Both fields are null when nothing is playing / not in Tauri.
 */
export function useNowPlaying(): NowPlayingState {
  const [state, setState] = useState<NowPlayingState>({ track: null, playback: null });

  useEffect(() => {
    if (!isTauri) return;
    let cleanup: (() => void) | null = null;
    let cancelled = false;

    import('@tauri-apps/api/event')
      .then(({ listen }) => listen<NowPlayingPayload>('nowplaying:tick', (e) => {
        if (cancelled) return;
        const p = e.payload;
        const track = payloadToTrack(p);

        // Drift detection is ASYMMETRIC. GSMTC's reported position routinely
        // lags real playback by 200-1500ms (Spotify pushes position at ~1Hz),
        // so a "negative drift" (GSMTC value < our interpolated value) is
        // almost always a lag spike — re-syncing to it would yank lyrics
        // backward. We only re-anchor on:
        //   - track change / play-state change
        //   - forward drift > 1s (we missed time, e.g. tab throttled, or user
        //     seeked forward)
        //   - very large backward drift > 15s (real backward seek; anything
        //     smaller is treated as GSMTC jitter and ignored)
        const FORWARD_RESYNC_THRESHOLD = 1.0;
        const BIG_BACKWARD_SEEK = 15.0;
        setState((prev) => {
          let nextPlayback: Playback | null;
          if (!p.has_session) {
            nextPlayback = null;
          } else {
            const prevPb = prev.playback;
            const trackChanged =
              !prev.track || track?.title !== prev.track.title || track?.artist !== prev.track.artist;
            const playStateChanged = !prevPb || prevPb.playing !== p.playing;
            const reanchor = !prevPb || trackChanged || playStateChanged;

            if (reanchor) {
              nextPlayback = {
                positionAtSync: p.position,
                duration: p.duration,
                playing: p.playing,
                syncedAt: performance.now(),
              };
            } else {
              const elapsed = prevPb.playing
                ? (performance.now() - prevPb.syncedAt) / 1000
                : 0;
              const interpolated = prevPb.positionAtSync + elapsed;
              const driftSigned = p.position - interpolated;
              const isForwardJump = driftSigned > FORWARD_RESYNC_THRESHOLD;
              const isBigBackwardSeek = driftSigned < -BIG_BACKWARD_SEEK;
              if (isForwardJump || isBigBackwardSeek) {
                nextPlayback = {
                  positionAtSync: p.position,
                  duration: p.duration,
                  playing: p.playing,
                  syncedAt: performance.now(),
                };
              } else if (prevPb.duration !== p.duration) {
                nextPlayback = { ...prevPb, duration: p.duration };
              } else {
                // Hold anchor — interpolation continues forward smoothly.
                nextPlayback = prevPb;
              }
            }
          }
          return { track, playback: nextPlayback };
        });
      }))
      .then((unlisten) => {
        if (cancelled) { unlisten(); return; }
        cleanup = unlisten;
      })
      .catch((err) => console.error('nowplaying listen failed', err));

    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, []);

  return state;
}

// ─────────────────────────────────────────────────────────────────────────────
// Claude Code sessions
// ─────────────────────────────────────────────────────────────────────────────

export type ClaudeStatus = 'awaiting_user' | 'permission' | 'running_tool' | 'working' | 'idle';

export interface ClaudeSession {
  project: string;
  project_path: string;
  session_id: string;
  last_activity_secs: number;
  status: ClaudeStatus;
  status_detail: string;
  last_user_msg: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Weather (Open-Meteo, polled hourly in Rust)
// ─────────────────────────────────────────────────────────────────────────────

export interface DayForecast {
  date: string;
  day_of_week: string;
  high_f: number;
  low_f: number;
  code: number;
  icon: string;
  label: string;
}

export interface HourForecast {
  time: string;
  temp_f: number;
  code: number;
  icon: string;
  precip_pct: number;
}

export interface Weather {
  current_temp_f: number;
  feels_like_f: number;
  current_code: number;
  current_icon: string;
  current_label: string;
  humidity: number;
  wind_mph: number;
  sunrise: string;
  sunset: string;
  hourly: HourForecast[];
  forecast: DayForecast[];
  location: string;
}

export function useWeather(): Weather | null {
  const [weather, setWeather] = useState<Weather | null>(null);
  useEffect(() => {
    if (!isTauri) return;
    let cancelled = false;
    let cleanup: (() => void) | null = null;
    import('@tauri-apps/api/event')
      .then(({ listen }) => listen<Weather>('weather:tick', (e) => {
        if (cancelled) return;
        setWeather(e.payload);
      }))
      .then((unlisten) => {
        if (cancelled) { unlisten(); return; }
        cleanup = unlisten;
      })
      .catch((err) => console.error('weather listen failed', err));
    return () => { cancelled = true; cleanup?.(); };
  }, []);
  return weather;
}

// ─────────────────────────────────────────────────────────────────────────────
// Media controls — wraps the Rust `media_*` commands which drive GSMTC.
// ─────────────────────────────────────────────────────────────────────────────

async function invokeMedia(cmd: 'media_toggle' | 'media_next' | 'media_previous'): Promise<void> {
  if (!isTauri) return;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke(cmd);
  } catch (err) {
    console.error(`${cmd} failed`, err);
  }
}

export const mediaControls = {
  togglePlayPause: () => invokeMedia('media_toggle'),
  next: () => invokeMedia('media_next'),
  previous: () => invokeMedia('media_previous'),
};

// ─────────────────────────────────────────────────────────────────────────────
// Discord (OAuth PKCE → REST polling)
// ─────────────────────────────────────────────────────────────────────────────

export interface DiscordUser {
  id: string;
  username: string;
  global_name: string | null;
  discriminator: string;
  avatar: string | null;
}

export interface DiscordGuild {
  id: string;
  name: string;
  icon: string | null;
}

export interface DiscordState {
  connected: boolean;
  connecting: boolean;
  error: string | null;
  user: DiscordUser | null;
  guilds: DiscordGuild[];
  has_data: boolean;
}

const EMPTY_DISCORD_STATE: DiscordState = {
  connected: false, connecting: false, error: null,
  user: null, guilds: [], has_data: false,
};

// ── Discord RPC (local IPC: voice state + DM/mention notifications) ───────

export interface VoiceMember {
  user_id: string;
  username: string;
  global_name: string | null;
  avatar: string | null;
  muted: boolean;
  deafened: boolean;
  speaking: boolean;
}

export interface VoiceState {
  channel_id: string | null;
  channel_name: string | null;
  guild_id: string | null;
  guild_name: string | null;
  members: VoiceMember[];
}

export interface RpcNotification {
  timestamp_ms: number;
  channel_id: string;
  author: string;
  author_avatar: string | null;
  title: string;
  body: string;
  icon_url: string | null;
}

export interface DiscordRpcState {
  connected: boolean;
  error: string | null;
  voice: VoiceState;
  notifications: RpcNotification[];
  /** User id of the authenticated Discord account (i.e. "us"). */
  self_user_id: string | null;
}

const EMPTY_RPC: DiscordRpcState = {
  connected: false, error: null,
  voice: { channel_id: null, channel_name: null, guild_id: null, guild_name: null, members: [] },
  notifications: [],
  self_user_id: null,
};

async function invokeRpc<T = void>(cmd: string, args?: Record<string, unknown>): Promise<T | null> {
  if (!isTauri) return null;
  const { invoke } = await import('@tauri-apps/api/core');
  try {
    return await invoke<T>(cmd, args ?? {});
  } catch (err) {
    console.error(`${cmd} failed`, err);
    throw err;
  }
}

export const discordVoice = {
  setMute: (mute: boolean) => invokeRpc('discord_rpc_set_voice_settings', { mute }),
  setDeaf: (deaf: boolean) => invokeRpc('discord_rpc_set_voice_settings', { deaf }),
  leave: () => invokeRpc('discord_rpc_leave_voice'),
};

export function useDiscordRpc(): DiscordRpcState {
  const [state, setState] = useState<DiscordRpcState>(EMPTY_RPC);
  useEffect(() => {
    if (!isTauri) return;
    let cancelled = false;
    let cleanup: (() => void) | null = null;
    (async () => {
      const { listen } = await import('@tauri-apps/api/event');
      const { invoke } = await import('@tauri-apps/api/core');
      try {
        const initial = await invoke<DiscordRpcState>('discord_rpc_status');
        if (!cancelled) setState(initial);
      } catch { /* ignore */ }
      const unlisten = await listen<DiscordRpcState>('discord_rpc:state', (e) => {
        if (cancelled) return;
        setState(e.payload);
      });
      if (cancelled) { unlisten(); return; }
      cleanup = unlisten;
    })().catch((err) => console.error('discord_rpc listen failed', err));
    return () => { cancelled = true; cleanup?.(); };
  }, []);
  return state;
}

export function useDiscord(): {
  state: DiscordState;
  connect: (clientId: string) => Promise<void>;
  disconnect: () => Promise<void>;
  getStoredClientId: () => Promise<string | null>;
} {
  const [state, setState] = useState<DiscordState>(EMPTY_DISCORD_STATE);

  useEffect(() => {
    if (!isTauri) return;
    let cancelled = false;
    let cleanup: (() => void) | null = null;
    (async () => {
      const { listen } = await import('@tauri-apps/api/event');
      const { invoke } = await import('@tauri-apps/api/core');
      try {
        const initial = await invoke<DiscordState>('discord_status');
        if (!cancelled) setState(initial);
      } catch { /* ignore */ }
      const unlisten = await listen<DiscordState>('discord:state', (e) => {
        if (cancelled) return;
        setState(e.payload);
      });
      if (cancelled) { unlisten(); return; }
      cleanup = unlisten;
    })().catch((err) => console.error('discord listen failed', err));
    return () => { cancelled = true; cleanup?.(); };
  }, []);

  const connect = async (clientId: string) => {
    if (!isTauri) return;
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('discord_connect', { clientId });
  };
  const disconnect = async () => {
    if (!isTauri) return;
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('discord_disconnect');
  };
  const getStoredClientId = async (): Promise<string | null> => {
    if (!isTauri) return null;
    const { invoke } = await import('@tauri-apps/api/core');
    try { return await invoke<string | null>('discord_get_client_id'); }
    catch { return null; }
  };

  return { state, connect, disconnect, getStoredClientId };
}

// ─────────────────────────────────────────────────────────────────────────────
// Spotify (OAuth PKCE → Web API queue polling)
// ─────────────────────────────────────────────────────────────────────────────

export interface SpotifyTrack {
  id: string;
  title: string;
  artist: string;
  album: string;
  art_url: string | null;
  duration_ms: number;
}

export interface SpotifyState {
  connected: boolean;
  connecting: boolean;
  error: string | null;
  queue: SpotifyTrack[];
  premium_required: boolean;
  volume_percent: number | null;     // 0..100
  device_id: string | null;
  device_name: string | null;
  volume_supported: boolean;
  needs_reauth: boolean;
}

const EMPTY_SPOTIFY: SpotifyState = {
  connected: false, connecting: false, error: null,
  queue: [], premium_required: false,
  volume_percent: null, device_id: null, device_name: null,
  volume_supported: false, needs_reauth: false,
};

export function useSpotify(): {
  state: SpotifyState;
  connect: (clientId: string) => Promise<void>;
  disconnect: () => Promise<void>;
  getStoredClientId: () => Promise<string | null>;
  setVolume: (percent: number) => Promise<void>;
} {
  const [state, setState] = useState<SpotifyState>(EMPTY_SPOTIFY);

  useEffect(() => {
    if (!isTauri) return;
    let cancelled = false;
    let cleanup: (() => void) | null = null;
    (async () => {
      const { listen } = await import('@tauri-apps/api/event');
      const { invoke } = await import('@tauri-apps/api/core');
      try {
        const initial = await invoke<SpotifyState>('spotify_status');
        if (!cancelled) setState(initial);
      } catch { /* ignore */ }
      const unlisten = await listen<SpotifyState>('spotify:state', (e) => {
        if (cancelled) return;
        setState(e.payload);
      });
      if (cancelled) { unlisten(); return; }
      cleanup = unlisten;
    })().catch((err) => console.error('spotify listen failed', err));
    return () => { cancelled = true; cleanup?.(); };
  }, []);

  const connect = async (clientId: string) => {
    if (!isTauri) return;
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('spotify_connect', { clientId });
  };
  const disconnect = async () => {
    if (!isTauri) return;
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('spotify_disconnect');
  };
  const getStoredClientId = async (): Promise<string | null> => {
    if (!isTauri) return null;
    const { invoke } = await import('@tauri-apps/api/core');
    try { return await invoke<string | null>('spotify_get_client_id'); }
    catch { return null; }
  };
  const setVolume = async (percent: number) => {
    if (!isTauri) return;
    const { invoke } = await import('@tauri-apps/api/core');
    const clamped = Math.max(0, Math.min(100, Math.round(percent)));
    await invoke('spotify_set_volume', { percent: clamped });
  };

  return { state, connect, disconnect, getStoredClientId, setVolume };
}

export function useClaudeSessions(): ClaudeSession[] {
  const [sessions, setSessions] = useState<ClaudeSession[]>([]);
  useEffect(() => {
    if (!isTauri) return;
    let cancelled = false;
    let cleanup: (() => void) | null = null;
    import('@tauri-apps/api/event')
      .then(({ listen }) => listen<ClaudeSession[]>('claude:sessions', (e) => {
        if (cancelled) return;
        setSessions(e.payload);
      }))
      .then((unlisten) => {
        if (cancelled) { unlisten(); return; }
        cleanup = unlisten;
      })
      .catch((err) => console.error('claude listen failed', err));
    return () => { cancelled = true; cleanup?.(); };
  }, []);
  return sessions;
}

// ─────────────────────────────────────────────────────────────────────────────
// Audio mixer — Windows Core Audio: master volume, output devices, per-app sessions.
// Listens to `mixer:state` events; setter helpers invoke the matching Rust commands.
// ─────────────────────────────────────────────────────────────────────────────

export interface MixerMaster {
  volume: number;
  mute: boolean;
  device_id: string;
  device_name: string;
}

export interface MixerOutputDevice {
  id: string;
  name: string;
  is_default: boolean;
}

export interface MixerAppSession {
  pid: number;
  name: string;
  volume: number;
  mute: boolean;
  is_system_sounds: boolean;
  /** `data:image/png;base64,…` for the exe's shell icon, or null. */
  icon: string | null;
}

export interface MixerState {
  master: MixerMaster | null;
  devices: MixerOutputDevice[];
  sessions: MixerAppSession[];
}

const MIXER_MOCK: MixerState = {
  master: { volume: 0.62, mute: false, device_id: 'mock_default', device_name: 'Speakers (Realtek)' },
  devices: [
    { id: 'mock_default', name: 'Speakers (Realtek)', is_default: true },
    { id: 'mock_headset', name: 'Headset (USB)', is_default: false },
  ],
  sessions: [
    { pid: 0, name: 'System sounds', volume: 0.85, mute: false, is_system_sounds: true, icon: null },
    { pid: 1234, name: 'Spotify.exe', volume: 0.74, mute: false, is_system_sounds: false, icon: null },
    { pid: 5678, name: 'chrome.exe', volume: 0.5, mute: false, is_system_sounds: false, icon: null },
    { pid: 9012, name: 'Discord.exe', volume: 0.4, mute: true, is_system_sounds: false, icon: null },
  ],
};

export function useMixerState(): MixerState | null {
  const [state, setState] = useState<MixerState | null>(isTauri ? null : MIXER_MOCK);

  useEffect(() => {
    if (!isTauri) return;
    let cancelled = false;
    let cleanup: (() => void) | null = null;
    import('@tauri-apps/api/event')
      .then(({ listen }) => listen<MixerState>('mixer:state', (e) => {
        if (cancelled) return;
        setState(e.payload);
      }))
      .then((unlisten) => {
        if (cancelled) { unlisten(); return; }
        cleanup = unlisten;
      })
      .catch((err) => console.error('mixer listen failed', err));
    // Kick the worker to emit immediately so the UI doesn't wait up to a second
    // on first render.
    import('@tauri-apps/api/core')
      .then(({ invoke }) => invoke('mixer_refresh').catch(() => {}))
      .catch(() => {});
    return () => { cancelled = true; cleanup?.(); };
  }, []);
  return state;
}

async function invokeMixer(cmd: string, args?: Record<string, unknown>): Promise<void> {
  if (!isTauri) return;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke(cmd, args);
  } catch (err) {
    console.error(`${cmd} failed`, err);
  }
}

export const mixerControls = {
  setMasterVolume: (v: number) => invokeMixer('mixer_set_master_volume', { v }),
  setMasterMute:   (m: boolean) => invokeMixer('mixer_set_master_mute', { m }),
  setSessionVolume: (pid: number, v: number) => invokeMixer('mixer_set_session_volume', { pid, v }),
  setSessionMute:   (pid: number, m: boolean) => invokeMixer('mixer_set_session_mute', { pid, m }),
  setDefaultOutput: (deviceId: string) => invokeMixer('mixer_set_default_output', { deviceId }),
  refresh: () => invokeMixer('mixer_refresh'),
};


import { useEffect, useRef, useState, type MutableRefObject } from 'react';
import type { SysmonHistory, SysmonSample, Track } from '../types';
import { deriveNextPlayback, tickSignature } from './playbackDerive';

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
      temps: null,
      power_watts: null,
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
      temps: [
        { label: 'CPU', celsius: 56 + Math.random() * 6 },
        { label: 'GPU', celsius: 62 + Math.random() * 6 },
        { label: 'Board', celsius: 41 },
        { label: 'NVMe', celsius: 47 },
      ],
      power_watts: 180 + Math.random() * 60,
    });
  }, 1000);
  return () => clearInterval(id);
}

// ─── Shared sysmon subscription (0.7.3 P6) ───────────────────────────────────
// One backend subscription for the whole app. Previously every useSysmon()
// caller opened its own Tauri listener and kept its own history, so the app
// held N listeners and allocated 4N arrays per second for identical data.
let sysmonHistory: SysmonHistory = emptyHistory();
const sysmonSubscribers = new Set<(h: SysmonHistory) => void>();
let sysmonStop: (() => void) | null = null;

function pushSysmonSample(s: SysmonSample): void {
  const h = sysmonHistory;
  sysmonHistory = {
    cpu: [...h.cpu.slice(1), s.cpu],
    ram: [...h.ram.slice(1), s.ram],
    gpu: [...h.gpu.slice(1), s.gpu],
    net: [...h.net.slice(1), s.net],
    latest: s,
  };
  for (const fn of sysmonSubscribers) fn(sysmonHistory);
}

function startSysmon(): void {
  if (isTauri) {
    let unlisten: (() => void) | null = null;
    let stopped = false;
    void import('@tauri-apps/api/event')
      .then(({ listen }) => listen<SysmonSample>('sysmon:tick', (e) => pushSysmonSample(e.payload)))
      .then((fn) => {
        if (stopped) { fn(); return; }
        unlisten = fn;
      })
      .catch((err) => console.error('sysmon listen failed', err));
    sysmonStop = () => { stopped = true; unlisten?.(); };
  } else {
    sysmonStop = startMockSysmon(pushSysmonSample);
  }
}

export function useSysmon(): SysmonHistory {
  const [history, setHistory] = useState<SysmonHistory>(sysmonHistory);

  useEffect(() => {
    sysmonSubscribers.add(setHistory);
    if (sysmonSubscribers.size === 1) startSysmon();
    // Adopt whatever has already accumulated so a late mount isn't blank.
    setHistory(sysmonHistory);
    return () => {
      sysmonSubscribers.delete(setHistory);
      if (sysmonSubscribers.size === 0) {
        sysmonStop?.();
        sysmonStop = null;
      }
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
  /** GSMTC SourceAppUserModelId — empty string when no session. */
  source_app_id: string;
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

    // Staleness watchdog (0.9.6): the Rust side STOPS emitting during
    // sustained silence (the idle-CPU fix), so `live` must age out — a
    // latched-true `live` would keep every meter writing identical zero
    // frames per rAF forever, which is exactly the compositing load the
    // idle gate exists to remove. 1s granularity is plenty: consumers only
    // use `live` to pick "settle at the floor" vs "track the data".
    let lastFrameAt = 0;
    const staleness = window.setInterval(() => {
      if (ref.current.live && performance.now() - lastFrameAt > 1500) {
        ref.current.live = false;
      }
    }, 1000);

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
          lastFrameAt = performance.now();
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
      window.clearInterval(staleness);
    };
  }, []);

  return ref;
}

export interface NowPlayingState {
  track: Track | null;
  playback: Playback | null;
  /** GSMTC source AUMID. Empty string when no active session. The frontend
   *  passes this through `mediaSourceFor` to render the platform pill and
   *  decide whether to surface Spotify-only controls. */
  sourceAppId: string;
}

/**
 * Returns the currently-playing track AND timeline data from Windows GSMTC.
 * Both fields are null when nothing is playing / not in Tauri.
 */
export function useNowPlaying(): NowPlayingState {
  const [state, setState] = useState<NowPlayingState>({ track: null, playback: null, sourceAppId: '' });

  useEffect(() => {
    if (!isTauri) return;
    let cleanup: (() => void) | null = null;
    let cancelled = false;
    // Last tick's change-signature (0.9.5). The Rust side emits every 2s
    // whether or not anything changed; an unchanged tick used to still
    // enqueue a setState whose updater closure captured that tick's fresh
    // track object — cover string included, ~240KB with art — and those
    // closures ACCUMULATE while the state never changes. That was the
    // frontend's share of the idle RAM leak (~7MB/min measured). Skipping
    // setState outright when the signature matches means no closure, no
    // retention, and no render machinery at 0.5Hz.
    let lastSig: string | null = null;
    // Stale-session gate (0.9.15): on launch, Windows GSMTC's
    // GetCurrentSession() happily returns whatever app last held media
    // focus — paused Spotify from yesterday included — so the tile showed
    // "what I had open last time". Policy: a session that has NOT been seen
    // playing during THIS app run presents as no track at all; the moment
    // it actually plays (playing: true on any tick) it appears and then
    // behaves exactly as before, pauses included. A track already playing
    // at launch passes immediately.
    let everSawPlaying = false;

    import('@tauri-apps/api/event')
      .then(({ listen }) => listen<NowPlayingPayload>('nowplaying:tick', (e) => {
        if (cancelled) return;
        const p = e.payload;
        const sig = tickSignature(p);
        if (sig === lastSig) return;
        lastSig = sig;
        if (p.playing) everSawPlaying = true;
        // Suppression covers the WHOLE tick, not just the track: a stale
        // session's playback anchor and source-app id would otherwise still
        // render transport pills for the phantom session.
        const suppressStale = !everSawPlaying;
        const track = suppressStale ? null : payloadToTrack(p);
        const effective: NowPlayingPayload = suppressStale
          ? { ...p, has_session: false, source_app_id: '' }
          : p;

        // Drift detection is ASYMMETRIC (see deriveNextPlayback): re-anchor
        // only on track/play-state change, forward drift > 1s, or backward
        // seek > 15s — and transient duration/position ZEROS from browser
        // GSMTC sessions hold the last good values instead of blanking the
        // timeline (the YouTube flicker fix, 0.9.5).
        setState((prev) => {
          const trackChanged =
            !prev.track || track?.title !== prev.track.title || track?.artist !== prev.track.artist;
          const nextPlayback = deriveNextPlayback(prev.playback, p, trackChanged, performance.now());
          // Referential stability: returning `prev` when nothing actually
          // changed lets React bail out of the re-render entirely — this
          // hook sits at the App root.
          const sameTrack =
            (track === null && prev.track === null) ||
            (track !== null && prev.track !== null &&
              track.title === prev.track.title &&
              track.artist === prev.track.artist &&
              track.album === prev.track.album &&
              track.cover === prev.track.cover);
          const nextSourceAppId = p.source_app_id ?? '';
          if (sameTrack && nextPlayback === prev.playback && nextSourceAppId === prev.sourceAppId) {
            return prev;
          }
          return {
            track: sameTrack ? prev.track : track,
            playback: nextPlayback,
            sourceAppId: nextSourceAppId,
          };
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
  /** Raw 0-23 hour (0.7.2 additive). Absent on payloads from an older backend
   *  — consumers fall back to the preformatted `time`. */
  hour?: number;
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
    // Attach the listener FIRST, then prime from the cached value. In this
    // order a tick landing mid-prime is still received, and the prime only
    // ever fills a still-empty slot, so it cannot clobber a fresher payload.
    // Without this, the poll thread's t=0 emit was lost whenever Rust won the
    // race against this hook's dynamic import + IPC registration, leaving the
    // forecast blank until the next tick (0.7.3).
    import('@tauri-apps/api/event')
      .then(({ listen }) => listen<Weather>('weather:tick', (e) => {
        if (cancelled) return;
        setWeather(e.payload);
      }))
      .then((unlisten) => {
        if (cancelled) { unlisten(); return; }
        cleanup = unlisten;
        return import('@tauri-apps/api/core')
          .then(({ invoke }) => invoke<Weather | null>('weather_current'))
          .then((cached) => {
            if (cancelled || !cached) return;
            setWeather((prev) => prev ?? cached);
          })
          .catch((err) => console.warn('weather_current failed', err));
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

export interface DiscordVoiceSettings {
  mute: boolean;
  deaf: boolean;
}

export const discordVoice = {
  setMute: (mute: boolean) => invokeRpc('discord_rpc_set_voice_settings', { mute }),
  setDeaf: (deaf: boolean) => invokeRpc('discord_rpc_set_voice_settings', { deaf }),
  getVoiceSettings: () =>
    invokeRpc<DiscordVoiceSettings>('discord_rpc_get_voice_settings'),
  toggleMute: async () => {
    const s = await invokeRpc<DiscordVoiceSettings>('discord_rpc_get_voice_settings');
    if (!s) return;
    await invokeRpc('discord_rpc_set_voice_settings', { mute: !s.mute });
  },
  toggleDeaf: async () => {
    const s = await invokeRpc<DiscordVoiceSettings>('discord_rpc_get_voice_settings');
    if (!s) return;
    await invokeRpc('discord_rpc_set_voice_settings', { deaf: !s.deaf });
  },
  leave: () => invokeRpc('discord_rpc_leave_voice'),
};

export const appActions = {
  openUrl: (url: string) => invokeRpc('app_open_url', { url }),
  copyText: (text: string) => invokeRpc('app_copy_text', { text }),
  sendHotkey: (args: {
    ctrl?: boolean; shift?: boolean; alt?: boolean; meta?: boolean; key: string;
  }) => invokeRpc('app_send_hotkey', { args }),
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
  /** Aborts a pending connect (0.9.5) — the stuck-"Authorizing" escape hatch. */
  cancelConnect: () => Promise<void>;
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
  const cancelConnect = async () => {
    if (!isTauri) return;
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('discord_cancel_connect');
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

  return { state, connect, cancelConnect, disconnect, getStoredClientId };
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
  /** Pick-a-song (0.9.4). play/queueAdd take a `spotify:track:` URI and
   *  REJECT with the server-classified reason (Premium required, no active
   *  device, reconnect for scope) — callers surface it, never swallow it.
   *  search is read-only and works on Free accounts. */
  play: (uri: string) => Promise<void>;
  queueAdd: (uri: string) => Promise<void>;
  search: (query: string) => Promise<SpotifyTrack[]>;
  /** Skip forward to a track already shown in the queue, PRESERVING what
   *  follows it (0.9.12). `index` is the row's position in `state.queue`.
   *  Distinct from `play`, which replaces the whole playback context with
   *  one track — correct for search results, destructive for queue rows. */
  skipToQueued: (uri: string, index: number) => Promise<void>;
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
  const play = async (uri: string) => {
    if (!isTauri) throw new Error('Requires the installed app');
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('spotify_play', { uri });
  };
  const queueAdd = async (uri: string) => {
    if (!isTauri) throw new Error('Requires the installed app');
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('spotify_queue_add', { uri });
  };
  const search = async (query: string): Promise<SpotifyTrack[]> => {
    if (!isTauri) return [];
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke<SpotifyTrack[]>('spotify_search', { query });
  };
  const skipToQueued = async (uri: string, index: number) => {
    if (!isTauri) throw new Error('Requires the installed app');
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('spotify_skip_to_queued', { uri, index });
  };

  return { state, connect, disconnect, getStoredClientId, setVolume, play, queueAdd, search, skipToQueued };
}

export function useClaudeSessions(): ClaudeSession[] {
  const [sessions, setSessions] = useState<ClaudeSession[]>([]);
  useEffect(() => {
    if (!isTauri) return;
    let cancelled = false;
    let cleanup: (() => void) | null = null;
    // Tell the Rust scanner someone is actually looking (0.9.5): the 5s
    // transcript walk only runs while a Claude tile is mounted — the same
    // gate the mixer uses. Without it, every user paid for scanning
    // ~/.claude/projects forever, tile or no tile.
    const setActive = (active: boolean) =>
      import('@tauri-apps/api/core')
        .then(({ invoke }) => invoke('set_claude_active', { active }))
        .catch(() => {});
    void setActive(true);
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
    return () => { cancelled = true; cleanup?.(); void setActive(false); };
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
  /** Lowercased executable basename, or null (system-sounds session). */
  exe: string | null;
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
    { pid: 0, name: 'System sounds', volume: 0.85, mute: false, is_system_sounds: true, icon: null, exe: null },
    { pid: 1234, name: 'Spotify.exe', volume: 0.74, mute: false, is_system_sounds: false, icon: null, exe: 'spotify.exe' },
    { pid: 5678, name: 'chrome.exe', volume: 0.5, mute: false, is_system_sounds: false, icon: null, exe: 'chrome.exe' },
    { pid: 9012, name: 'Discord.exe', volume: 0.4, mute: true, is_system_sounds: false, icon: null, exe: 'discord.exe' },
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


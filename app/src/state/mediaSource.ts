/** GSMTC `SourceAppUserModelId` (Windows) / bundle identifier (macOS) →
 *  human-readable platform info.
 *
 *  AUMIDs vary by install method:
 *   - Spotify desktop: `Spotify.exe`
 *   - Spotify Microsoft Store: `SpotifyAB.SpotifyMusic_zpdnekdrzrea0!Spotify`
 *   - Apple Music for Windows: `AppleInc.AppleMusicWin_nzyj5cx40ttqa!App`
 *   - Tidal: `Tidal.exe`
 *   - YouTube Music desktop (3rd-party th-ch/youtube-music): `youtube-music`
 *   - Web playback in Chrome: `chrome.exe` (or the AUMID `Chrome` for some installs)
 *   - Web playback in Edge: `MSEdge` or `msedge.exe`
 *   - VLC: `vlc.exe`
 *
 *  macOS instead reports a bundle identifier, e.g.:
 *   - Spotify desktop: `com.spotify.client`
 *   - Apple Music: `com.apple.Music`
 *   - Chrome: `com.google.Chrome`
 *   - Safari: `com.apple.Safari`
 *   - Edge: `com.microsoft.edgemac`
 *
 *  We normalize via case-insensitive substring match so install variants and
 *  both platforms' identifier shapes don't fall through to "Unknown source". */

export type MediaSourceKind =
  | 'spotify'
  | 'appleMusic'
  | 'youtubeMusic'
  | 'tidal'
  | 'amazonMusic'
  | 'browser'
  | 'vlc'
  | 'foobar'
  | 'mediaPlayer'
  | 'other'
  | 'none';

export interface MediaSourceInfo {
  kind: MediaSourceKind;
  /** Display name shown in the platform pill, e.g. "Spotify". */
  label: string;
  /** Single-character or short emoji glyph for compact display. */
  glyph: string;
  /** Hex accent for the pill fill. */
  color: string;
  /** True when this source has a Web API integration we ship (currently
   *  only Spotify). The Now Playing tile gates Up Next + volume on this. */
  hasQueueIntegration: boolean;
}

const NONE: MediaSourceInfo = {
  kind: 'none', label: '—', glyph: '·', color: 'rgba(255,255,255,0.3)',
  hasQueueIntegration: false,
};

const TABLE: { match: RegExp; info: MediaSourceInfo }[] = [
  { match: /spotify/i, info: {
    kind: 'spotify', label: 'Spotify', glyph: '♪', color: '#22c55e',
    hasQueueIntegration: true,
  }},
  { match: /applemusic|apple\s*music|apple\.music/i, info: {
    kind: 'appleMusic', label: 'Apple Music', glyph: '', color: '#fa233b',
    hasQueueIntegration: false,
  }},
  { match: /youtubemusic|youtube-music/i, info: {
    kind: 'youtubeMusic', label: 'YouTube Music', glyph: '►', color: '#ff0000',
    hasQueueIntegration: false,
  }},
  { match: /tidal/i, info: {
    kind: 'tidal', label: 'Tidal', glyph: '◆', color: '#000000',
    hasQueueIntegration: false,
  }},
  { match: /amazonmusic|amazon\s*music/i, info: {
    kind: 'amazonMusic', label: 'Amazon Music', glyph: '♫', color: '#00a8e1',
    hasQueueIntegration: false,
  }},
  { match: /chrome|firefox|msedge|edge|brave|opera|safari/i, info: {
    kind: 'browser', label: 'Browser', glyph: '◐', color: '#60a5fa',
    hasQueueIntegration: false,
  }},
  { match: /vlc/i, info: {
    kind: 'vlc', label: 'VLC', glyph: '▼', color: '#fb923c',
    hasQueueIntegration: false,
  }},
  { match: /foobar/i, info: {
    kind: 'foobar', label: 'foobar2000', glyph: '♬', color: '#a78bfa',
    hasQueueIntegration: false,
  }},
  { match: /microsoft\.zune|zunemusic|mediaplayer|mediaplayer\.exe/i, info: {
    kind: 'mediaPlayer', label: 'Media Player', glyph: '►', color: '#0078d4',
    hasQueueIntegration: false,
  }},
];

export function mediaSourceFor(aumid: string | null | undefined): MediaSourceInfo {
  if (!aumid) return NONE;
  for (const row of TABLE) {
    if (row.match.test(aumid)) return row.info;
  }
  // Heuristic for unknown apps: strip extension and common AUMID suffix.
  const cleaned = aumid
    .split('!')[0]!         // drop "!App" / "!Spotify"
    .replace(/\.exe$/i, '') // drop ".exe"
    .split('_')[0]!         // drop "_zpdnekdrzrea0"
    .split('.').pop() ?? aumid;
  return {
    kind: 'other',
    label: cleaned || 'Unknown',
    glyph: '♪',
    color: 'rgba(255,255,255,0.55)',
    hasQueueIntegration: false,
  };
}

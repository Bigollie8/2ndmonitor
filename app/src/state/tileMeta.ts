import type { BuiltinTileType } from './layout';

/** Single source of truth for tile presentation metadata, for built-in tiles
 *  only — an installed bundle's `TileMeta` is synthesized at runtime by
 *  `../tiles/tileRegistry.ts` (`mergeTileCatalog`), which is also the place
 *  to look for the catalog that includes both. Consumed by the Tile Library,
 *  the edit-mode layers/properties panels, and Settings.
 *  `Record<BuiltinTileType, ...>` makes the compiler refuse a new built-in
 *  TileType until it has an entry here — this table plus the default rects
 *  in layout.ts and a `renderTile` case are ALL a new built-in tile needs.
 *
 *  Icons are geometric glyphs only (no emoji): emoji render differently per
 *  Windows version and clash with the mono/glass aesthetic. */
export type TileCategory =
  | 'media' | 'system' | 'weather' | 'productivity' | 'ambient' | 'integrations';

export const TILE_CATEGORY_LABELS: Record<TileCategory, string> = {
  media: 'Media',
  system: 'System',
  weather: 'Weather & sky',
  productivity: 'Productivity',
  ambient: 'Ambient',
  integrations: 'Integrations',
};

export interface TileMeta {
  icon: string;
  label: string;
  description: string;
  multiInstance: boolean;
  category: TileCategory;
  /** Requires an API key / token before it shows anything useful. */
  needsKey?: boolean;
  /** Ties to an external account (OAuth-style) rather than a pasted key. */
  account?: boolean;
}

export const TILE_META: Record<BuiltinTileType, TileMeta> = {
  viz:     { icon: '◢', label: 'Audio visualizer',  description: '27 styles reactive to system audio',  multiInstance: false, category: 'media' },
  spotify: { icon: '♪', label: 'Now playing',       description: 'Track, lyrics, queue, volume',         multiInstance: false, category: 'media' },
  discord: { icon: '◇', label: 'Discord voice',     description: 'Voice channel members + speaking',     multiInstance: false, category: 'integrations', account: true },
  claude:  { icon: '⌘', label: 'Claude Code',       description: 'Active session log',                   multiInstance: false, category: 'productivity' },
  mixer:   { icon: '♬', label: 'Audio mixer',       description: 'Master volume + per-app sessions',     multiInstance: false, category: 'media' },
  notes:   { icon: '✎', label: 'Todos',             description: 'Quick task list',                      multiInstance: false, category: 'productivity' },
  sysmon:  { icon: '▤', label: 'System monitor',    description: 'CPU / RAM / GPU / network',            multiInstance: false, category: 'system' },
  clock:   { icon: '◐', label: 'Now & forecast',    description: 'Time + weather',                       multiInstance: false, category: 'weather' },
  streamDeck: { icon: '▦', label: 'Stream Deck',     description: 'Programmable button grid — actions, profile switching, playback', multiInstance: true, category: 'productivity' },
  weatherRadar: { icon: '☂', label: 'Weather radar',  description: 'Animated precipitation map centered on your saved location', multiInstance: false, category: 'weather' },
  pomodoro: { icon: '◷', label: 'Pomodoro', description: 'Focus / break interval timer with daily counter', multiInstance: false, category: 'productivity' },
  sun: { icon: '☀', label: 'Sun & golden hour', description: 'Sunrise, sunset, golden hour times for your saved location', multiInstance: false, category: 'weather' },
  aurora: { icon: '◍', label: 'Aurora & moon', description: 'KP index, aurora visibility, moon phase', multiInstance: false, category: 'weather' },
  airQuality: { icon: '▒', label: 'Air quality', description: 'AQI, UV index, PM2.5/PM10 for your saved location', multiInstance: false, category: 'weather' },
  stocks: { icon: '▲', label: 'Stock ticker', description: 'Live quotes for your watchlist (configurable)', multiInstance: true, category: 'productivity' },
  tides: { icon: '≈', label: 'Tide chart', description: 'Next high/low tides from NOAA station', multiInstance: false, category: 'weather' },
  githubPrs: { icon: '⊕', label: 'GitHub PRs', description: 'Open pull requests assigned, requested, authored', multiInstance: false, category: 'integrations', needsKey: true },
  streamChat: { icon: '◱', label: 'Stream chat', description: 'Live Twitch chat scroll for any channel', multiInstance: true, category: 'integrations' },
  phoneNotifs: { icon: '▯', label: 'Phone notifs', description: 'Mirror phone notifications via ntfy.sh topic', multiInstance: false, category: 'integrations', needsKey: true },
  homeAssistant: { icon: '⌂', label: 'Smart home', description: 'Home Assistant entities — toggle, status', multiInstance: false, category: 'integrations', needsKey: true },
  scratchpad: { icon: '✎', label: 'Scratchpad', description: 'Free-form notes that persist per tile', multiInstance: true, category: 'productivity' },
  onThisDay: { icon: '◴', label: 'On this day', description: 'Wikipedia events / births / deaths from history', multiInstance: false, category: 'ambient' },
  randomWiki: { icon: '⁂', label: 'Random Wikipedia', description: 'Refreshes hourly — ambient learning engine', multiInstance: false, category: 'ambient' },
  iss: { icon: '◉', label: 'ISS · live', description: 'International Space Station position + map dot', multiInstance: false, category: 'ambient' },
  launches: { icon: '△', label: 'Space launches', description: 'Upcoming rocket launches with countdown', multiInstance: false, category: 'ambient' },
  pollen: { icon: '❋', label: 'Pollen & smoke', description: 'Pollen counts (grass, ragweed, …) + wildfire PM2.5', multiInstance: false, category: 'weather' },
  birds: { icon: '◔', label: 'Recent birds', description: 'eBird observations near you (needs free key)', multiInstance: false, category: 'weather', needsKey: true },
  solarFlare: { icon: '✹', label: 'Sun · X-ray', description: 'NOAA flare class + live SDO sun image', multiInstance: false, category: 'weather' },
  lightning: { icon: '↯', label: 'Lightning · live', description: 'Real-time strikes within 800 km via Blitzortung', multiInstance: false, category: 'weather' },
  aircraft: { icon: '✈', label: 'Aircraft overhead', description: 'Live planes within 80 km via OpenSky Network', multiInstance: false, category: 'weather' },
  activeWindow: { icon: '▢', label: 'Active windows', description: 'Time spent per app today', multiInstance: false, category: 'system' },
  docker: { icon: '◫', label: 'Docker', description: 'Local container list + running state', multiInstance: false, category: 'system' },
  energy: { icon: '⌁', label: 'Energy', description: 'Solar production + grid consumption from HA', multiInstance: false, category: 'system', needsKey: true },
};

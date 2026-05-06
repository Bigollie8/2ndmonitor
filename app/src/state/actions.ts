import { mediaControls, discordVoice } from './tauri';
import { VIZ_STYLES } from '../components/viz-gallery';
import type { VizMode } from '../types';

/** A single action a Stream Deck button can trigger. v1 ships 7 kinds, all
 *  wired through existing app callbacks or existing Tauri commands — no
 *  new backend commands are introduced. */
export type ActionConfig =
  | { kind: 'cycleViz' }
  | { kind: 'switchProfile'; profileId: string }
  | { kind: 'spotifyPlayPause' }
  | { kind: 'spotifyNext' }
  | { kind: 'spotifyPrev' }
  | { kind: 'discordMute' }      // v1: SETS mute=true (not a toggle)
  | { kind: 'discordDeafen' };   // v1: SETS deaf=true

/** Default icon per action kind. The action picker pre-fills the icon field
 *  with these when the user changes action kind. User can override. */
export const DEFAULT_ICONS: Record<ActionConfig['kind'], string> = {
  cycleViz: '◢',
  switchProfile: '▦',
  spotifyPlayPause: '⏯',
  spotifyNext: '⏭',
  spotifyPrev: '⏮',
  discordMute: '🎤',
  discordDeafen: '🔇',
};

/** Context passed to the executor — provides the React-state callbacks for
 *  app-internal actions. Tauri-side actions (Spotify, Discord) are reached
 *  via module-level imports (`mediaControls`, `discordVoice`). */
export interface ActionContext {
  vizMode: VizMode;
  setVizMode: (mode: VizMode) => void;
  setActiveProfileId: (profileId: string) => void;
}

/** Execute a Stream Deck action. Errors from Tauri invokes are swallowed and
 *  logged — buttons should never throw to the React render tree. */
export async function executeAction(action: ActionConfig, ctx: ActionContext): Promise<void> {
  try {
    switch (action.kind) {
      case 'cycleViz': {
        const ids = VIZ_STYLES.map((s) => s.id);
        const i = ids.indexOf(ctx.vizMode);
        ctx.setVizMode(ids[(i + 1) % ids.length] ?? 'bars');
        return;
      }
      case 'switchProfile':
        ctx.setActiveProfileId(action.profileId);
        return;
      case 'spotifyPlayPause':
        await mediaControls.togglePlayPause();
        return;
      case 'spotifyNext':
        await mediaControls.next();
        return;
      case 'spotifyPrev':
        await mediaControls.previous();
        return;
      case 'discordMute':
        await discordVoice.setMute(true);
        return;
      case 'discordDeafen':
        await discordVoice.setDeaf(true);
        return;
    }
  } catch (err) {
    console.warn(`executeAction(${action.kind}) failed`, err);
  }
}

export interface StreamDeckButton {
  /** Stable UUID; React key. */
  buttonId: string;
  /** Emoji or single character (1–4 chars). */
  icon: string;
  /** Optional caption (max 24 chars). */
  label?: string;
  /** Optional hex override (#RRGGBB). Empty/undefined falls back to tile accent. */
  color?: string;
  action: ActionConfig;
}

export interface StreamDeckConfig {
  /** Buttons in render order (left-to-right, top-to-bottom). Position = array index. */
  buttons: StreamDeckButton[];
  /** Grid columns, 1–8. */
  cols: number;
  /** Grid rows, 1–8. */
  rows: number;
}

export const DEFAULT_STREAMDECK_CONFIG: StreamDeckConfig = {
  buttons: [],
  cols: 4,
  rows: 2,
};

const VALID_KINDS: Set<ActionConfig['kind']> = new Set([
  'cycleViz', 'switchProfile',
  'spotifyPlayPause', 'spotifyNext', 'spotifyPrev',
  'discordMute', 'discordDeafen',
]);

function parseAction(raw: unknown): ActionConfig | null {
  if (!raw || typeof raw !== 'object') return null;
  const a = raw as Record<string, unknown>;
  if (typeof a.kind !== 'string' || !VALID_KINDS.has(a.kind as ActionConfig['kind'])) return null;
  if (a.kind === 'switchProfile') {
    if (typeof a.profileId !== 'string' || !a.profileId) return null;
    return { kind: 'switchProfile', profileId: a.profileId };
  }
  return { kind: a.kind as Exclude<ActionConfig['kind'], 'switchProfile'> };
}

function parseButton(raw: unknown): StreamDeckButton | null {
  if (!raw || typeof raw !== 'object') return null;
  const b = raw as Record<string, unknown>;
  if (typeof b.buttonId !== 'string' || !b.buttonId) return null;
  if (typeof b.icon !== 'string' || !b.icon) return null;
  const action = parseAction(b.action);
  if (!action) return null;
  const button: StreamDeckButton = { buttonId: b.buttonId, icon: b.icon, action };
  if (typeof b.label === 'string') button.label = b.label;
  if (typeof b.color === 'string') button.color = b.color;
  return button;
}

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

/** Type-safe parse of an `instance.config` blob into `StreamDeckConfig`.
 *  Falls back to `DEFAULT_STREAMDECK_CONFIG` on any malformed input.
 *  Each button is validated independently — invalid ones are dropped. */
export function parseStreamDeckConfig(raw: unknown): StreamDeckConfig {
  if (!raw || typeof raw !== 'object') return DEFAULT_STREAMDECK_CONFIG;
  const c = raw as Record<string, unknown>;
  if (!Array.isArray(c.buttons)) return DEFAULT_STREAMDECK_CONFIG;

  const buttons: StreamDeckButton[] = [];
  for (const btn of c.buttons) {
    const parsed = parseButton(btn);
    if (parsed) buttons.push(parsed);
  }

  const cols = typeof c.cols === 'number' && Number.isFinite(c.cols) ? clamp(Math.round(c.cols), 1, 8) : DEFAULT_STREAMDECK_CONFIG.cols;
  const rows = typeof c.rows === 'number' && Number.isFinite(c.rows) ? clamp(Math.round(c.rows), 1, 8) : DEFAULT_STREAMDECK_CONFIG.rows;

  return { buttons, cols, rows };
}

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

import { HFTile } from './tiles';
import { TileNeedsSetup } from './tileStates';
import type { Density } from '../types';

export interface MissingTileCardProps {
  /** The bundle id a `bundle:<id>` instance points at — shown as the tile
   *  title so the user can tell which tile is missing without opening edit
   *  mode. */
  bundleId: string;
  density: Density;
  accent: string;
  /** Opens the Tile Library with its Marketplace tab active. */
  onOpenMarketplace: () => void;
}

/** Rendered in place of a `bundle:<id>` tile instance whose bundle is not in
 *  the (loaded) tile catalog — uninstalled, removed, or a layout carried over
 *  from another machine that doesn't have it. Deliberately keeps the
 *  instance's slot on the canvas instead of dropping or reflowing it: the
 *  user's arrangement must survive until they explicitly remove the tile, the
 *  same way a `TileError` never removes itself. Reuses `HFTile` +
 *  `TileNeedsSetup` so it sits in the dashboard looking like any other tile
 *  waiting to be connected, not like an error. */
export function MissingTileCard({ bundleId, density, accent, onOpenMarketplace }: MissingTileCardProps) {
  return (
    <HFTile title={bundleId} accent={accent} density={density} style={{ height: '100%' }}>
      <TileNeedsSetup
        accent={accent}
        line={`"${bundleId}" isn't installed. Get it from the Marketplace to bring this tile back.`}
        buttonLabel="Open Marketplace →"
        onSetup={onOpenMarketplace}
      />
    </HFTile>
  );
}

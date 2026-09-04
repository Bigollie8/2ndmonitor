import type { TileInstance, BuiltinTileType } from './layout';
import { TILE_META } from './tileMeta';

export function setupRequirements(tiles: TileInstance[], available: string[] | null) {
  const types = [...new Set(tiles.map(t => t.type))];
  const bundles = types.filter(t => t.startsWith('bundle:')).map(type => ({
    id: type.slice(7), available: available === null ? null : available.includes(type),
  }));
  const connections = types.flatMap(type => {
    const meta = TILE_META[type as BuiltinTileType];
    return meta && (meta.needsKey || meta.account || type === 'claude' || type === 'docker' || type === 'streamChat' || type === 'musicQueue') ? [meta.label] : [];
  });
  const unknown = types.filter(type => !type.startsWith('bundle:') && !Object.prototype.hasOwnProperty.call(TILE_META, type));
  return { bundles, connections, unknown };
}

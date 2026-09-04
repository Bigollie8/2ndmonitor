import type { TileInstance } from '../state/layout';
import { setupRequirements } from '../state/setupRequirements';

export function SetupPreview({ tiles, orientation, available }: {
  tiles: TileInstance[]; orientation: 'landscape' | 'portrait'; available: string[] | null;
}) {
  const needs = setupRequirements(tiles, available);
  return <div style={{ fontSize: 12 }}>
    <svg aria-label={`${orientation} layout preview with ${tiles.length} tiles`} role="img" viewBox={orientation === 'portrait' ? '0 0 180 320' : '0 0 320 180'} style={{ display: 'block', width: '100%', maxHeight: 180, background: '#06070a' }}>
      {tiles.map(tile => <rect key={tile.instanceId} x={tile.rect.x * (orientation === 'portrait' ? 180 : 320)} y={tile.rect.y * (orientation === 'portrait' ? 320 : 180)} width={tile.rect.w * (orientation === 'portrait' ? 180 : 320)} height={tile.rect.h * (orientation === 'portrait' ? 320 : 180)} fill="#a78bfa33" stroke="#a78bfa" rx="2"><title>{tile.name ?? tile.type}</title></rect>)}
    </svg>
    <p>{tiles.length} tiles · {orientation}</p>
    {needs.bundles.map(b => <div key={b.id}>Bundle {b.id}: {b.available === null ? 'checking library' : b.available ? 'available' : 'install or restore from Content library / Market'}</div>)}
    {needs.connections.length > 0 && <p>Uses connections: {needs.connections.join(', ')}. Configure these on your own device if needed.</p>}
    {needs.unknown.length > 0 && <p>Unrecognized tiles: {needs.unknown.join(', ')}. These will show a missing-tile card.</p>}
    <p>Imports do not install bundles or connect accounts. Shared exports include the arrangement and selected display options; personal content, locations, account credentials and bundle configuration are omitted.</p>
  </div>;
}

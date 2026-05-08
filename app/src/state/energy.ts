/** Energy tile config — pulls solar + grid power from Home Assistant entities.
 *  Reuses the URL/token from the Home Assistant tile so users don't have to
 *  re-enter credentials. */

export interface EnergyConfig {
  solarEntity: string;
  gridEntity: string;
}

export const DEFAULT_ENERGY_CONFIG: EnergyConfig = {
  solarEntity: '',
  gridEntity: '',
};

export function parseEnergyConfig(raw: unknown): EnergyConfig {
  if (!raw || typeof raw !== 'object') return DEFAULT_ENERGY_CONFIG;
  const c = raw as Record<string, unknown>;
  return {
    solarEntity: typeof c.solarEntity === 'string' ? c.solarEntity.trim().slice(0, 128) : '',
    gridEntity: typeof c.gridEntity === 'string' ? c.gridEntity.trim().slice(0, 128) : '',
  };
}

/** Read-numeric helper. HA returns state as a string even for numeric sensors;
 *  unavailable/unknown entities return non-numeric strings we filter out. */
export function parseEntityNumber(state: string | null | undefined): number | null {
  if (!state) return null;
  const n = Number(state);
  return Number.isFinite(n) ? n : null;
}

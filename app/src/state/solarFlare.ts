/** NOAA Space Weather Prediction Center — current GOES X-ray flux.
 *  Endpoint: https://services.swpc.noaa.gov/json/goes/primary/xrays-1-day.json
 *  Public, key-less, CORS friendly.
 *
 *  X-ray flux is reported in W/m² in two energy bands. We surface the
 *  long-band ("0.1-0.8 nm") current value and translate to flare class:
 *    < 1e-7  : A (quiet)
 *    < 1e-6  : B
 *    < 1e-5  : C (minor)
 *    < 1e-4  : M (moderate)
 *    >= 1e-4 : X (extreme) */

export interface SolarXrayReading {
  flux: number;          // W/m² long-band
  className: string;     // "A1.2", "B5.6", "C3.4", "M2.0", "X1.0"
  classLetter: 'A' | 'B' | 'C' | 'M' | 'X';
  observedAt: string;    // ISO timestamp from NOAA
}

interface RawXrayPoint {
  time_tag?: string;
  energy?: string;       // "0.05-0.4nm" or "0.1-0.8nm"
  flux?: number;
  satellite?: number;
}

export async function fetchSolarXray(): Promise<SolarXrayReading | null> {
  try {
    const res = await fetch('https://services.swpc.noaa.gov/json/goes/primary/xrays-1-day.json');
    if (!res.ok) return null;
    const data: unknown = await res.json();
    if (!Array.isArray(data) || data.length === 0) return null;
    // Walk backwards through the series — last entry is the freshest. We want
    // the long-band ("0.1-0.8nm") channel.
    for (let i = data.length - 1; i >= 0; i--) {
      const p = data[i] as RawXrayPoint;
      if (p.energy === '0.1-0.8nm' && typeof p.flux === 'number' && Number.isFinite(p.flux)) {
        return {
          flux: p.flux,
          className: classifyFlare(p.flux),
          classLetter: flareLetter(p.flux),
          observedAt: p.time_tag ?? '',
        };
      }
    }
    return null;
  } catch (err) {
    console.warn('xray fetch failed', err);
    return null;
  }
}

function flareLetter(flux: number): SolarXrayReading['classLetter'] {
  if (flux >= 1e-4) return 'X';
  if (flux >= 1e-5) return 'M';
  if (flux >= 1e-6) return 'C';
  if (flux >= 1e-7) return 'B';
  return 'A';
}

function classifyFlare(flux: number): string {
  const letter = flareLetter(flux);
  const exp = letter === 'X' ? -4
    : letter === 'M' ? -5
    : letter === 'C' ? -6
    : letter === 'B' ? -7 : -8;
  const mantissa = flux / Math.pow(10, exp);
  return `${letter}${mantissa.toFixed(1)}`;
}

export interface FlareSeverity {
  label: string;
  color: string;
}

export function flareSeverity(letter: SolarXrayReading['classLetter']): FlareSeverity {
  switch (letter) {
    case 'A': return { label: 'quiet',    color: 'rgba(255,255,255,0.5)' };
    case 'B': return { label: 'low',      color: '#22c55e' };
    case 'C': return { label: 'minor',    color: '#facc15' };
    case 'M': return { label: 'moderate', color: '#fb923c' };
    case 'X': return { label: 'extreme',  color: '#ef4444' };
  }
}

/** SDO live image — AIA 304Å (chromosphere/transition region — shows
 *  prominences and filaments). 512x512 JPEG, updated every minute. */
export const SUN_IMAGE_URL = 'https://sdo.gsfc.nasa.gov/assets/img/latest/latest_512_0304.jpg';

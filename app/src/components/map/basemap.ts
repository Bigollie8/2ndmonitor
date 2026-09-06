/** The keyless dark raster basemap every map tile draws under its data.
 *
 *  0.9.18: CARTO's `basemaps.cartocdn.com/dark_all` — keyless since the
 *  first map tile shipped — started answering every uncached tile with HTTP
 *  200 and an "API KEY REQUIRED" watermark image (verified 2026-09-06: tiles
 *  still in CARTO's CDN cache came back as real map, fresh ones came back as
 *  the watermark). A 200 with a picture of an error is invisible to
 *  `img.onerror`, so the map just showed the watermark. The project's rule
 *  is keyless providers only (weather.rs, adsb.lol, RainViewer), so the
 *  answer is a different keyless provider rather than an API key.
 *
 *  Esri's World Dark Gray Base canvas is served without a key from
 *  services.arcgisonline.com, in the same 256px z/x/y slippy grid (note the
 *  z/Y/X path order — ArcGIS puts the row first), with CORS `*` so the canvas
 *  stays untainted for compositing. It carries data to z16; the map tiles all
 *  cap their view zoom at 12 or below, and slippy.ts scales the deepest tile
 *  past MAX_TILE_Z anyway.
 *
 *  Pure — the URL builder and the attribution string are unit-tested, and the
 *  provider swap is one place. */

/** Slippy tile URL for the basemap. `z/y/x` in the path, deliberately. */
export function baseTileUrl(z: number, x: number, y: number): string {
  return `https://services.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/${z}/${y}/${x}`;
}

/** Esri's basemap terms want "Powered by Esri" plus the service's own
 *  copyrightText ("Esri, HERE, Garmin, (c) OpenStreetMap contributors, and
 *  the GIS user community" as the MapServer reports it). Kept as one string
 *  so the always-visible credit in MapView cannot drift from the provider. */
export const BASEMAP_ATTRIBUTION =
  'Powered by Esri — Esri, HERE, Garmin, © OpenStreetMap contributors, and the GIS user community';

/** Deepest zoom the provider has real tiles for. Past this the base is
 *  scaled by slippy.ts, never requested. */
export const BASEMAP_MAX_Z = 16;

/** Esri's canvas is a mid-gray (#3a3a3a land) where CARTO's dark_all was
 *  near black. The tiles are dimmed toward MAP_BG after they are painted so
 *  the maps keep the app's dark look and radar / aircraft / lightning
 *  overlays keep their contrast. One fillRect per repaint; repaints are
 *  already rAF-coalesced and idle maps do not repaint at all (0.7.3). */
export const BASEMAP_DIM = 'rgba(11,13,16,0.42)';

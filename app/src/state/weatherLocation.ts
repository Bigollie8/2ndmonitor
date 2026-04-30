import type { WeatherLocation } from '../types';

export interface GeocodeResult {
  label: string;
  lat: number;
  lon: number;
  detail: string; // e.g. "Texas, US"
}

interface OpenMeteoGeoItem {
  name: string;
  latitude: number;
  longitude: number;
  country?: string;
  admin1?: string;
}
interface OpenMeteoGeoResp { results?: OpenMeteoGeoItem[] }

export async function geocode(query: string): Promise<GeocodeResult[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=5&language=en&format=json`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`geocode HTTP ${r.status}`);
  const data: OpenMeteoGeoResp = await r.json();
  return (data.results ?? []).map((it) => ({
    label: `${it.name}${it.admin1 ? ', ' + it.admin1 : ''}${it.country ? ', ' + it.country : ''}`,
    lat: it.latitude,
    lon: it.longitude,
    detail: [it.admin1, it.country].filter(Boolean).join(', '),
  }));
}

const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

export async function pushLocationToRust(loc: WeatherLocation): Promise<void> {
  if (!isTauri) return;
  const { invoke } = await import('@tauri-apps/api/core');
  await invoke('set_weather_location', { label: loc.label, lat: loc.lat, lon: loc.lon });
}

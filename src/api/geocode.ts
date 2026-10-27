import type { LatLon } from '../types';
import { getJson } from './http';

const PHOTON = 'https://photon.komoot.io';

export interface Place extends LatLon {
  label: string;
  detail: string;
}

interface PhotonFeature {
  geometry: { coordinates: [number, number] };
  properties: Record<string, string | undefined>;
}

function toPlace(f: PhotonFeature): Place {
  const p = f.properties;
  const street = [p.housenumber, p.street].filter(Boolean).join(' ');
  const name = p.name ?? street ?? '';
  const city = [p.postcode, p.city ?? p.town ?? p.village].filter(Boolean).join(' ');
  const label = [name || street, city && city !== name ? city : ''].filter(Boolean).join(', ');
  const detail = [street && street !== name ? street : '', p.state, p.country].filter(Boolean).join(', ');
  return {
    lat: f.geometry.coordinates[1],
    lon: f.geometry.coordinates[0],
    label: label || 'Lieu sans nom',
    detail,
  };
}

/** Suggestions d'adresses (Photon, données OpenStreetMap). */
export async function searchPlaces(query: string, bias?: LatLon, signal?: AbortSignal): Promise<Place[]> {
  const coords = parseCoords(query);
  if (coords) return [{ ...coords, label: `${coords.lat.toFixed(5)}, ${coords.lon.toFixed(5)}`, detail: 'Coordonnées' }];
  const params = new URLSearchParams({ q: query, limit: '6', lang: 'fr' });
  if (bias) {
    params.set('lat', String(bias.lat));
    params.set('lon', String(bias.lon));
  }
  const data = await getJson<{ features: PhotonFeature[] }>(`${PHOTON}/api/?${params}`, { signal });
  return data.features.map(toPlace);
}

export async function reverseGeocode(p: LatLon): Promise<string> {
  try {
    const data = await getJson<{ features: PhotonFeature[] }>(
      `${PHOTON}/reverse?lat=${p.lat}&lon=${p.lon}&lang=fr&limit=1`,
      {},
      8000,
    );
    if (data.features[0]) return toPlace(data.features[0]).label;
  } catch {
    /* on retombe sur les coordonnées */
  }
  return `${p.lat.toFixed(5)}, ${p.lon.toFixed(5)}`;
}

/** Accepte « 48.8566, 2.3522 » ou « 48.8566 2.3522 ». */
export function parseCoords(text: string): LatLon | null {
  const m = text.trim().match(/^(-?\d{1,2}(?:\.\d+)?)\s*[,; ]\s*(-?\d{1,3}(?:\.\d+)?)$/);
  if (!m) return null;
  const lat = Number(m[1]);
  const lon = Number(m[2]);
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lat, lon };
}

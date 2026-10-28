import { kindLabel } from '../categories';
import type { Category, LatLon, Poi } from '../types';

const SERVERS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
];

interface Element {
  type: string;
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

/** Zone de recherche : un cercle, ou un polygone (la zone équitable). */
export type Area = { center: LatLon; radius: number } | { polygon: LatLon[] };

function areaFilter(area: Area): string {
  if ('polygon' in area) return `(poly:"${area.polygon.map((p) => `${p.lat.toFixed(5)} ${p.lon.toFixed(5)}`).join(' ')}")`;
  return `(around:${Math.round(area.radius)},${area.center.lat.toFixed(6)},${area.center.lon.toFixed(6)})`;
}

export function buildQuery(category: Category, area: Area, limit = 80): string {
  const filter = areaFilter(area);
  const parts = category.filters.map((f) => `nwr${f}["name"]${filter};`).join('');
  return `[out:json][timeout:25];(${parts});out center tags ${limit};`;
}

/** Lieux OpenStreetMap de la catégorie dans la zone donnée. */
export async function findPois(category: Category, area: Area, limit = 80): Promise<Poi[]> {
  const body = new URLSearchParams({ data: buildQuery(category, area, limit) });
  let lastErr: unknown;
  for (const url of SERVERS) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 30000);
    try {
      const res = await fetch(url, { method: 'POST', body, signal: ctrl.signal });
      if (!res.ok) throw new Error(`${new URL(url).host} a répondu ${res.status}`);
      const data = (await res.json()) as { elements: Element[] };
      return parse(data.elements);
    } catch (e) {
      lastErr = e;
      console.warn('Overpass :', e);
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error(`Recherche de lieux impossible (${lastErr instanceof Error ? lastErr.message : lastErr})`);
}

export function parse(elements: Element[]): Poi[] {
  const seen = new Set<string>();
  const out: Poi[] = [];
  for (const el of elements) {
    const lat = el.lat ?? el.center?.lat;
    const lon = el.lon ?? el.center?.lon;
    const tags = el.tags ?? {};
    if (lat == null || lon == null || !tags.name) continue;
    // Un même lieu est parfois cartographié deux fois (point + bâtiment).
    const key = `${tags.name.toLowerCase()}|${lat.toFixed(3)}|${lon.toFixed(3)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ id: `${el.type}/${el.id}`, lat, lon, name: tags.name, kind: kindLabel(tags), tags });
  }
  return out;
}

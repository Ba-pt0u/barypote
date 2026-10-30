import { kindLabel } from '../categories';
import type { Category, Poi } from '../types';
import type { Area } from './overpass';
import { getJson } from './http';

/**
 * Lieux via Geoapify Places (données OpenStreetMap, infrastructure commerciale).
 * Les requêtes passent par le serveur de l'appli, qui ajoute la clé : elle n'est jamais exposée au navigateur.
 */
const PROXY = './api/geoapify/places';

interface Feature {
  properties: {
    name?: string;
    lat: number;
    lon: number;
    place_id: string;
    categories?: string[];
    datasource?: { raw?: Record<string, string | number> };
  };
}

const OSM_TYPES: Record<string, string> = { n: 'node', w: 'way', r: 'relation', node: 'node', way: 'way', relation: 'relation' };

export function buildUrl(category: Category, area: Area, limit: number): string {
  const filter =
    'bbox' in area
      ? `rect:${area.bbox[1]},${area.bbox[0]},${area.bbox[3]},${area.bbox[2]}`
      : `circle:${area.center.lon},${area.center.lat},${Math.round(area.radius)}`;
  const params = new URLSearchParams({
    categories: category.geoapify.join(','),
    filter,
    limit: String(Math.min(limit, 500)),
    lang: 'fr',
  });
  if (!('bbox' in area)) params.set('bias', `proximity:${area.center.lon},${area.center.lat}`);
  return `${PROXY}?${params}`;
}

export function parseFeatures(features: Feature[]): Poi[] {
  const out: Poi[] = [];
  for (const { properties: p } of features) {
    if (!p.name) continue;
    const raw = p.datasource?.raw ?? {};
    const tags: Record<string, string> = {};
    for (const [k, v] of Object.entries(raw)) if (typeof v === 'string' || typeof v === 'number') tags[k] = String(v);
    tags.name ??= p.name;
    const osmType = OSM_TYPES[String(raw.osm_type ?? '')];
    const id = osmType && raw.osm_id ? `${osmType}/${raw.osm_id}` : `geoapify/${p.place_id}`;
    const kind = kindLabel(tags) || (p.categories?.[0]?.split('.').pop()?.replace(/_/g, ' ') ?? '');
    out.push({ id, lat: p.lat, lon: p.lon, name: p.name, kind, tags });
  }
  return out;
}

export async function findPoisGeoapify(category: Category, areas: { area: Area; limit: number }[]): Promise<Poi[]> {
  const lists = await Promise.all(
    areas.map(async ({ area, limit }) => {
      const data = await getJson<{ features: Feature[] }>(buildUrl(category, area, limit), {}, 20000);
      return parseFeatures(data.features ?? []);
    }),
  );
  return lists.flat();
}

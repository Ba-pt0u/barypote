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

/**
 * Zone de recherche : un cercle, ou un rectangle (s, w, n, e). Les filtres par polygone d'Overpass
 * sont lents sur de grandes zones : on interroge le rectangle englobant et on filtre ensuite côté navigateur.
 */
export type Area = { center: LatLon; radius: number } | { bbox: [number, number, number, number] };

function areaFilter(area: Area): string {
  if ('bbox' in area) return `(${area.bbox.map((v) => v.toFixed(5)).join(',')})`;
  return `(around:${Math.round(area.radius)},${area.center.lat.toFixed(6)},${area.center.lon.toFixed(6)})`;
}

/**
 * Une seule requête pour plusieurs zones (une sortie par zone, chacune avec sa limite) :
 * les serveurs publics n'accordent que deux requêtes simultanées par adresse IP.
 */
export function buildQuery(category: Category, areas: { area: Area; limit: number }[]): string {
  const blocks = areas.map(({ area, limit }) => {
    const filter = areaFilter(area);
    const parts = category.filters.map((f) => `nwr${f}["name"]${filter};`).join('');
    // « qt » : sortie non triée, plus rapide pour le serveur.
    return `(${parts});out center tags qt ${limit};`;
  });
  return `[out:json][timeout:20];${blocks.join('')}`;
}

/** Lieux OpenStreetMap de la catégorie dans les zones données, en essayant plusieurs serveurs. */
export async function findPoisOverpass(category: Category, areas: { area: Area; limit: number }[]): Promise<Poi[]> {
  const body = new URLSearchParams({ data: buildQuery(category, areas) }).toString();
  const failures: string[] = [];
  for (const url of SERVERS) {
    const host = new URL(url).host;
    // Une seconde chance après une courte pause si le serveur est simplement saturé (429).
    for (let attempt = 0; attempt < 2; attempt++) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 25000);
      try {
        const res = await fetch(url, {
          method: 'POST',
          body,
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          signal: ctrl.signal,
        });
        if (res.status === 429 && attempt === 0) {
          await new Promise((r) => setTimeout(r, 2000));
          continue;
        }
        if (!res.ok) throw new Error(`erreur ${res.status}`);
        const data = (await res.json()) as { elements: Element[] };
        return parse(data.elements);
      } catch (e) {
        const msg = ctrl.signal.aborted ? 'délai dépassé' : e instanceof Error ? e.message : String(e);
        failures.push(`${host} : ${msg}`);
        console.warn('Overpass', host, e);
        break;
      } finally {
        clearTimeout(timer);
      }
    }
  }
  throw new Error(`Recherche de lieux impossible, serveurs OpenStreetMap indisponibles (${failures.join(' ; ')})`);
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

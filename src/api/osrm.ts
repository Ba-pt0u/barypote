import { haversine } from '../geo';
import type { LatLon, Mode, Route } from '../types';
import { getJson } from './http';

type RoadMode = Exclude<Mode, 'transit'>;

/** Serveurs OSRM publics (FOSSGIS en priorité, démo OSRM en secours pour la voiture). */
const SERVERS: Record<RoadMode, string[]> = {
  car: ['https://routing.openstreetmap.de/routed-car', 'https://router.project-osrm.org'],
  bike: ['https://routing.openstreetmap.de/routed-bike'],
  foot: ['https://routing.openstreetmap.de/routed-foot'],
};

/** Vitesses utilisées quand aucun serveur ne répond (km/h, après détour). */
const FALLBACK_KMH: Record<RoadMode, number> = { car: 35, bike: 15, foot: 4.8 };
const DETOUR = 1.35;
/** Au-delà de cette distance de « raccrochage » au réseau, le point est jugé inaccessible. */
const MAX_SNAP_M = 1500;
const WALK_M_PER_MIN = 80;
/** Nombre maximal de coordonnées par requête /table. */
const MAX_TABLE = 90;

const fmt = (p: LatLon) => `${p.lon.toFixed(6)},${p.lat.toFixed(6)}`;

export function estimateMinutes(mode: RoadMode, from: LatLon, to: LatLon): number {
  return ((haversine(from, to) * DETOUR) / 1000 / FALLBACK_KMH[mode]) * 60;
}

interface TableResponse {
  code: string;
  durations?: (number | null)[][];
  destinations?: { distance?: number }[];
}

export interface Matrix {
  /** minutes[i][j] : du départ i à la destination j. */
  minutes: number[][];
  estimated: boolean;
}

/**
 * Matrice des temps de trajet (minutes) des `sources` vers les `destinations`.
 * Si aucun serveur ne répond, renvoie une estimation à vol d'oiseau (`estimated: true`).
 */
export async function travelMatrix(mode: RoadMode, sources: LatLon[], destinations: LatLon[]): Promise<Matrix> {
  const chunkSize = MAX_TABLE - sources.length;
  const minutes: number[][] = sources.map(() => []);
  let estimated = false;
  for (let start = 0; start < destinations.length; start += chunkSize) {
    const chunk = destinations.slice(start, start + chunkSize);
    let part: number[][] | null = null;
    for (const server of SERVERS[mode]) {
      try {
        part = await tableChunk(server, sources, chunk);
        break;
      } catch (e) {
        console.warn(`OSRM ${server} :`, e);
      }
    }
    if (!part) {
      estimated = true;
      part = sources.map((s) => chunk.map((d) => estimateMinutes(mode, s, d)));
    }
    part.forEach((row, i) => minutes[i].push(...row));
  }
  return { minutes, estimated };
}

async function tableChunk(server: string, sources: LatLon[], destinations: LatLon[]): Promise<number[][]> {
  const coords = [...sources, ...destinations].map(fmt).join(';');
  const src = sources.map((_, i) => i).join(';');
  const dst = destinations.map((_, j) => j + sources.length).join(';');
  const url = `${server}/table/v1/driving/${coords}?sources=${src}&destinations=${dst}&annotations=duration`;
  const data = await getJson<TableResponse>(url);
  if (data.code !== 'Ok' || !data.durations) throw new Error(`OSRM: ${data.code}`);
  return data.durations.map((row) =>
    row.map((sec, j) => {
      if (sec == null) return Infinity;
      // OSRM raccroche chaque point à la route la plus proche : on ajoute la marche jusqu'au point.
      const snap = data.destinations?.[j]?.distance ?? 0;
      if (snap > MAX_SNAP_M) return Infinity;
      return sec / 60 + snap / WALK_M_PER_MIN;
    }),
  );
}

interface RouteResponse {
  code: string;
  routes?: { duration: number; distance: number; geometry: { coordinates: [number, number][] } }[];
}

const LABELS: Record<RoadMode, string> = { car: 'Voiture', bike: 'Vélo', foot: 'À pied' };

export async function route(mode: RoadMode, from: LatLon, to: LatLon): Promise<Route> {
  for (const server of SERVERS[mode]) {
    try {
      const url = `${server}/route/v1/driving/${fmt(from)};${fmt(to)}?overview=full&geometries=geojson`;
      const data = await getJson<RouteResponse>(url);
      const r = data.routes?.[0];
      if (data.code !== 'Ok' || !r) continue;
      const coords = r.geometry.coordinates.map(([lon, lat]) => [lat, lon] as [number, number]);
      const minutes = r.duration / 60;
      const km = (r.distance / 1000).toFixed(r.distance < 10000 ? 1 : 0).replace('.', ',');
      return {
        minutes,
        coords,
        legs: [{ mode, label: LABELS[mode], minutes, coords }],
        summary: `${LABELS[mode]} · ${km} km`,
      };
    } catch (e) {
      console.warn(`OSRM route ${server} :`, e);
    }
  }
  const minutes = estimateMinutes(mode, from, to);
  const coords: [number, number][] = [
    [from.lat, from.lon],
    [to.lat, to.lon],
  ];
  return { minutes, coords, legs: [{ mode, label: LABELS[mode], minutes, coords }], summary: `${LABELS[mode]} · estimation` };
}

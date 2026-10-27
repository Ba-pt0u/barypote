import { decodePolylineNear, haversine } from '../geo';
import type { LatLon, Route, RouteLeg } from '../types';
import { getJson, HttpError } from './http';

/**
 * Transports en commun via Transitous (https://transitous.org), service communautaire
 * de calcul d'itinéraires basé sur MOTIS, qui agrège les données GTFS ouvertes (dont la France).
 */
const API = 'https://api.transitous.org/api';
/** Versions d'API essayées dans l'ordre ; la première qui répond est mémorisée. */
const VERSIONS = ['v1', 'v2', 'v3', 'v4', 'v5'];
const working: Record<string, string> = {};

const WALK_M_PER_MIN = 75;
const WALK_DETOUR = 1.25;
/** Distance maximale à pied entre un arrêt et un lieu. */
const MAX_LAST_MILE_M = 1200;
/** En dessous de cette distance, on peut aussi y aller entièrement à pied. */
const MAX_DIRECT_WALK_M = 2500;

const place = (p: LatLon) => `${p.lat.toFixed(6)},${p.lon.toFixed(6)}`;

async function call<T>(endpoint: string, params: URLSearchParams): Promise<T> {
  const versions = working[endpoint] ? [working[endpoint]] : VERSIONS;
  let lastErr: unknown;
  for (const v of versions) {
    try {
      const data = await getJson<T>(`${API}/${v}/${endpoint}?${params}`, {}, 30000);
      working[endpoint] = v;
      return data;
    } catch (e) {
      lastErr = e;
      // Seule une route inconnue justifie d'essayer une autre version de l'API.
      if (!(e instanceof HttpError && (e.status === 404 || e.status === 410))) throw e;
    }
  }
  throw lastErr;
}

export const walkMinutes = (a: LatLon, b: LatLon) => (haversine(a, b) * WALK_DETOUR) / WALK_M_PER_MIN;

interface MotisPlace {
  name?: string;
  stopId?: string;
  lat: number;
  lon: number;
}

export interface ReachableStop extends LatLon {
  name: string;
  minutes: number;
}

/**
 * Ensemble des arrêts atteignables depuis `from` en transports en commun, avec le temps
 * le plus court pour chacun (requête « one-to-all » de MOTIS : un seul appel par personne).
 */
export async function reachableStops(from: LatLon, departure: Date, maxMinutes: number): Promise<ReachableStop[]> {
  const params = new URLSearchParams({
    one: place(from),
    time: departure.toISOString(),
    maxTravelTime: String(Math.round(maxMinutes)),
    arriveBy: 'false',
  });
  const data = await call<{ all?: { place: MotisPlace; duration: number }[] }>('one-to-all', params);
  const all = (data.all ?? []).filter((r) => r.place && Number.isFinite(r.duration));
  // La durée est documentée en minutes ; si elle dépasse nettement la limite demandée,
  // c'est qu'elle est exprimée en secondes.
  const maxSeen = all.reduce((m, r) => Math.max(m, r.duration), 0);
  const unit = maxSeen > maxMinutes * 1.5 ? 60 : 1;
  return all.map((r) => ({
    lat: r.place.lat,
    lon: r.place.lon,
    name: r.place.name ?? '',
    minutes: r.duration / unit,
  }));
}

/**
 * Accès rapide « temps pour rejoindre ce point » à partir des arrêts atteignables :
 * meilleur arrêt proche + marche, ou marche directe si c'est plus court.
 */
export class TransitReach {
  private buckets = new Map<string, ReachableStop[]>();
  private static CELL = 0.01; // ~1 km

  constructor(
    public readonly origin: LatLon,
    public readonly stops: ReachableStop[],
  ) {
    for (const s of stops) {
      const k = this.key(s.lat, s.lon);
      const b = this.buckets.get(k);
      if (b) b.push(s);
      else this.buckets.set(k, [s]);
    }
  }

  private key(lat: number, lon: number) {
    return `${Math.floor(lat / TransitReach.CELL)}:${Math.floor(lon / TransitReach.CELL)}`;
  }

  minutesTo(p: LatLon): number {
    let best = Infinity;
    const direct = haversine(this.origin, p);
    if (direct <= MAX_DIRECT_WALK_M) best = walkMinutes(this.origin, p);
    const ci = Math.floor(p.lat / TransitReach.CELL);
    const cj = Math.floor(p.lon / TransitReach.CELL);
    for (let di = -2; di <= 2; di++)
      for (let dj = -2; dj <= 2; dj++) {
        const b = this.buckets.get(`${ci + di}:${cj + dj}`);
        if (!b) continue;
        for (const s of b) {
          if (s.minutes >= best) continue;
          const d = haversine(s, p);
          if (d > MAX_LAST_MILE_M) continue;
          best = Math.min(best, s.minutes + (d * WALK_DETOUR) / WALK_M_PER_MIN);
        }
      }
    return best;
  }
}

interface MotisLeg {
  mode: string;
  duration: number;
  from: MotisPlace;
  to: MotisPlace;
  routeShortName?: string;
  headsign?: string;
  legGeometry?: { points: string; precision?: number };
}

interface MotisItinerary {
  duration: number;
  transfers?: number;
  legs: MotisLeg[];
}

const MODE_LABELS: Record<string, string> = {
  WALK: 'Marche',
  BIKE: 'Vélo',
  BUS: 'Bus',
  COACH: 'Car',
  TRAM: 'Tram',
  SUBWAY: 'Métro',
  METRO: 'Métro',
  FERRY: 'Ferry',
  RAIL: 'Train',
  REGIONAL_RAIL: 'TER / RER',
  REGIONAL_FAST_RAIL: 'Train régional',
  HIGHSPEED_RAIL: 'TGV',
  LONG_DISTANCE: 'Grandes lignes',
  NIGHT_RAIL: 'Train de nuit',
  SUBURBAN: 'RER / Transilien',
  FUNICULAR: 'Funiculaire',
  AERIAL_LIFT: 'Téléphérique',
  CABLE_CAR: 'Téléphérique',
};

export function legLabel(mode: string, line?: string): string {
  const base = MODE_LABELS[mode] ?? mode.charAt(0) + mode.slice(1).toLowerCase().replace(/_/g, ' ');
  return line ? `${base} ${line}` : base;
}

/** Itinéraire détaillé en transports en commun. */
export async function planTransit(from: LatLon, to: LatLon, departure: Date): Promise<Route | null> {
  const params = new URLSearchParams({
    fromPlace: place(from),
    toPlace: place(to),
    time: departure.toISOString(),
    arriveBy: 'false',
  });
  const data = await call<{ itineraries?: MotisItinerary[]; direct?: MotisItinerary[] }>('plan', params);
  const options = [...(data.itineraries ?? []), ...(data.direct ?? [])].filter((it) => it.legs?.length);
  if (!options.length) return null;
  const best = options.reduce((a, b) => (b.duration < a.duration ? b : a));
  const legs: RouteLeg[] = best.legs.map((l) => {
    const coords = l.legGeometry?.points
      ? decodePolylineNear(
          l.legGeometry.points,
          l.from,
          l.legGeometry.precision ? [l.legGeometry.precision] : undefined,
        )
      : ([
          [l.from.lat, l.from.lon],
          [l.to.lat, l.to.lon],
        ] as [number, number][]);
    return {
      mode: l.mode,
      label: legLabel(l.mode, l.routeShortName),
      minutes: l.duration / 60,
      coords,
    };
  });
  const transit = legs.filter((l) => l.mode !== 'WALK');
  const transfers = best.transfers ?? Math.max(0, transit.length - 1);
  return {
    minutes: best.duration / 60,
    coords: legs.flatMap((l) => l.coords),
    legs,
    summary: transit.length
      ? `${transit.map((l) => l.label).join(' → ')}${transfers ? ` · ${transfers} correspondance${transfers > 1 ? 's' : ''}` : ''}`
      : 'À pied',
  };
}

import { mapLimit } from './api/http';
import { findPois } from './api/overpass';
import { travelMatrix } from './api/osrm';
import { reachableStops, TransitReach } from './api/transit';
import { centroid, grid, haversine, spread } from './geo';
import { score } from './scoring';
import type { Candidate, LatLon, Mode, Participant, Poi, SearchOptions, SearchResult } from './types';

type Located = Participant & { pos: LatLon };
type Progress = (message: string) => void;

const COARSE = 7;
const FINE = 5;
const MAX_PLACES = 12;
const POI_RADII = [500, 1000, 2000, 4000];
/** Vitesse de repli pour les transports en commun si Transitous ne répond pas. */
const TRANSIT_FALLBACK_KMH = 18;

/** Calcule, pour une liste de points, le temps de trajet de chaque participant. */
export class Evaluator {
  private reach = new Map<number, TransitReach>();
  private transitFallback = new Set<number>();
  readonly warnings: string[] = [];

  constructor(
    readonly people: Located[],
    readonly opts: SearchOptions,
  ) {}

  /** Charge une fois pour toutes les arrêts atteignables par chaque usager des transports. */
  async prepare(progress: Progress) {
    const transit = this.people.map((p, i) => ({ p, i })).filter(({ p }) => p.mode === 'transit');
    await mapLimit(transit, 3, async ({ p, i }) => {
      progress(`Transports en commun depuis chez ${p.name}…`);
      try {
        const stops = await reachableStops(p.pos, this.opts.departure, Math.min(this.opts.maxTime, 120));
        if (!stops.length) throw new Error('aucun arrêt atteignable');
        this.reach.set(i, new TransitReach(p.pos, stops));
      } catch (e) {
        console.warn('Transitous :', e);
        this.transitFallback.add(i);
        this.warnings.push(
          `Transports en commun indisponibles pour ${p.name} : temps estimés à vol d’oiseau.`,
        );
      }
    });
  }

  /** Arrêts atteignables par tous les usagers des transports en commun, candidats naturels. */
  transitStops(): LatLon[] {
    const reaches = [...this.reach.values()];
    if (!reaches.length) return [];
    return reaches[0].stops
      .map((s) => ({ s, t: reaches.map((r) => r.minutesTo(s)) }))
      .filter(({ t }) => t.every(Number.isFinite))
      .sort((a, b) => Math.max(...a.t) - Math.max(...b.t))
      .slice(0, 30)
      .map(({ s }) => ({ lat: s.lat, lon: s.lon }));
  }

  async evaluate(points: LatLon[], pois?: Poi[]): Promise<Candidate[]> {
    const n = this.people.length;
    const times = points.map(() => new Array<number>(n).fill(Infinity));
    const estimated = points.map(() => new Array<boolean>(n).fill(false));

    const roadModes: Exclude<Mode, 'transit'>[] = ['car', 'bike', 'foot'];
    await Promise.all(
      roadModes.map(async (mode) => {
        const idx = this.people.map((p, i) => (p.mode === mode ? i : -1)).filter((i) => i >= 0);
        if (!idx.length) return;
        const m = await travelMatrix(
          mode,
          idx.map((i) => this.people[i].pos),
          points,
        );
        if (m.estimated) this.warn(`Calcul d’itinéraire indisponible (${mode}) : temps estimés.`);
        const extra = mode === 'car' ? this.opts.parking : 0;
        idx.forEach((pi, k) =>
          points.forEach((_, j) => {
            times[j][pi] = m.minutes[k][j] + extra;
            estimated[j][pi] = m.estimated;
          }),
        );
      }),
    );

    this.people.forEach((p, i) => {
      if (p.mode !== 'transit') return;
      const r = this.reach.get(i);
      points.forEach((pt, j) => {
        if (r) times[j][i] = r.minutesTo(pt);
        else times[j][i] = ((haversine(p.pos, pt) * 1.35) / 1000 / TRANSIT_FALLBACK_KMH) * 60 + 10;
        estimated[j][i] = true;
      });
    });

    return points.map((pt, j) => ({
      lat: pt.lat,
      lon: pt.lon,
      times: times[j],
      estimated: estimated[j],
      score: score(times[j], this.opts.criterion, this.opts.maxTime),
      poi: pois?.[j],
    }));
  }

  private warn(msg: string) {
    if (!this.warnings.includes(msg)) this.warnings.push(msg);
  }
}

const best = (cs: Candidate[]) => cs.reduce((a, b) => (b.score < a.score ? b : a));

export async function findMeetingPoint(
  participants: Participant[],
  opts: SearchOptions,
  progress: Progress = () => {},
): Promise<SearchResult> {
  const people = participants.filter((p): p is Located => p.pos != null);
  if (people.length < 2) throw new Error('Il faut au moins deux participants avec une adresse.');

  const ev = new Evaluator(people, opts);
  await ev.prepare(progress);

  // 1. Grille grossière autour du centre géographique (+ arrêts de transport, + domiciles).
  progress('Recherche de la zone la plus équitable…');
  const positions = people.map((p) => p.pos);
  const center = centroid(positions);
  const extent = Math.max(spread(positions) * 1.2, 3000);
  const step = extent / (COARSE - 1);
  const coarsePoints = grid(center, COARSE, step);
  const coarse = await ev.evaluate([...coarsePoints, ...ev.transitStops(), ...positions]);
  const coarseGrid = coarse.slice(0, coarsePoints.length);

  let zone = best(coarse);
  if (!Number.isFinite(zone.score)) {
    throw new Error(
      `Aucun lieu n’est accessible à tous en moins de ${opts.maxTime} min. Augmentez le temps de trajet maximal.`,
    );
  }

  // 2. Affinage autour de la meilleure zone.
  progress('Affinage du point de rencontre…');
  const fine = await ev.evaluate(grid(zone, FINE, step / 2.5));
  zone = best([zone, ...fine]);

  // 3. Lieux de la catégorie choisie autour du point.
  let places: Candidate[] = [];
  if (opts.category.filters.length) {
    let pois: Poi[] = [];
    for (const radius of POI_RADII) {
      progress(`Recherche de lieux (${opts.category.label.toLowerCase()}) à moins de ${radius >= 1000 ? `${radius / 1000} km` : `${radius} m`}…`);
      pois = await findPois(opts.category, zone, radius);
      if (pois.length >= 8 || radius >= Math.max(extent / 3, POI_RADII[1])) break;
    }
    if (!pois.length) ev.warnings.push(`Aucun lieu « ${opts.category.label} » trouvé autour du point.`);
    pois = pois.sort((a, b) => haversine(a, zone) - haversine(b, zone)).slice(0, 40);
    if (pois.length) {
      progress('Calcul des temps de trajet vers chaque lieu…');
      places = (await ev.evaluate(pois, pois))
        .sort((a, b) => a.score - b.score)
        .slice(0, MAX_PLACES);
    }
  }

  return { zone, grid: coarseGrid, places, warnings: ev.warnings };
}

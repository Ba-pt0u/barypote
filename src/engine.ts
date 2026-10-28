import { mapLimit } from './api/http';
import { findPois, type Area } from './api/overpass';
import { travelMatrix } from './api/osrm';
import { reachableStops, TransitReach } from './api/transit';
import { bbox, centroid, convexHull, grid, haversine, insidePolygon, spread, squareCorners } from './geo';
import { score } from './scoring';
import type {
  Candidate,
  GridLayer,
  LatLon,
  Mode,
  Participant,
  Poi,
  SearchEvent,
  SearchOptions,
  SearchResult,
  StepId,
} from './types';

type Located = Participant & { pos: LatLon };

const COARSE = 7;
const FINE = 5;
/** Chaque niveau d'affinage divise la taille des cellules par ce facteur. */
const ZOOM = 2.5;
const MAX_LEVELS = 3;
/** On n'affine pas en dessous de cette taille de cellule (mètres). */
const MIN_CELL = 250;
const MAX_PLACES = 12;
const MAX_EVALUATED = 50;
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
  async prepare() {
    const transit = this.people.map((p, i) => ({ p, i })).filter(({ p }) => p.mode === 'transit');
    await mapLimit(transit, 3, async ({ p, i }) => {
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

/** Écart de score toléré pour qu'un point fasse partie de la « zone équitable ». */
export const fairMargin = (bestScore: number) => Math.max(4, bestScore * 0.15);

/** Polygone englobant les cellules dont le score est proche du meilleur. */
export function fairHull(layer: GridLayer, bestScore: number): LatLon[] {
  const fair = layer.cells.filter((c) => c.score <= bestScore + fairMargin(bestScore));
  return convexHull(fair.flatMap((c) => squareCorners(c, layer.step)));
}

const km = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(1).replace('.', ',')} km` : `${Math.round(m)} m`);

export async function findMeetingPoint(
  participants: Participant[],
  opts: SearchOptions,
  emit: (e: SearchEvent) => void = () => {},
): Promise<SearchResult> {
  const people = participants.filter((p): p is Located => p.pos != null);
  if (people.length < 2) throw new Error('Il faut au moins deux participants avec une adresse.');
  const step = (id: StepId, state: 'active' | 'done' | 'error', label: string) => emit({ type: 'step', id, state, label });

  const ev = new Evaluator(people, opts);
  if (people.some((p) => p.mode === 'transit')) {
    step('transit', 'active', 'Réseau de transports en commun de chacun…');
    await ev.prepare();
    step('transit', 'done', 'Transports en commun chargés');
  }

  // 1. Grille grossière autour du centre géographique (+ arrêts de transport, + domiciles).
  step('zone', 'active', 'Recherche de la zone la plus équitable…');
  const positions = people.map((p) => p.pos);
  const center = centroid(positions);
  const extent = Math.max(spread(positions) * 1.2, 3000);
  let cell = extent / (COARSE - 1);
  const coarsePoints = grid(center, COARSE, cell);
  const coarse = await ev.evaluate([...coarsePoints, ...ev.transitStops(), ...positions]);
  const grids: GridLayer[] = [{ cells: coarse.slice(0, coarsePoints.length), step: cell, level: 0 }];
  emit({ type: 'grid', layer: grids[0] });

  let zone = best(coarse);
  if (!Number.isFinite(zone.score)) {
    step('zone', 'error', 'Aucune zone accessible à tous');
    throw new Error(
      `Aucun lieu n’est accessible à tous en moins de ${opts.maxTime} min. Augmentez le temps de trajet maximal.`,
    );
  }
  const firstZone = zone;
  let hull = fairHull(grids[0], zone.score);
  emit({ type: 'zone', best: zone, hull, level: 0 });
  step('zone', 'done', 'Zone équitable trouvée');

  // 2. Les lieux de la zone équitable sont cherchés pendant l'affinage du point.
  const poisSearch = opts.category.filters.length ? searchPois(opts, hull, zone, emit, step, ev.warnings) : null;

  // 3. Affinage : grilles de plus en plus fines autour du meilleur point.
  for (let level = 1; level <= MAX_LEVELS && cell / ZOOM >= MIN_CELL; level++) {
    cell /= ZOOM;
    step('refine', 'active', `Affinage de la zone (cellules de ${km(cell)})…`);
    const layer: GridLayer = { cells: await ev.evaluate(grid(zone, FINE, cell)), step: cell, level };
    grids.push(layer);
    emit({ type: 'grid', layer });
    zone = best([zone, ...layer.cells]);
    hull = fairHull(layer, zone.score);
    emit({ type: 'zone', best: zone, hull, level });
  }
  step('refine', 'done', 'Point de rencontre affiné');

  // 4. Classement des lieux selon les temps de trajet réels.
  let places: Candidate[] = [];
  let pois = poisSearch ? await poisSearch : null;
  if (pois) {
    if (haversine(zone, firstZone) > 600 || pois.length < 5) {
      // Le point a bougé pendant l'affinage, ou la zone est pauvre en lieux : on cherche aussi autour du point final.
      const more = await findPois(opts.category, [{ area: { center: zone, radius: pois.length < 5 ? 5000 : 900 }, limit: 80 }]).catch(
        () => [],
      );
      pois = dedupe([...pois, ...more]);
      emit({ type: 'pois', pois });
    }
    if (!pois.length) ev.warnings.push(`Aucun lieu « ${opts.category.label} » trouvé autour du point.`);
    pois = pois.sort((a, b) => haversine(a, zone) - haversine(b, zone)).slice(0, MAX_EVALUATED);
    if (pois.length) {
      step('rank', 'active', `Temps de trajet vers ${pois.length} lieux…`);
      places = (await ev.evaluate(pois, pois)).sort((a, b) => a.score - b.score).slice(0, MAX_PLACES);
      step('rank', 'done', 'Lieux classés');
    }
  }

  return { zone, hull, grids, places, warnings: ev.warnings };
}

function dedupe(pois: Poi[]): Poi[] {
  const seen = new Set<string>();
  return pois.filter((p) => !seen.has(p.id) && seen.add(p.id));
}

/**
 * Lieux de la zone équitable : une seule requête Overpass couvrant le rectangle de la zone (filtré
 * ensuite sur le polygone) et les abords immédiats du meilleur point (dans les quartiers denses,
 * le rectangle ne renvoie qu'un échantillon). Un échec n'annule pas la recherche : la zone reste affichée.
 */
async function searchPois(
  opts: SearchOptions,
  hull: LatLon[],
  zone: LatLon,
  emit: (e: SearchEvent) => void,
  step: (id: StepId, state: 'active' | 'done' | 'error', label: string) => void,
  warnings: string[],
): Promise<Poi[] | null> {
  const what = opts.category.label.toLowerCase();
  step('pois', 'active', `Recherche des lieux (${what}) dans la zone…`);
  const near = 900;
  try {
    const areas: { area: Area; limit: number }[] = [{ area: { center: zone, radius: near }, limit: 80 }];
    if (hull.length >= 3) areas.push({ area: { bbox: bbox(hull) }, limit: 200 });
    const found = await findPois(opts.category, areas);
    const pois = found.filter((p) => haversine(p, zone) <= near || insidePolygon(p, hull));
    emit({ type: 'pois', pois });
    step('pois', 'done', `${pois.length} lieu${pois.length > 1 ? 'x' : ''} trouvé${pois.length > 1 ? 's' : ''} dans la zone`);
    return pois;
  } catch (e) {
    step('pois', 'error', 'Recherche de lieux impossible pour le moment');
    warnings.push(`${(e as Error).message}. Le point de rencontre reste valable ; relancez la recherche dans un instant pour les lieux.`);
    return null;
  }
}

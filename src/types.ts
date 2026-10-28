export interface LatLon {
  lat: number;
  lon: number;
}

export type Mode = 'car' | 'transit' | 'bike' | 'foot';

export interface Participant {
  id: string;
  name: string;
  /** Libellé lisible de l'adresse choisie. */
  label: string;
  pos: LatLon | null;
  mode: Mode;
  color: string;
}

export type Criterion = 'balanced' | 'minimax' | 'total';

export interface Category {
  id: string;
  label: string;
  emoji: string;
  /** Filtres Overpass, ex. `["amenity"~"^(bar|pub)$"]`. Vide = pas de recherche de lieu. */
  filters: string[];
}

export interface Poi extends LatLon {
  id: string;
  name: string;
  kind: string;
  tags: Record<string, string>;
}

export interface Candidate extends LatLon {
  /** Temps de trajet en minutes, un par participant (même ordre). Infinity = injoignable. */
  times: number[];
  /** Vrai si au moins un temps est une estimation (et non un calcul d'itinéraire exact). */
  estimated: boolean[];
  score: number;
  poi?: Poi;
}

export interface SearchOptions {
  criterion: Criterion;
  category: Category;
  /** Date/heure de départ (utile pour les transports en commun). */
  departure: Date;
  /** Temps de trajet maximal acceptable (minutes) pour chacun. */
  maxTime: number;
  /** Minutes ajoutées aux trajets en voiture pour se garer. */
  parking: number;
}

/** Une passe de la recherche : grille de points évalués, de plus en plus fine. */
export interface GridLayer {
  cells: Candidate[];
  /** Côté d'une cellule, en mètres. */
  step: number;
  level: number;
}

export interface SearchResult {
  zone: Candidate;
  /** Zone équitable finale (polygone). */
  hull: LatLon[];
  /** Grilles évaluées, pour la carte d'équité. */
  grids: GridLayer[];
  places: Candidate[];
  warnings: string[];
}

export type StepId = 'transit' | 'zone' | 'refine' | 'pois' | 'rank';

/** Événements émis pendant la recherche, pour l'affichage en direct. */
export type SearchEvent =
  | { type: 'step'; id: StepId; state: 'active' | 'done' | 'error'; label: string }
  | { type: 'grid'; layer: GridLayer }
  | { type: 'zone'; best: Candidate; hull: LatLon[]; level: number }
  | { type: 'pois'; pois: Poi[] };

export interface RouteLeg {
  mode: string;
  label: string;
  minutes: number;
  coords: [number, number][];
}

export interface Route {
  minutes: number;
  coords: [number, number][];
  legs: RouteLeg[];
  summary: string;
}

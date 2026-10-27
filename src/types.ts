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

export interface SearchResult {
  zone: Candidate;
  /** Points de la grille évalués, pour la carte d'équité. */
  grid: Candidate[];
  places: Candidate[];
  warnings: string[];
}

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

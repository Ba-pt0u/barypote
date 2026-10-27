import type { Category } from './types';

export const CATEGORIES: Category[] = [
  { id: 'bar', label: 'Bar', emoji: '🍻', filters: ['["amenity"~"^(bar|pub|biergarten)$"]'] },
  { id: 'restaurant', label: 'Restaurant', emoji: '🍽️', filters: ['["amenity"="restaurant"]'] },
  { id: 'cafe', label: 'Café', emoji: '☕', filters: ['["amenity"="cafe"]'] },
  { id: 'fastfood', label: 'Sur le pouce', emoji: '🥙', filters: ['["amenity"="fast_food"]'] },
  {
    id: 'fun',
    label: 'Activité',
    emoji: '🎳',
    filters: [
      '["leisure"~"^(bowling_alley|escape_game|amusement_arcade|miniature_golf|trampoline_park)$"]',
      '["amenity"~"^(cinema|karaoke_box)$"]',
    ],
  },
  {
    id: 'culture',
    label: 'Culture',
    emoji: '🎭',
    filters: ['["tourism"~"^(museum|gallery)$"]', '["amenity"~"^(theatre|arts_centre)$"]'],
  },
  { id: 'park', label: 'Parc', emoji: '🌳', filters: ['["leisure"~"^(park|garden)$"]'] },
  { id: 'station', label: 'Gare', emoji: '🚉', filters: ['["railway"="station"]'] },
  { id: 'none', label: 'Juste le point', emoji: '📍', filters: [] },
];

const KIND_LABELS: Record<string, string> = {
  bar: 'Bar',
  pub: 'Pub',
  biergarten: 'Biergarten',
  restaurant: 'Restaurant',
  cafe: 'Café',
  fast_food: 'Restauration rapide',
  bowling_alley: 'Bowling',
  escape_game: 'Escape game',
  amusement_arcade: 'Salle d’arcade',
  miniature_golf: 'Mini-golf',
  trampoline_park: 'Trampoline park',
  cinema: 'Cinéma',
  karaoke_box: 'Karaoké',
  museum: 'Musée',
  gallery: 'Galerie',
  theatre: 'Théâtre',
  arts_centre: 'Centre culturel',
  park: 'Parc',
  garden: 'Jardin',
  station: 'Gare',
};

export function kindLabel(tags: Record<string, string>): string {
  const raw = tags.amenity ?? tags.leisure ?? tags.tourism ?? tags.railway ?? '';
  const base = KIND_LABELS[raw] ?? raw;
  const cuisine = tags.cuisine?.split(';')[0]?.replace(/_/g, ' ');
  return cuisine ? `${base} · ${cuisine}` : base;
}

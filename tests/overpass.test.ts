import { describe, expect, it } from 'vitest';
import { buildQuery, parse } from '../src/api/overpass';
import { CATEGORIES } from '../src/categories';

describe('overpass', () => {
  it('requête avec un filtre par famille de tags', () => {
    const q = buildQuery(CATEGORIES.find((c) => c.id === 'culture')!, { lat: 48.1, lon: -1.6 }, 1000);
    expect(q).toContain('nwr["tourism"~"^(museum|gallery)$"]["name"](around:1000,48.100000,-1.600000);');
    expect(q).toContain('nwr["amenity"~"^(theatre|arts_centre)$"]["name"](around:1000,48.100000,-1.600000);');
    expect(q).toMatch(/out center tags \d+;$/);
  });

  it('parse : centre des bâtiments, doublons et lieux sans nom', () => {
    const pois = parse([
      { type: 'node', id: 1, lat: 48.1, lon: -1.6, tags: { name: 'Le Bar', amenity: 'bar' } },
      { type: 'way', id: 2, center: { lat: 48.1001, lon: -1.6001 }, tags: { name: 'le bar', amenity: 'bar' } },
      { type: 'way', id: 3, center: { lat: 48.2, lon: -1.7 }, tags: { name: 'Chez Lulu', amenity: 'restaurant', cuisine: 'french' } },
      { type: 'node', id: 4, lat: 48.3, lon: -1.8, tags: { amenity: 'bar' } },
    ]);
    expect(pois.map((p) => p.id)).toEqual(['node/1', 'way/3']);
    expect(pois[1].kind).toBe('Restaurant · french');
  });
});

import { describe, expect, it } from 'vitest';
import { buildQuery, parse } from '../src/api/overpass';
import { CATEGORIES } from '../src/categories';

describe('overpass', () => {
  it('requête avec un filtre par famille de tags', () => {
    const q = buildQuery(CATEGORIES.find((c) => c.id === 'culture')!, [
      { area: { center: { lat: 48.1, lon: -1.6 }, radius: 1000 }, limit: 50 },
    ]);
    expect(q).toContain('nwr["tourism"~"^(museum|gallery)$"]["name"](around:1000,48.100000,-1.600000);');
    expect(q).toContain('nwr["amenity"~"^(theatre|arts_centre)$"]["name"](around:1000,48.100000,-1.600000);');
    expect(q).toMatch(/out center tags qt 50;$/);
  });

  it('une seule requête pour plusieurs zones, chacune avec sa limite', () => {
    const q = buildQuery(CATEGORIES[1], [
      { area: { center: { lat: 48, lon: 2 }, radius: 900 }, limit: 80 },
      { area: { bbox: [48, 2, 48.1, 2.1] }, limit: 200 },
    ]);
    expect(q).toBe(
      '[out:json][timeout:20];' +
        '(nwr["amenity"="restaurant"]["name"](around:900,48.000000,2.000000););out center tags qt 80;' +
        '(nwr["amenity"="restaurant"]["name"](48.00000,2.00000,48.10000,2.10000););out center tags qt 200;',
    );
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

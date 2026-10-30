import { describe, expect, it } from 'vitest';
import { buildUrl, parseFeatures } from '../src/api/geoapify';
import { CATEGORIES } from '../src/categories';

describe('geoapify', () => {
  const bar = CATEGORIES[0];
  it('cercle : filtre + tri par proximité (longitude d’abord)', () => {
    const u = new URL(buildUrl(bar, { center: { lat: 48.1, lon: 2.2 }, radius: 900 }, 80), 'http://x/');
    expect(u.pathname).toBe('/api/geoapify/places');
    expect(u.searchParams.get('filter')).toBe('circle:2.2,48.1,900');
    expect(u.searchParams.get('bias')).toBe('proximity:2.2,48.1');
    expect(u.searchParams.get('categories')).toBe('catering.bar,catering.pub,catering.biergarten');
    expect(u.searchParams.has('apiKey')).toBe(false);
  });
  it('rectangle (s, w, n, e) → rect:lon1,lat1,lon2,lat2', () => {
    const u = new URL(buildUrl(bar, { bbox: [48, 2, 48.1, 2.1] }, 900), 'http://x/');
    expect(u.searchParams.get('filter')).toBe('rect:2,48,2.1,48.1');
    expect(u.searchParams.get('limit')).toBe('500');
  });
  it('identifiants OSM et étiquettes', () => {
    const pois = parseFeatures([
      { properties: { name: 'Le Zinc', lat: 48, lon: 2, place_id: 'a', datasource: { raw: { osm_type: 'n', osm_id: 12, amenity: 'pub' } } } },
      { properties: { name: 'Sans OSM', lat: 48, lon: 2, place_id: 'b', categories: ['catering.cafe'] } },
      { properties: { lat: 48, lon: 2, place_id: 'c' } },
    ]);
    expect(pois.map((p) => [p.id, p.kind])).toEqual([
      ['node/12', 'Pub'],
      ['geoapify/b', 'cafe'],
    ]);
  });
});

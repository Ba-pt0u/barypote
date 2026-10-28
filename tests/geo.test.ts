import { describe, expect, it } from 'vitest';
import { bbox, centroid, convexHull, insidePolygon, decodePolyline, decodePolylineNear, grid, haversine, offset } from '../src/geo';

describe('geo', () => {
  it('haversine Paris → Lyon ≈ 392 km', () => {
    const d = haversine({ lat: 48.8566, lon: 2.3522 }, { lat: 45.764, lon: 4.8357 });
    expect(d / 1000).toBeGreaterThan(388);
    expect(d / 1000).toBeLessThan(396);
  });

  it('offset déplace du bon nombre de mètres', () => {
    const p = { lat: 48.85, lon: 2.35 };
    expect(haversine(p, offset(p, 1000, 0))).toBeCloseTo(1000, -1);
    expect(haversine(p, offset(p, 0, -500))).toBeCloseTo(500, -1);
  });

  it('grid produit size² points centrés', () => {
    const c = { lat: 45, lon: 5 };
    const g = grid(c, 5, 200);
    expect(g).toHaveLength(25);
    const m = centroid(g);
    expect(m.lat).toBeCloseTo(c.lat, 6);
    expect(m.lon).toBeCloseTo(c.lon, 6);
  });

  it('decodePolyline : exemple de référence Google (précision 5)', () => {
    const pts = decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@', 5);
    expect(pts).toEqual([
      [38.5, -120.2],
      [40.7, -120.95],
      [43.252, -126.453],
    ]);
  });

  it('decodePolylineNear devine la précision', () => {
    // Même chaîne, interprétée en précision 6 elle donnerait 3.85,-12.02 : on doit choisir 5.
    const pts = decodePolylineNear('_p~iF~ps|U_ulLnnqC_mqNvxq`@', { lat: 38.5, lon: -120.2 });
    expect(pts[0]).toEqual([38.5, -120.2]);
  });
});

describe('convexHull', () => {
  it('ne garde que le contour', () => {
    const h = convexHull([
      { lat: 0, lon: 0 },
      { lat: 0, lon: 2 },
      { lat: 2, lon: 2 },
      { lat: 2, lon: 0 },
      { lat: 1, lon: 1 },
      { lat: 1, lon: 2 },
    ]);
    expect(h).toHaveLength(4);
    expect(h).not.toContainEqual({ lat: 1, lon: 1 });
  });
});

describe('polygone', () => {
  const sq = [
    { lat: 0, lon: 0 },
    { lat: 0, lon: 2 },
    { lat: 2, lon: 2 },
    { lat: 2, lon: 0 },
  ];
  it('insidePolygon', () => {
    expect(insidePolygon({ lat: 1, lon: 1 }, sq)).toBe(true);
    expect(insidePolygon({ lat: 3, lon: 1 }, sq)).toBe(false);
  });
  it('bbox', () => expect(bbox(sq)).toEqual([0, 0, 2, 2]));
});

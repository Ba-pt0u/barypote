import type { LatLon } from './types';

const R = 6371000;
const rad = (d: number) => (d * Math.PI) / 180;

/** Distance à vol d'oiseau en mètres. */
export function haversine(a: LatLon, b: LatLon): number {
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function centroid(points: LatLon[]): LatLon {
  const lat = points.reduce((s, p) => s + p.lat, 0) / points.length;
  const lon = points.reduce((s, p) => s + p.lon, 0) / points.length;
  return { lat, lon };
}

/** Décale un point de `dx` mètres vers l'est et `dy` mètres vers le nord. */
export function offset(p: LatLon, dx: number, dy: number): LatLon {
  return {
    lat: p.lat + (dy / R) * (180 / Math.PI),
    lon: p.lon + (dx / (R * Math.cos(rad(p.lat)))) * (180 / Math.PI),
  };
}

/** Plus grande distance entre deux points du groupe (mètres). */
export function spread(points: LatLon[]): number {
  let max = 0;
  for (let i = 0; i < points.length; i++)
    for (let j = i + 1; j < points.length; j++) max = Math.max(max, haversine(points[i], points[j]));
  return max;
}

/**
 * Grille carrée de `size`×`size` points centrée sur `center`, espacés de `step` mètres.
 */
export function grid(center: LatLon, size: number, step: number): LatLon[] {
  const out: LatLon[] = [];
  const half = (size - 1) / 2;
  for (let i = 0; i < size; i++)
    for (let j = 0; j < size; j++) out.push(offset(center, (i - half) * step, (j - half) * step));
  return out;
}

/** Décode une polyline encodée (format Google) avec la précision donnée. */
export function decodePolyline(str: string, precision: number): [number, number][] {
  const factor = 10 ** precision;
  const coords: [number, number][] = [];
  let index = 0;
  let lat = 0;
  let lon = 0;
  while (index < str.length) {
    for (const axis of [0, 1]) {
      let result = 0;
      let shift = 0;
      let byte: number;
      do {
        byte = str.charCodeAt(index++) - 63;
        // Arithmétique flottante plutôt que bit à bit : la précision 7 dépasse 32 bits.
        result += (byte & 0x1f) * 2 ** shift;
        shift += 5;
      } while (byte >= 0x20);
      const delta = result % 2 ? -(result + 1) / 2 : result / 2;
      if (axis === 0) lat += delta;
      else lon += delta;
    }
    coords.push([lat / factor, lon / factor]);
  }
  return coords;
}

/**
 * Décode une polyline dont la précision n'est pas connue avec certitude :
 * on garde la précision dont le premier point tombe le plus près de `start`.
 */
export function decodePolylineNear(str: string, start: LatLon, precisions = [7, 6, 5]): [number, number][] {
  let best: [number, number][] = [];
  let bestDist = Infinity;
  for (const p of precisions) {
    const coords = decodePolyline(str, p);
    if (!coords.length) continue;
    const d = haversine(start, { lat: coords[0][0], lon: coords[0][1] });
    if (d < bestDist) {
      bestDist = d;
      best = coords;
    }
  }
  return best;
}

/** Enveloppe convexe (algorithme de la chaîne monotone), dans le sens trigonométrique. */
export function convexHull(points: LatLon[]): LatLon[] {
  const pts = [...points].sort((a, b) => a.lon - b.lon || a.lat - b.lat);
  if (pts.length < 3) return pts;
  const cross = (o: LatLon, a: LatLon, b: LatLon) =>
    (a.lon - o.lon) * (b.lat - o.lat) - (a.lat - o.lat) * (b.lon - o.lon);
  const half = (list: LatLon[]) => {
    const out: LatLon[] = [];
    for (const p of list) {
      while (out.length >= 2 && cross(out[out.length - 2], out[out.length - 1], p) <= 0) out.pop();
      out.push(p);
    }
    out.pop();
    return out;
  };
  return [...half(pts), ...half([...pts].reverse())];
}

/** Coins du carré de côté `size` mètres centré sur `p`. */
export function squareCorners(p: LatLon, size: number): LatLon[] {
  const h = size / 2;
  return [offset(p, -h, -h), offset(p, h, -h), offset(p, h, h), offset(p, -h, h)];
}

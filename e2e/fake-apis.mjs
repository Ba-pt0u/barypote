// Fausses API (OSRM, Photon, Transitous, Overpass) pour les tests hors ligne.
// Les réponses imitent le format des vrais services, avec des temps proportionnels à la distance.

const R = 6371000;
const rad = (d) => (d * Math.PI) / 180;
function haversine(a, b) {
  const h =
    Math.sin(rad(b.lat - a.lat) / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lon - a.lon) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
const offset = (p, dx, dy) => ({
  lat: p.lat + (dy / R) * (180 / Math.PI),
  lon: p.lon + (dx / (R * Math.cos(rad(p.lat)))) * (180 / Math.PI),
});

function encodePolyline(coords, precision) {
  const f = 10 ** precision;
  let out = '';
  let pl = 0;
  let pn = 0;
  const enc = (v) => {
    let n = v < 0 ? -2 * v - 1 : 2 * v;
    let s = '';
    while (n >= 0x20) {
      s += String.fromCharCode((0x20 | (n % 32)) + 63);
      n = Math.floor(n / 32);
    }
    return s + String.fromCharCode(n + 63);
  };
  for (const [lat, lon] of coords) {
    const l = Math.round(lat * f);
    const n = Math.round(lon * f);
    out += enc(l - pl) + enc(n - pn);
    pl = l;
    pn = n;
  }
  return out;
}

const SPEED = { car: 40, bike: 15, foot: 5 }; // km/h
const PLACES = [
  { name: 'Montmartre', city: 'Paris', lat: 48.8867, lon: 2.3431 },
  { name: 'Vincennes', city: 'Vincennes', lat: 48.8474, lon: 2.4396 },
  { name: 'Boulogne-Billancourt', city: 'Boulogne-Billancourt', lat: 48.8353, lon: 2.2411 },
  { name: 'Place d’Italie', city: 'Paris', lat: 48.8313, lon: 2.3556 },
  { name: 'Gare de Lyon', city: 'Paris', lat: 48.8443, lon: 2.3744 },
];
const BAR_NAMES = ['Le Comptoir', 'Chez Paulette', 'La Fine Mousse', 'Le Petit Zinc', 'Bar des Amis', 'Le Perchoir', 'L’Entracte', 'Café Oz', 'La Cave', 'Le Baron Rouge', 'Le Mauri7', 'Les Pieds Nickelés'];

export const calls = [];

/** @returns {{status:number, json?:any, body?:Buffer, contentType?:string} | null} */
export function handle(rawUrl, method = 'GET', body = '') {
  const url = new URL(rawUrl);
  const host = url.host;

  if (host.endsWith('basemaps.cartocdn.com')) {
    // Tuile PNG 1×1 gris clair.
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==',
      'base64',
    );
    return { status: 200, body: png, contentType: 'image/png' };
  }

  calls.push(`${host}${url.pathname}`);

  if (host === 'photon.komoot.io') {
    if (url.pathname === '/reverse') {
      return {
        status: 200,
        json: {
          features: [
            {
              geometry: { coordinates: [Number(url.searchParams.get('lon')), Number(url.searchParams.get('lat'))] },
              properties: { name: 'Rue de Rivoli', city: 'Paris', postcode: '75004', country: 'France' },
            },
          ],
        },
      };
    }
    const q = (url.searchParams.get('q') ?? '').toLowerCase();
    const hits = PLACES.filter((p) => p.name.toLowerCase().includes(q.slice(0, 4)) || p.city.toLowerCase().includes(q.slice(0, 4)));
    return {
      status: 200,
      json: {
        features: (hits.length ? hits : PLACES.slice(0, 2)).map((p) => ({
          geometry: { coordinates: [p.lon, p.lat] },
          properties: { name: p.name, city: p.city, country: 'France' },
        })),
      },
    };
  }

  const osrm = url.pathname.match(/^(?:\/routed-(car|bike|foot))?\/(table|route)\/v1\/driving\/(.+)$/);
  if (osrm && (host === 'routing.openstreetmap.de' || host === 'router.project-osrm.org')) {
    const mode = osrm[1] ?? 'car';
    const coords = osrm[3].split(';').map((s) => {
      const [lon, lat] = s.split(',').map(Number);
      return { lat, lon };
    });
    const sec = (a, b) => ((haversine(a, b) * 1.3) / 1000 / SPEED[mode]) * 3600 + (mode === 'car' ? 120 : 0);
    if (osrm[2] === 'table') {
      const src = url.searchParams.get('sources').split(';').map(Number);
      const dst = url.searchParams.get('destinations').split(';').map(Number);
      return {
        status: 200,
        json: {
          code: 'Ok',
          durations: src.map((i) => dst.map((j) => sec(coords[i], coords[j]))),
          destinations: dst.map((j) => ({ location: [coords[j].lon, coords[j].lat], distance: 12 })),
        },
      };
    }
    const [a, b] = coords;
    const mid = offset({ lat: (a.lat + b.lat) / 2, lon: (a.lon + b.lon) / 2 }, 300, 300);
    return {
      status: 200,
      json: {
        code: 'Ok',
        routes: [
          {
            duration: sec(a, b),
            distance: haversine(a, b) * 1.3,
            geometry: { type: 'LineString', coordinates: [a, mid, b].map((p) => [p.lon, p.lat]) },
          },
        ],
      },
    };
  }

  if (host === 'api.transitous.org') {
    const parse = (s) => {
      const [lat, lon] = s.split(',').map(Number);
      return { lat, lon };
    };
    const minutes = (a, b) => 6 + ((haversine(a, b) * 1.3) / 1000 / 22) * 60;
    if (url.pathname === '/api/v1/one-to-all') {
      const one = parse(url.searchParams.get('one'));
      const max = Number(url.searchParams.get('maxTravelTime'));
      const all = [];
      for (let i = -12; i <= 12; i++)
        for (let j = -12; j <= 12; j++) {
          const p = offset(one, i * 1200, j * 1200);
          const d = minutes(one, p);
          if (d <= max) all.push({ place: { name: `Arrêt ${i}/${j}`, stopId: `s${i}_${j}`, lat: p.lat, lon: p.lon }, duration: Math.round(d), k: 1 });
        }
      return { status: 200, json: { one: { name: 'START', ...one }, all } };
    }
    if (url.pathname === '/api/v1/plan') {
      const from = parse(url.searchParams.get('fromPlace'));
      const to = parse(url.searchParams.get('toPlace'));
      const s1 = offset(from, 200, 100);
      const s2 = offset(to, -150, -100);
      const total = minutes(from, to) * 60;
      const leg = (mode, a, b, duration, extra = {}) => ({
        mode,
        duration,
        from: { name: 'A', ...a },
        to: { name: 'B', ...b },
        legGeometry: { points: encodePolyline([[a.lat, a.lon], [b.lat, b.lon]], 7), length: 2 },
        ...extra,
      });
      return {
        status: 200,
        json: {
          itineraries: [
            {
              duration: total,
              transfers: 0,
              legs: [
                leg('WALK', from, s1, 240),
                leg('SUBWAY', s1, s2, total - 480, { routeShortName: '4', headsign: 'Mairie de Montrouge' }),
                leg('WALK', s2, to, 240),
              ],
            },
          ],
          direct: [],
        },
      };
    }
    return { status: 404, json: { error: 'not found' } };
  }

  if (url.pathname.endsWith('/interpreter')) {
    const q = decodeURIComponent(String(body).replace(/^data=/, '').replace(/\+/g, ' '));
    const m = q.match(/around:(\d+),(-?[\d.]+),(-?[\d.]+)/);
    const radius = Number(m[1]);
    const center = { lat: Number(m[2]), lon: Number(m[3]) };
    const amenity = (q.match(/"amenity"[=~]"\^?\(?([a-z_]+)/) ?? [])[1] ?? 'bar';
    const elements = BAR_NAMES.map((name, k) => {
      const ang = (k / BAR_NAMES.length) * 2 * Math.PI;
      const r = radius * (0.2 + 0.07 * k) * 0.9;
      const p = offset(center, Math.cos(ang) * r, Math.sin(ang) * r);
      return {
        type: k % 3 ? 'node' : 'way',
        id: 1000 + k,
        ...(k % 3 ? { lat: p.lat, lon: p.lon } : { center: p }),
        tags: { name, amenity, 'addr:street': 'Rue de la Roquette', 'addr:housenumber': String(10 + k), opening_hours: 'Mo-Su 17:00-02:00' },
      };
    });
    return { status: 200, json: { elements } };
  }

  return null;
}

import L from 'leaflet';

/**
 * Fond de carte sans clé d'API :
 * - OpenFreeMap (https://openfreemap.org), tuiles vectorielles OpenStreetMap gratuites et sans limite,
 *   avec un style clair et un style sombre ;
 * - en secours (pas de WebGL, service injoignable) : tuiles raster officielles d'OpenStreetMap.
 */
const OPENFREEMAP = 'https://tiles.openfreemap.org/styles';
const STYLES = { light: 'positron', dark: 'dark' };
const OSM_RASTER = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';

const OSM = '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';
const OFM_ATTRIBUTION = `<a href="https://openfreemap.org" target="_blank">OpenFreeMap</a> · <a href="https://www.openmaptiles.org/" target="_blank">© OpenMapTiles</a> · ${OSM}`;

const styleUrl = (dark: boolean) => `${OPENFREEMAP}/${dark ? STYLES.dark : STYLES.light}`;

function hasWebGL(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') ?? c.getContext('webgl'));
  } catch {
    return false;
  }
}

async function reachable(url: string): Promise<boolean> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 6000);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export async function addBasemap(map: L.Map): Promise<'vector' | 'raster'> {
  const dark = window.matchMedia('(prefers-color-scheme: dark)');

  if (hasWebGL() && (await reachable(styleUrl(dark.matches)))) {
    try {
      const [{ maplibreGL }] = await Promise.all([
        import('@maplibre/maplibre-gl-leaflet'),
        import('maplibre-gl'),
        import('maplibre-gl/dist/maplibre-gl.css'),
      ]);
      const layer = maplibreGL({
        style: styleUrl(dark.matches),
        attributionControl: false,
      }).addTo(map);
      map.attributionControl?.addAttribution(OFM_ATTRIBUTION);
      dark.addEventListener('change', (e) => layer.getMaplibreMap().setStyle(styleUrl(e.matches)));
      return 'vector';
    } catch (e) {
      console.warn('Fond vectoriel indisponible, repli sur OpenStreetMap :', e);
    }
  }

  L.tileLayer(OSM_RASTER, { attribution: OSM, maxZoom: 19 }).addTo(map);
  // Pas de style sombre officiel : on assombrit les tuiles par filtre CSS.
  const container = map.getContainer();
  container.classList.add('raster-tiles');
  return 'raster';
}

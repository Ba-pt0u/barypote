import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { offset } from './geo';
import { formatMinutes, stats } from './scoring';
import type { Candidate, LatLon, Participant, Route } from './types';

const TILES = {
  light: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
  dark: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
};
const ATTRIBUTION =
  '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> · © <a href="https://carto.com/attributions">CARTO</a>';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export class MeetingMap {
  readonly map: L.Map;
  private people = L.layerGroup();
  private heat = L.layerGroup();
  private places = L.layerGroup();
  private routes = L.layerGroup();
  private zone = L.layerGroup();
  private placeMarkers = new Map<string, L.Marker>();
  private tiles: L.TileLayer;
  heatVisible = false;
  onPlaceClick: (id: string) => void = () => {};
  onParticipantMoved: (id: string, pos: LatLon) => void = () => {};

  constructor(el: HTMLElement) {
    this.map = L.map(el, { zoomControl: false, attributionControl: true }).setView([46.6, 2.4], 6);
    L.control.zoom({ position: 'topright' }).addTo(this.map);
    const dark = window.matchMedia('(prefers-color-scheme: dark)');
    this.tiles = L.tileLayer(dark.matches ? TILES.dark : TILES.light, {
      attribution: ATTRIBUTION,
      subdomains: 'abcd',
      maxZoom: 20,
    }).addTo(this.map);
    dark.addEventListener('change', (e) => this.tiles.setUrl(e.matches ? TILES.dark : TILES.light));
    for (const layer of [this.routes, this.zone, this.places, this.people]) layer.addTo(this.map);
  }

  setParticipants(list: Participant[]) {
    this.people.clearLayers();
    for (const p of list) {
      if (!p.pos) continue;
      const initial = (p.name.trim()[0] ?? '?').toUpperCase();
      const icon = L.divIcon({
        className: '',
        html: `<div class="pin" style="--c:${p.color}"><span>${esc(initial)}</span></div>`,
        iconSize: [34, 42],
        iconAnchor: [17, 40],
        popupAnchor: [0, -36],
      });
      const m = L.marker([p.pos.lat, p.pos.lon], { icon, draggable: true, title: p.name })
        .bindTooltip(`${esc(p.name)} · ${esc(p.label)}`, { direction: 'top', offset: [0, -36] })
        .addTo(this.people);
      m.on('dragend', () => {
        const ll = m.getLatLng();
        this.onParticipantMoved(p.id, { lat: ll.lat, lon: ll.lng });
      });
    }
  }

  fitParticipants(list: Participant[]) {
    const pts = list.filter((p) => p.pos).map((p) => [p.pos!.lat, p.pos!.lon] as [number, number]);
    if (pts.length === 1) this.map.setView(pts[0], 13);
    else if (pts.length > 1) this.map.fitBounds(L.latLngBounds(pts), { padding: [60, 60], maxZoom: 14 });
  }

  clearResults() {
    for (const layer of [this.heat, this.places, this.routes, this.zone]) layer.clearLayers();
    this.placeMarkers.clear();
  }

  showResult(zone: Candidate, grid: Candidate[], places: Candidate[], participants: Participant[]) {
    this.clearResults();
    L.marker([zone.lat, zone.lon], {
      icon: L.divIcon({ className: '', html: '<div class="zone-pin"></div>', iconSize: [28, 28], iconAnchor: [14, 14] }),
      zIndexOffset: -100,
      interactive: false,
    }).addTo(this.zone);

    // Carte d'équité : chaque cellule de la grille, du vert (équitable) au rouge.
    const finite = grid.filter((c) => Number.isFinite(c.score));
    if (finite.length > 1) {
      const lo = Math.min(...finite.map((c) => c.score));
      const hi = Math.max(...finite.map((c) => c.score));
      const step = cellSize(grid);
      for (const c of grid) {
        const t = Number.isFinite(c.score) ? (c.score - lo) / (hi - lo || 1) : 1;
        const color = Number.isFinite(c.score) ? heatColor(t) : '#888';
        const s = stats(c.times);
        const sw = offset(c, -step / 2, -step / 2);
        const ne = offset(c, step / 2, step / 2);
        L.rectangle([[sw.lat, sw.lon], [ne.lat, ne.lon]], {
          stroke: false,
          fillColor: color,
          fillOpacity: Number.isFinite(c.score) ? 0.35 : 0.12,
        })
          .bindTooltip(
            Number.isFinite(c.score)
              ? participants.map((p, i) => `${esc(p.name)} : ${formatMinutes(c.times[i])}`).join('<br>') +
                  `<br><b>max ${formatMinutes(s.max)}</b>`
              : 'Trop loin pour quelqu’un',
            { sticky: true },
          )
          .addTo(this.heat);
      }
    }
    if (this.heatVisible) this.heat.addTo(this.map);

    places.forEach((c, i) => {
      if (!c.poi) return;
      const m = L.marker([c.lat, c.lon], {
        icon: L.divIcon({
          className: '',
          html: `<div class="place-pin${i === 0 ? ' best' : ''}">${i + 1}</div>`,
          iconSize: [28, 28],
          iconAnchor: [14, 14],
        }),
        title: c.poi.name,
        zIndexOffset: 500 - i,
      })
        .bindTooltip(`${i + 1}. ${esc(c.poi.name)}`, { direction: 'top', offset: [0, -12] })
        .on('click', () => this.onPlaceClick(c.poi!.id))
        .addTo(this.places);
      this.placeMarkers.set(c.poi.id, m);
    });

    const bounds = L.latLngBounds([[zone.lat, zone.lon]]);
    participants.forEach((p) => p.pos && bounds.extend([p.pos.lat, p.pos.lon]));
    places.forEach((c) => bounds.extend([c.lat, c.lon]));
    this.map.fitBounds(bounds, { padding: [50, 50], maxZoom: 15 });
  }

  toggleHeat(visible: boolean) {
    this.heatVisible = visible;
    if (visible) this.heat.addTo(this.map);
    else this.heat.remove();
  }

  highlightPlace(id: string | null) {
    this.placeMarkers.forEach((m, key) => m.getElement()?.classList.toggle('selected', key === id));
  }

  showRoutes(routes: { participant: Participant; route: Route | null }[], target: LatLon) {
    this.routes.clearLayers();
    const bounds = L.latLngBounds([[target.lat, target.lon]]);
    for (const { participant, route } of routes) {
      if (!route) continue;
      for (const leg of route.legs) {
        if (leg.coords.length < 2) continue;
        const walk = leg.mode === 'WALK' || leg.mode === 'foot';
        L.polyline(leg.coords, { color: '#fff', weight: walk ? 5 : 8, opacity: 0.8 }).addTo(this.routes);
        L.polyline(leg.coords, {
          color: participant.color,
          weight: walk ? 3 : 5,
          opacity: 0.95,
          dashArray: walk ? '2 7' : undefined,
          lineCap: 'round',
        })
          .bindTooltip(`${esc(participant.name)} · ${esc(leg.label)} · ${formatMinutes(leg.minutes)}`, { sticky: true })
          .addTo(this.routes);
        leg.coords.forEach((c) => bounds.extend(c));
      }
    }
    this.map.fitBounds(bounds, { padding: [50, 50], maxZoom: 16 });
  }

  focus(p: LatLon) {
    this.map.setView([p.lat, p.lon], Math.max(this.map.getZoom(), 15));
  }

  invalidate() {
    this.map.invalidateSize();
  }
}

function cellSize(grid: Candidate[]): number {
  // Distance entre deux points voisins de la grille (en mètres).
  const a = L.latLng(grid[0].lat, grid[0].lon);
  const b = L.latLng(grid[1].lat, grid[1].lon);
  return a.distanceTo(b);
}

/** Dégradé vert → jaune → rouge. */
export function heatColor(t: number): string {
  const hue = (1 - Math.min(1, Math.max(0, t))) * 130;
  return `hsl(${hue.toFixed(0)}, 75%, 45%)`;
}

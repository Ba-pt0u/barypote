import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { addBasemap } from './basemap';
import { squareCorners } from './geo';
import { formatMinutes, stats } from './scoring';
import type { GridLayer, LatLon, Participant, Poi, Route, SearchResult } from './types';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export class MeetingMap {
  readonly map: L.Map;
  private people = L.layerGroup();
  private heat = L.layerGroup();
  private places = L.layerGroup();
  private routes = L.layerGroup();
  private zone = L.layerGroup();
  private placeMarkers = new Map<string, L.Marker>();
  private levels: L.FeatureGroup[] = [];
  private fairZone: L.Polygon | null = null;
  private zonePin: L.Marker | null = null;
  heatVisible = false;
  onPlaceClick: (id: string) => void = () => {};
  onParticipantMoved: (id: string, pos: LatLon) => void = () => {};

  constructor(el: HTMLElement) {
    this.map = L.map(el, { zoomControl: false, attributionControl: true }).setView([46.6, 2.4], 6);
    L.control.zoom({ position: 'topright' }).addTo(this.map);
    void addBasemap(this.map);
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
    this.levels = [];
    this.fairZone = null;
    this.zonePin = null;
  }

  /** Début d'une recherche : la grille s'affiche en direct, quel que soit l'état du bouton. */
  beginSearch() {
    this.clearResults();
    this.heat.addTo(this.map);
  }

  /** Ajoute une passe de la recherche ; les passes précédentes s'estompent. */
  addGridLayer(layer: GridLayer, participants: Participant[]) {
    for (const prev of this.levels) prev.setStyle({ fillOpacity: 0.12 });
    const group = L.featureGroup().addTo(this.heat);
    this.levels.push(group);
    // Le contour de la zone équitable reste visible au-dessus des cellules.
    queueMicrotask(() => this.fairZone?.bringToFront());
    const finite = layer.cells.filter((c) => Number.isFinite(c.score));
    const lo = Math.min(...finite.map((c) => c.score));
    const hi = Math.max(...finite.map((c) => c.score));
    layer.cells.forEach((c, i) => {
      const ok = Number.isFinite(c.score);
      const t = ok ? (c.score - lo) / (hi - lo || 1) : 1;
      const s = stats(c.times);
      const [sw, , ne] = squareCorners(c, layer.step);
      const rect = L.rectangle(
        [
          [sw.lat, sw.lon],
          [ne.lat, ne.lon],
        ],
        {
          stroke: false,
          fillColor: ok ? heatColor(t) : '#888',
          fillOpacity: ok ? 0.38 : 0.1,
          className: 'heat-cell',
        },
      )
        .bindTooltip(
          ok
            ? participants.map((p, k) => `${esc(p.name)} : ${formatMinutes(c.times[k])}`).join('<br>') +
                `<br><b>max ${formatMinutes(s.max)}</b>`
            : 'Trop loin pour quelqu’un',
          { sticky: true },
        )
        .addTo(group);
      // Apparition progressive des cellules, de proche en proche.
      (rect.getElement() as SVGElement | undefined)?.style.setProperty('animation-delay', `${i * 12}ms`);
    });
  }

  /** Zone équitable courante : polygone + point provisoire ; la caméra suit l'affinage. */
  showFairZone(hull: LatLon[], best: LatLon, level: number, participants: Participant[], fly = true) {
    const latlngs = hull.map((p) => [p.lat, p.lon] as [number, number]);
    if (this.fairZone) this.fairZone.setLatLngs(latlngs);
    else
      this.fairZone = L.polygon(latlngs, {
        color: '#5b3df5', // surchargée en CSS (.fair-zone) pour suivre le thème
        weight: 2.5,
        dashArray: '6 6',
        fillOpacity: 0.06,
        className: 'fair-zone',
        interactive: false,
      }).addTo(this.zone);
    if (this.zonePin) this.zonePin.setLatLng([best.lat, best.lon]);
    else
      this.zonePin = L.marker([best.lat, best.lon], {
        icon: L.divIcon({ className: '', html: '<div class="zone-pin"></div>', iconSize: [28, 28], iconAnchor: [14, 14] }),
        zIndexOffset: -100,
        interactive: false,
      }).addTo(this.zone);

    this.fairZone.bringToFront();
    if (!fly) return;
    const bounds = L.latLngBounds(latlngs.length ? latlngs : [[best.lat, best.lon]]);
    if (level === 0) participants.forEach((p) => p.pos && bounds.extend([p.pos.lat, p.pos.lon]));
    this.map.flyToBounds(bounds, { padding: [40, 40], maxZoom: 15, duration: 0.8 });
  }

  /** Lieux trouvés dans la zone, avant leur classement. */
  showCandidatePois(pois: Poi[]) {
    this.places.clearLayers();
    for (const p of pois)
      L.circleMarker([p.lat, p.lon], { radius: 3.5, weight: 1, color: '#fff', fillColor: '#7c6cf0', fillOpacity: 0.9, className: 'poi-dot' })
        .bindTooltip(esc(p.name))
        .addTo(this.places);
  }

  showResult(res: SearchResult, participants: Participant[]) {
    this.places.clearLayers();
    this.placeMarkers.clear();
    if (!this.heatVisible) this.heat.remove();
    this.showFairZone(res.hull, res.zone, 1, participants, false);

    res.places.forEach((c, i) => {
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

    const bounds = L.latLngBounds([[res.zone.lat, res.zone.lon]]);
    participants.forEach((p) => p.pos && bounds.extend([p.pos.lat, p.pos.lon]));
    res.places.forEach((c) => bounds.extend([c.lat, c.lon]));
    this.map.flyToBounds(bounds, { padding: [50, 50], maxZoom: 15, duration: 0.8 });
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

/** Dégradé vert → jaune → rouge. */
export function heatColor(t: number): string {
  const hue = (1 - Math.min(1, Math.max(0, t))) * 130;
  return `hsl(${hue.toFixed(0)}, 75%, 45%)`;
}

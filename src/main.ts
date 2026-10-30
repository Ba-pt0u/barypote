import './style.css';
import { reverseGeocode, searchPlaces, type Place } from './api/geocode';
import { route as roadRoute } from './api/osrm';
import { planTransit } from './api/transit';
import { CATEGORIES } from './categories';
import { findMeetingPoint } from './engine';
import { centroid } from './geo';
import { MeetingMap } from './map';
import { CRITERIA, formatMinutes, stats } from './scoring';
import { decodeState, encodeState, fromQuery, toQuery } from './share';
import type { Candidate, Criterion, LatLon, Mode, Participant, Route, SearchEvent, SearchResult, StepId } from './types';

const COLORS = ['#e4572e', '#2e86ab', '#8a4fff', '#17a398', '#f2a541', '#d7263d', '#3d5a80', '#43aa8b', '#b5179e', '#6c757d'];
const MAX_PEOPLE = 10;
const STORAGE_KEY = 'barypote:v1';

const MODES: { id: Mode; emoji: string; label: string }[] = [
  { id: 'car', emoji: '🚗', label: 'Voiture' },
  { id: 'transit', emoji: '🚇', label: 'Transports en commun' },
  { id: 'bike', emoji: '🚲', label: 'Vélo' },
  { id: 'foot', emoji: '🚶', label: 'À pied' },
];
const GMAPS_MODE: Record<Mode, string> = { car: 'driving', transit: 'transit', bike: 'bicycling', foot: 'walking' };

const $ = <T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = document) => root.querySelector(sel) as T;
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

// ---------------------------------------------------------------------------
// État
// ---------------------------------------------------------------------------

let seq = 0;
const newId = () => `p${Date.now().toString(36)}${seq++}`;

const state = {
  participants: [] as Participant[],
  category: 'bar',
  criterion: 'balanced' as Criterion,
  result: null as SearchResult | null,
  zoneLabel: '',
  selected: null as string | null,
  routes: new Map<string, { participant: Participant; route: Route | null }[]>(),
  picking: null as string | null,
  searching: false,
  /** Une recherche a été faite avec les critères actuels : le lien la relance. */
  ran: false,
};

function makeParticipant(partial: Partial<Participant> = {}): Participant {
  const used = new Set(state.participants.map((p) => p.color));
  const color = COLORS.find((c) => !used.has(c)) ?? COLORS[state.participants.length % COLORS.length];
  return {
    id: newId(),
    name: partial.name ?? `Personne ${state.participants.length + 1}`,
    label: partial.label ?? '',
    pos: partial.pos ?? null,
    mode: partial.mode ?? 'car',
    color,
  };
}

function currentQuery() {
  return toQuery({
    ...state,
    departure: departure.value,
    maxTime: Number(maxTime.value),
    parking: Number(parking.value),
    run: state.ran,
    selected: state.ran ? (state.selected ?? undefined) : undefined,
  });
}

/** Garde l'URL synchronisée avec la recherche : on peut la recharger ou l'envoyer telle quelle. */
function save({ criteriaChanged = true } = {}) {
  if (criteriaChanged) state.ran = false;
  history.replaceState(null, '', `${location.pathname}?${currentQuery()}`);
  try {
    localStorage.setItem(STORAGE_KEY, encodeState({ participants: state.participants, category: state.category, criterion: state.criterion }));
  } catch {
    /* stockage indisponible (navigation privée…) */
  }
}

function load() {
  let shared = fromQuery(location.search) ?? decodeState(location.hash);
  if (!shared) {
    try {
      shared = decodeState(localStorage.getItem(STORAGE_KEY) ?? '');
    } catch {
      shared = null;
    }
  }
  if (shared) {
    for (const p of shared.participants.slice(0, MAX_PEOPLE)) state.participants.push(makeParticipant(p));
    if (CATEGORIES.some((c) => c.id === shared!.category)) state.category = shared.category;
    if (CRITERIA.some((c) => c.id === shared!.criterion)) state.criterion = shared.criterion;
    if (shared.departure) departure.value = shared.departure;
    if (shared.maxTime != null) maxTime.value = String(shared.maxTime);
    if (shared.parking != null) parking.value = String(shared.parking);
  }
  while (state.participants.length < 2) state.participants.push(makeParticipant());
  return shared;
}

// ---------------------------------------------------------------------------
// Carte
// ---------------------------------------------------------------------------

const map = new MeetingMap($('#map'));
map.onPlaceClick = (id) => selectPlace(id);
map.onParticipantMoved = async (id, pos) => {
  const p = state.participants.find((x) => x.id === id);
  if (!p) return;
  p.pos = pos;
  p.label = 'Position choisie sur la carte';
  renderParticipants();
  p.label = await reverseGeocode(pos);
  participantsChanged();
};
map.map.on('click', async (e) => {
  if (!state.picking) return;
  const p = state.participants.find((x) => x.id === state.picking);
  setPicking(null);
  if (!p) return;
  p.pos = { lat: e.latlng.lat, lon: e.latlng.lng };
  p.label = 'Position choisie sur la carte';
  participantsChanged();
  p.label = await reverseGeocode(p.pos);
  participantsChanged();
});

function setPicking(id: string | null) {
  state.picking = id;
  const hint = $('#pick-hint');
  hint.hidden = !id;
  $('#map-wrap').classList.toggle('picking', !!id);
  if (id) $('b', hint).textContent = state.participants.find((p) => p.id === id)?.name ?? '';
}
$('#pick-cancel').addEventListener('click', () => setPicking(null));

// ---------------------------------------------------------------------------
// Participants
// ---------------------------------------------------------------------------

const list = $('#participants');

function participantsChanged(fit = false) {
  map.setParticipants(state.participants);
  if (fit) map.fitParticipants(state.participants);
  renderParticipants();
  save();
}

function renderParticipants() {
  const focused = document.activeElement as HTMLInputElement | null;
  const focusKey = focused?.closest('.participant') ? `${focused.closest<HTMLElement>('.participant')!.dataset.id}|${focused.className}` : null;
  const caret = focused?.selectionStart ?? null;

  list.innerHTML = state.participants
    .map(
      (p) => `
    <li class="participant" data-id="${p.id}" style="--c:${p.color}">
      <div class="p-top">
        <span class="dot" aria-hidden="true">${esc((p.name.trim()[0] ?? '?').toUpperCase())}</span>
        <input class="p-name" value="${esc(p.name)}" aria-label="Nom" maxlength="30" autocomplete="off" data-1p-ignore data-lpignore="true" data-bwignore data-form-type="other" />
        <div class="modes" role="radiogroup" aria-label="Mode de transport de ${esc(p.name)}">
          ${MODES.map(
            (m) =>
              `<button type="button" role="radio" aria-checked="${p.mode === m.id}" data-mode="${m.id}" title="${m.label}" aria-label="${m.label}">${m.emoji}</button>`,
          ).join('')}
        </div>
        <button type="button" class="icon remove" title="Retirer" aria-label="Retirer ${esc(p.name)}" ${state.participants.length <= 2 ? 'disabled' : ''}>✕</button>
      </div>
      <div class="addr">
        <input class="p-addr ${p.pos ? 'ok' : ''}" value="${esc(p.label)}" placeholder="Adresse, gare, quartier…" aria-label="Adresse de ${esc(p.name)}" autocomplete="off" data-1p-ignore data-lpignore="true" data-bwignore data-form-type="other" />
        <button type="button" class="icon locate" title="Ma position actuelle" aria-label="Utiliser ma position">◎</button>
        <button type="button" class="icon pick" title="Choisir sur la carte" aria-label="Choisir sur la carte">📍</button>
        <ul class="suggestions" role="listbox" hidden></ul>
      </div>
    </li>`,
    )
    .join('');
  $<HTMLButtonElement>('#add-participant').disabled = state.participants.length >= MAX_PEOPLE;

  if (focusKey) {
    const [id, cls] = focusKey.split('|');
    const el = list.querySelector<HTMLInputElement>(`[data-id="${id}"] input.${cls.split(' ')[0]}`);
    if (el) {
      el.focus();
      if (caret != null) el.setSelectionRange(caret, caret);
    }
  }
}

function participantOf(el: Element): Participant | undefined {
  const id = el.closest<HTMLElement>('.participant')?.dataset.id;
  return state.participants.find((p) => p.id === id);
}

list.addEventListener('click', (e) => {
  const target = e.target as HTMLElement;
  const p = participantOf(target);
  if (!p) return;
  const modeBtn = target.closest<HTMLElement>('[data-mode]');
  if (modeBtn) {
    p.mode = modeBtn.dataset.mode as Mode;
    participantsChanged();
  } else if (target.closest('.remove')) {
    state.participants = state.participants.filter((x) => x !== p);
    participantsChanged();
  } else if (target.closest('.pick')) {
    setPicking(p.id);
  } else if (target.closest('.locate')) {
    locate(p);
  } else {
    const li = target.closest<HTMLElement>('.suggestions li');
    if (li) choosePlace(p, suggestionsCache.get(p.id)?.[Number(li.dataset.i)]);
  }
});

list.addEventListener('input', (e) => {
  const input = e.target as HTMLInputElement;
  const p = participantOf(input);
  if (!p) return;
  if (input.classList.contains('p-name')) {
    p.name = input.value;
    const dot = input.parentElement!.querySelector('.dot')!;
    dot.textContent = (p.name.trim()[0] ?? '?').toUpperCase();
    map.setParticipants(state.participants);
    save();
  } else if (input.classList.contains('p-addr')) {
    p.label = input.value;
    if (p.pos) {
      p.pos = null;
      input.classList.remove('ok');
      map.setParticipants(state.participants);
    }
    suggest(p, input);
  }
});

list.addEventListener('keydown', (e) => {
  const input = e.target as HTMLInputElement;
  if (!input.classList.contains('p-addr')) return;
  const p = participantOf(input)!;
  const ul = input.parentElement!.querySelector<HTMLUListElement>('.suggestions')!;
  const items = [...ul.querySelectorAll<HTMLLIElement>('li[data-i]')];
  const cur = items.findIndex((li) => li.classList.contains('active'));
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    if (ul.hidden || !items.length) return;
    e.preventDefault();
    const next = (cur + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
    items.forEach((li, i) => li.classList.toggle('active', i === next));
  } else if (e.key === 'Enter') {
    e.preventDefault();
    const places = suggestionsCache.get(p.id);
    if (places?.length) choosePlace(p, places[Math.max(0, cur)]);
  } else if (e.key === 'Escape') {
    ul.hidden = true;
  }
});

list.addEventListener('focusout', (e) => {
  const input = e.target as HTMLElement;
  if (!input.classList.contains('p-addr')) return;
  // Laisse le temps au clic sur une suggestion d'être pris en compte.
  setTimeout(() => {
    const ul = input.parentElement?.querySelector<HTMLUListElement>('.suggestions');
    if (ul && !ul.contains(document.activeElement)) ul.hidden = true;
  }, 200);
});

const suggestionsCache = new Map<string, Place[]>();
const pending = new Map<string, { timer: number; ctrl?: AbortController }>();

function suggest(p: Participant, input: HTMLInputElement) {
  const ul = input.parentElement!.querySelector<HTMLUListElement>('.suggestions')!;
  const prev = pending.get(p.id);
  if (prev) {
    clearTimeout(prev.timer);
    prev.ctrl?.abort();
  }
  const q = input.value.trim();
  if (q.length < 3) {
    ul.hidden = true;
    return;
  }
  const entry: { timer: number; ctrl?: AbortController } = { timer: 0 };
  entry.timer = window.setTimeout(async () => {
    entry.ctrl = new AbortController();
    const others = state.participants.filter((x) => x.pos && x !== p).map((x) => x.pos!);
    const center = map.map.getCenter();
    const bias: LatLon = others.length ? centroid(others) : { lat: center.lat, lon: center.lng };
    try {
      const places = await searchPlaces(q, map.map.getZoom() > 7 || others.length ? bias : undefined, entry.ctrl.signal);
      suggestionsCache.set(p.id, places);
      ul.innerHTML = places.length
        ? places
            .map(
              (pl, i) =>
                `<li role="option" data-i="${i}" class="${i === 0 ? 'active' : ''}"><b>${esc(pl.label)}</b>${pl.detail ? `<small>${esc(pl.detail)}</small>` : ''}</li>`,
            )
            .join('')
        : '<li class="empty">Aucun résultat</li>';
      ul.hidden = false;
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      ul.innerHTML = `<li class="empty">Recherche d’adresse indisponible</li>`;
      ul.hidden = false;
    }
  }, 250);
  pending.set(p.id, entry);
}

function choosePlace(p: Participant, place: Place | undefined) {
  if (!place) return;
  p.pos = { lat: place.lat, lon: place.lon };
  p.label = place.label;
  suggestionsCache.delete(p.id);
  (document.activeElement as HTMLElement | null)?.blur();
  participantsChanged(true);
}

function locate(p: Participant) {
  // Les navigateurs n'autorisent la géolocalisation qu'en HTTPS (ou sur localhost).
  if (!window.isSecureContext) return toast('« Ma position » nécessite d’ouvrir l’appli en HTTPS.');
  if (!navigator.geolocation) return toast('La géolocalisation n’est pas disponible sur ce navigateur.');
  navigator.geolocation.getCurrentPosition(
    async (pos) => {
      p.pos = { lat: pos.coords.latitude, lon: pos.coords.longitude };
      p.label = 'Ma position';
      participantsChanged(true);
      p.label = await reverseGeocode(p.pos);
      participantsChanged();
    },
    () => toast('Impossible d’obtenir votre position.'),
    { enableHighAccuracy: true, timeout: 10000 },
  );
}

$('#add-participant').addEventListener('click', () => {
  if (state.participants.length >= MAX_PEOPLE) return;
  state.participants.push(makeParticipant());
  participantsChanged();
  list.querySelector<HTMLInputElement>('.participant:last-child .p-addr')?.focus();
});

$('#example').addEventListener('click', () => {
  state.participants = [];
  for (const p of [
    { name: 'Alice', label: 'Montmartre, Paris', pos: { lat: 48.8867, lon: 2.3431 }, mode: 'transit' as Mode },
    { name: 'Bastien', label: 'Vincennes', pos: { lat: 48.8474, lon: 2.4396 }, mode: 'car' as Mode },
    { name: 'Chloé', label: 'Boulogne-Billancourt', pos: { lat: 48.8353, lon: 2.2411 }, mode: 'transit' as Mode },
    { name: 'David', label: 'Place d’Italie, Paris', pos: { lat: 48.8313, lon: 2.3556 }, mode: 'bike' as Mode },
  ])
    state.participants.push(makeParticipant(p));
  participantsChanged(true);
});

// ---------------------------------------------------------------------------
// Catégories, critères, options
// ---------------------------------------------------------------------------

function renderChoices() {
  $('#categories').innerHTML = CATEGORIES.map(
    (c) =>
      `<button type="button" role="radio" aria-checked="${c.id === state.category}" data-cat="${c.id}"><span>${c.emoji}</span> ${c.label}</button>`,
  ).join('');
  $('#criteria').innerHTML = CRITERIA.map(
    (c) =>
      `<button type="button" role="radio" aria-checked="${c.id === state.criterion}" data-crit="${c.id}"><b>${c.label}</b><small>${c.help}</small></button>`,
  ).join('');
}

$('#categories').addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLElement>('[data-cat]');
  if (!b) return;
  state.category = b.dataset.cat!;
  renderChoices();
  save();
});
$('#criteria').addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLElement>('[data-crit]');
  if (!b) return;
  state.criterion = b.dataset.crit as Criterion;
  renderChoices();
  save();
});

const departure = $<HTMLInputElement>('#departure');
const maxTime = $<HTMLInputElement>('#max-time');
const parking = $<HTMLInputElement>('#parking');
{
  const d = new Date(Math.ceil(Date.now() / 900000) * 900000);
  const pad = (n: number) => String(n).padStart(2, '0');
  departure.value = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
const syncLabels = () => {
  $('#max-time-label').textContent = formatMinutes(Number(maxTime.value));
  $('#parking-label').textContent = `${parking.value} min`;
};
maxTime.addEventListener('input', syncLabels);
parking.addEventListener('input', syncLabels);
for (const el of [departure, maxTime, parking]) el.addEventListener('change', () => save());

$<HTMLInputElement>('#heat-toggle').addEventListener('change', (e) => map.toggleHeat((e.target as HTMLInputElement).checked));

// ---------------------------------------------------------------------------
// Recherche & résultats
// ---------------------------------------------------------------------------

const results = $('#results');
const searchBtn = $<HTMLButtonElement>('#search');

searchBtn.addEventListener('click', search);

async function search() {
  if (state.searching) return;
  const missing = state.participants.filter((p) => !p.pos);
  if (state.participants.length - missing.length < 2) {
    results.innerHTML = `<div class="error">Indiquez l’adresse d’au moins deux personnes (choisissez une suggestion dans la liste).</div>`;
    return;
  }
  state.searching = true;
  state.selected = null;
  state.routes.clear();
  searchBtn.disabled = true;
  map.beginSearch();
  const people = state.participants.filter((p) => p.pos);
  results.innerHTML = `<ol class="steps"></ol><div class="live-zone"></div>`;
  const steps = new Map<StepId, { state: string; label: string }>();
  const onEvent = (e: SearchEvent) => {
    switch (e.type) {
      case 'step':
        steps.set(e.id, { state: e.state, label: e.label });
        renderSteps(steps);
        break;
      case 'grid':
        map.addGridLayer(e.layer, people);
        break;
      case 'zone':
        map.showFairZone(e.hull, e.best, e.level, people);
        renderLiveZone(e.best, e.level, people);
        break;
      case 'pois':
        map.showCandidatePois(e.pois);
        break;
    }
  };
  try {
    const category = CATEGORIES.find((c) => c.id === state.category)!;
    const res = await findMeetingPoint(
      people,
      {
        criterion: state.criterion,
        category,
        departure: departure.value ? new Date(departure.value) : new Date(),
        maxTime: Number(maxTime.value),
        parking: Number(parking.value),
      },
      onEvent,
    );
    if (missing.length) res.warnings.unshift(`${missing.map((p) => p.name).join(', ')} : adresse manquante, ignoré(e)s.`);
    state.result = res;
    state.ran = true;
    save({ criteriaChanged: false });
    state.zoneLabel = '';
    renderResults(people);
    map.showResult(res, people);
    reverseGeocode(res.zone).then((label) => {
      state.zoneLabel = label;
      const el = results.querySelector('.zone-label');
      if (el) el.textContent = label;
    });
    if (res.places[0]?.poi && window.matchMedia('(min-width: 900px)').matches) selectPlace(res.places[0].poi.id);
  } catch (e) {
    console.error(e);
    results.innerHTML = `<div class="error">${esc((e as Error).message || 'Une erreur est survenue.')}</div>`;
  } finally {
    state.searching = false;
    searchBtn.disabled = false;
  }
}

function renderSteps(steps: Map<StepId, { state: string; label: string }>) {
  const ol = results.querySelector('.steps');
  if (!ol) return;
  ol.innerHTML = [...steps.values()]
    .map(
      ({ state: st, label }) =>
        `<li class="${st}">${st === 'active' ? '<span class="spinner"></span>' : st === 'done' ? '<span class="ok">✓</span>' : '<span class="ko">✕</span>'}${esc(label)}</li>`,
    )
    .join('');
}

/** Point provisoire, mis à jour à chaque niveau d'affinage. */
function renderLiveZone(best: Candidate, level: number, people: Participant[]) {
  const box = results.querySelector('.live-zone');
  if (!box) return;
  const scale = Math.max(...best.times.filter(Number.isFinite), 1);
  box.innerHTML = `<div class="zone-card live">
      <div class="zone-head"><span class="zone-icon">🎯</span><div><small>Zone équitable${level ? ` · affinage ${level}` : ''}</small><b>Meilleur point provisoire</b></div></div>
      ${timeBars(best, people, scale)}
      ${metaLine(best)}
    </div>`;
}

function timeBars(c: Candidate, people: Participant[], scale: number) {
  return `<ul class="bars">${people
    .map((p, i) => {
      const t = c.times[i];
      const w = Number.isFinite(t) ? Math.max(4, (t / scale) * 100) : 100;
      const mode = MODES.find((m) => m.id === p.mode)!;
      return `<li style="--c:${p.color}">
        <span class="who">${mode.emoji} ${esc(p.name)}</span>
        <span class="track"><span class="fill" style="width:${w.toFixed(1)}%"></span></span>
        <span class="t" data-pid="${p.id}">${c.estimated[i] && Number.isFinite(t) ? '≈ ' : ''}${formatMinutes(t)}</span>
      </li>`;
    })
    .join('')}</ul>`;
}

function metaLine(c: Candidate) {
  const s = stats(c.times);
  if (!Number.isFinite(s.max)) return '<span class="meta">Inaccessible pour quelqu’un</span>';
  return `<span class="meta">moyenne ${formatMinutes(s.mean)} · max ${formatMinutes(s.max)} · écart ${formatMinutes(s.gap)}</span>`;
}

function renderResults(people: Participant[]) {
  const res = state.result!;
  const all = [res.zone, ...res.places];
  const scale = Math.max(...all.flatMap((c) => c.times.filter(Number.isFinite)), 1);
  const category = CATEGORIES.find((c) => c.id === state.category)!;

  results.innerHTML = `
    ${res.warnings.map((w) => `<div class="warning">${esc(w)}</div>`).join('')}
    <div class="zone-card">
      <div class="zone-head"><span class="zone-icon">🎯</span><div><small>Point le plus équitable</small><b class="zone-label">${esc(state.zoneLabel || 'Recherche de l’adresse…')}</b></div></div>
      ${timeBars(res.zone, people, scale)}
      ${metaLine(res.zone)}
    </div>
    ${
      res.places.length
        ? `<h3>${category.emoji} Les meilleurs lieux · ${category.label.toLowerCase()}</h3>
           <ol class="places">${res.places.map((c, i) => placeCard(c, i, people, scale)).join('')}</ol>
           <p class="hint">≈ : temps estimé. Sélectionnez un lieu pour calculer les itinéraires exacts.</p>`
        : ''
    }`;
}

function placeCard(c: Candidate, i: number, people: Participant[], scale: number) {
  const poi = c.poi!;
  const addr = [poi.tags['addr:housenumber'], poi.tags['addr:street']].filter(Boolean).join(' ');
  const extras = [addr, poi.tags.opening_hours ? `🕒 ${poi.tags.opening_hours}` : ''].filter(Boolean);
  return `<li class="place${i === 0 ? ' best' : ''}" data-id="${poi.id}">
    <button type="button" class="place-head">
      <span class="rank">${i + 1}</span>
      <span class="place-title"><b>${esc(poi.name)}</b><small>${esc(poi.kind)}${extras.length ? ` · ${esc(extras.join(' · '))}` : ''}</small></span>
    </button>
    ${timeBars(c, people, scale)}
    ${metaLine(c)}
    <div class="route-details"></div>
    <div class="place-actions">
      <button type="button" class="ghost small copy">📋 Copier pour le groupe</button>
      ${/^(node|way|relation)\//.test(poi.id) ? `<a class="ghost small" target="_blank" rel="noopener" href="https://www.openstreetmap.org/${poi.id}">OpenStreetMap</a>` : ''}
      <a class="ghost small" target="_blank" rel="noopener" href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${poi.name} ${c.lat},${c.lon}`)}">Google Maps</a>
      ${poi.tags.website ? `<a class="ghost small" target="_blank" rel="noopener" href="${esc(safeUrl(poi.tags.website))}">Site web</a>` : ''}
    </div>
  </li>`;
}

function safeUrl(url: string) {
  const u = /^https?:\/\//i.test(url) ? url : `https://${url}`;
  try {
    return new URL(u).href;
  } catch {
    return '#';
  }
}

results.addEventListener('click', (e) => {
  const target = e.target as HTMLElement;
  const card = target.closest<HTMLElement>('.place');
  if (!card) return;
  if (target.closest('.copy')) return copySummary(card.dataset.id!);
  if (target.closest('a')) return;
  selectPlace(card.dataset.id!);
});

async function selectPlace(id: string) {
  const res = state.result;
  const c = res?.places.find((x) => x.poi?.id === id);
  if (!res || !c) return;
  state.selected = id;
  if (state.ran) save({ criteriaChanged: false });
  results.querySelectorAll('.place').forEach((el) => el.classList.toggle('selected', (el as HTMLElement).dataset.id === id));
  map.highlightPlace(id);
  const card = results.querySelector<HTMLElement>(`.place[data-id="${CSS.escape(id)}"]`);
  card?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  const people = state.participants.filter((p) => p.pos);
  const box = card?.querySelector<HTMLElement>('.route-details');

  let routes = state.routes.get(id);
  if (!routes) {
    if (box) box.innerHTML = `<div class="progress small"><span class="spinner"></span>Calcul des itinéraires…</div>`;
    const when = departure.value ? new Date(departure.value) : new Date();
    const extra = Number(parking.value);
    routes = await Promise.all(
      people.map(async (p) => {
        try {
          const r =
            p.mode === 'transit' ? await planTransit(p.pos!, c, when) : await roadRoute(p.mode, p.pos!, c);
          if (r && p.mode === 'car' && extra) r.minutes += extra;
          return { participant: p, route: r };
        } catch (err) {
          console.warn(err);
          return { participant: p, route: null };
        }
      }),
    );
    state.routes.set(id, routes);
  }
  if (state.selected !== id) return;
  map.showRoutes(routes, c);
  if (box) box.innerHTML = routeDetails(routes, c);
  // Remplace les estimations par les temps exacts.
  routes.forEach(({ participant, route }) => {
    const t = card?.querySelector(`.t[data-pid="${participant.id}"]`);
    if (t && route) t.textContent = formatMinutes(route.minutes);
  });
}

function routeDetails(routes: { participant: Participant; route: Route | null }[], dest: LatLon) {
  return `<ul class="routes">${routes
    .map(({ participant: p, route }) => {
      const g = `https://www.google.com/maps/dir/?api=1&origin=${p.pos!.lat},${p.pos!.lon}&destination=${dest.lat},${dest.lon}&travelmode=${GMAPS_MODE[p.mode]}`;
      return `<li style="--c:${p.color}"><span class="dot small">${esc((p.name.trim()[0] ?? '?').toUpperCase())}</span>
        <span>${route ? `<b>${formatMinutes(route.minutes)}</b> · ${esc(route.summary)}` : 'Itinéraire indisponible'}</span>
        <a href="${g}" target="_blank" rel="noopener" title="Ouvrir l’itinéraire dans Google Maps">↗</a></li>`;
    })
    .join('')}</ul>`;
}

async function copySummary(id: string) {
  const c = state.result?.places.find((x) => x.poi?.id === id);
  if (!c?.poi) return;
  const people = state.participants.filter((p) => p.pos);
  const routes = state.routes.get(id);
  const addr = [c.poi.tags['addr:housenumber'], c.poi.tags['addr:street'], c.poi.tags['addr:city']].filter(Boolean).join(' ');
  const lines = [
    `📍 On se retrouve à ${c.poi.name} (${c.poi.kind})${addr ? `, ${addr}` : ''}`,
    ...people.map((p, i) => {
      const r = routes?.find((x) => x.participant.id === p.id)?.route;
      const mode = MODES.find((m) => m.id === p.mode)!;
      return `${mode.emoji} ${p.name} : ${formatMinutes(r?.minutes ?? c.times[i])}`;
    }),
    `🗺️ https://www.openstreetmap.org/?mlat=${c.lat.toFixed(5)}&mlon=${c.lon.toFixed(5)}#map=18/${c.lat.toFixed(5)}/${c.lon.toFixed(5)}`,
  ];
  await copy(lines.join('\n'), 'Résumé copié, il n’y a plus qu’à le coller dans la conversation du groupe !');
}

async function copy(text: string, okMsg: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast(okMsg);
  } catch {
    window.prompt('Copiez ce texte :', text);
  }
}

$('#share').addEventListener('click', () => {
  save({ criteriaChanged: false });
  const url = location.href;
  if (navigator.share && matchMedia('(pointer: coarse)').matches) {
    navigator.share({ title: 'Barypote', text: 'Où se retrouve-t-on ?', url }).catch(() => {});
  } else copy(
      url,
      state.ran
        ? 'Lien copié : en l’ouvrant, chacun retrouve la même recherche et ses résultats.'
        : 'Lien copié : envoyez-le au groupe, chacun verra les mêmes participants et critères.',
    );
});

let toastTimer = 0;
function toast(msg: string) {
  let el = document.querySelector<HTMLElement>('.toast');
  if (!el) {
    el = document.createElement('div');
    el.className = 'toast';
    el.setAttribute('role', 'status');
    document.body.append(el);
  }
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el!.classList.remove('show'), 3500);
}

// ---------------------------------------------------------------------------

const initial = load();
syncLabels();
renderChoices();
participantsChanged(true);
if (initial?.run)
  search().then(() => {
    if (initial.selected && state.result?.places.some((c) => c.poi?.id === initial.selected)) selectPlace(initial.selected);
  });
window.addEventListener('resize', () => map.invalidate());

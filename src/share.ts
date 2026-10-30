import type { Criterion, Mode, Participant } from './types';

export interface SharedState {
  participants: Pick<Participant, 'name' | 'label' | 'pos' | 'mode'>[];
  category: string;
  criterion: Criterion;
  /** Heure de départ, au format local AAAA-MM-JJTHH:MM. */
  departure?: string;
  maxTime?: number;
  parking?: number;
  /** Lancer la recherche à l'ouverture du lien. */
  run?: boolean;
  /** Lieu sélectionné dans les résultats. */
  selected?: string;
}

/** Noms des modes dans l'URL, lisibles et sans accent. */
const MODE_PARAM: Record<Mode, string> = { car: 'voiture', transit: 'tc', bike: 'velo', foot: 'pied' };

/**
 * Paramètres d'URL lisibles, par exemple :
 * ?p=Alice;48.8867,2.3431;tc;Montmartre&p=Bob;48.8474,2.4396;voiture;Vincennes&lieu=bar&critere=minimax
 *  &depart=2026-11-07T19:00&max=90&parking=5&lancer=1&choix=node/123
 */
export function toQuery(s: SharedState): string {
  const q = new URLSearchParams();
  for (const p of s.participants) {
    const pos = p.pos ? `${p.pos.lat.toFixed(5)},${p.pos.lon.toFixed(5)}` : '';
    q.append('p', [p.name.replace(/;/g, ','), pos, MODE_PARAM[p.mode], p.label].join(';'));
  }
  q.set('lieu', s.category);
  q.set('critere', s.criterion);
  if (s.departure) q.set('depart', s.departure);
  if (s.maxTime != null) q.set('max', String(s.maxTime));
  if (s.parking != null) q.set('parking', String(s.parking));
  if (s.run) q.set('lancer', '1');
  if (s.selected) q.set('choix', s.selected);
  return q.toString().replace(/%3B/g, ';').replace(/%2C/g, ',').replace(/%2F/g, '/').replace(/%3A/g, ':');
}

export function fromQuery(search: string): SharedState | null {
  const q = new URLSearchParams(search);
  const ps = q.getAll('p');
  if (!ps.length) return null;
  const modeOf = (v: string) => (Object.entries(MODE_PARAM).find(([, name]) => name === v)?.[0] as Mode) ?? 'car';
  const num = (v: string | null) => (v != null && v !== '' && Number.isFinite(Number(v)) ? Number(v) : undefined);
  return {
    participants: ps.map((raw) => {
      const [name = '', coords = '', mode = '', ...label] = raw.split(';');
      const [lat, lon] = coords.split(',').map(Number);
      const ok = coords && Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
      return { name, label: label.join(';'), pos: ok ? { lat, lon } : null, mode: modeOf(mode) };
    }),
    category: q.get('lieu') ?? 'bar',
    criterion: (q.get('critere') as Criterion) ?? 'balanced',
    departure: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(q.get('depart') ?? '') ? q.get('depart')! : undefined,
    maxTime: num(q.get('max')),
    parking: num(q.get('parking')),
    run: q.get('lancer') === '1',
    selected: q.get('choix') ?? undefined,
  };
}

const MODES: Mode[] = ['car', 'transit', 'bike', 'foot'];

/** Ancien format (fragment base64), conservé pour le stockage local et les liens déjà partagés. */
export function encodeState(s: SharedState): string {
  const compact = {
    p: s.participants.map((p) => [
      p.name,
      p.label,
      p.pos ? +p.pos.lat.toFixed(5) : null,
      p.pos ? +p.pos.lon.toFixed(5) : null,
      MODES.indexOf(p.mode),
    ]),
    c: s.category,
    k: s.criterion,
  };
  const bytes = new TextEncoder().encode(JSON.stringify(compact));
  let bin = '';
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function decodeState(hash: string): SharedState | null {
  try {
    const b64 = hash.replace(/^#/, '').replace(/-/g, '+').replace(/_/g, '/');
    if (!b64) return null;
    const bin = atob(b64);
    const json = new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
    const c = JSON.parse(json) as { p: [string, string, number | null, number | null, number][]; c: string; k: Criterion };
    return {
      participants: c.p.map(([name, label, lat, lon, m]) => ({
        name: String(name ?? ''),
        label: String(label ?? ''),
        pos: lat != null && lon != null ? { lat, lon } : null,
        mode: MODES[m] ?? 'car',
      })),
      category: c.c,
      criterion: c.k,
    };
  } catch {
    return null;
  }
}

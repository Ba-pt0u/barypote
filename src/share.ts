import type { Criterion, Mode, Participant } from './types';

export interface SharedState {
  participants: Pick<Participant, 'name' | 'label' | 'pos' | 'mode'>[];
  category: string;
  criterion: Criterion;
}

const MODES: Mode[] = ['car', 'transit', 'bike', 'foot'];

/** Encode l'état dans le fragment d'URL : le lien peut être envoyé au groupe tel quel. */
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

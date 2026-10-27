import type { Criterion } from './types';

export const CRITERIA: { id: Criterion; label: string; help: string }[] = [
  {
    id: 'balanced',
    label: 'Équilibré',
    help: 'Temps moyen + écart-type : rapide pour le groupe, sans laisser personne de côté.',
  },
  {
    id: 'minimax',
    label: 'Personne ne galère',
    help: 'Minimise le trajet le plus long : idéal quand quelqu’un habite loin.',
  },
  {
    id: 'total',
    label: 'Total minimal',
    help: 'Minimise la somme des trajets, même si certains font plus de route.',
  },
];

export function stats(times: number[]) {
  const n = times.length;
  const mean = times.reduce((s, t) => s + t, 0) / n;
  const std = Math.sqrt(times.reduce((s, t) => s + (t - mean) ** 2, 0) / n);
  const max = Math.max(...times);
  const min = Math.min(...times);
  return { mean, std, max, min, gap: max - min, total: mean * n };
}

/**
 * Score d'un lieu (plus bas = meilleur). Un participant injoignable, ou dont le trajet dépasse
 * `maxTime`, rend le lieu inéligible (Infinity).
 */
export function score(times: number[], criterion: Criterion, maxTime = Infinity): number {
  if (!times.length || times.some((t) => !Number.isFinite(t) || t > maxTime)) return Infinity;
  const s = stats(times);
  switch (criterion) {
    case 'minimax':
      // Départage les ex æquo par la moyenne.
      return s.max + s.mean * 0.01;
    case 'total':
      return s.mean + s.max * 0.001;
    case 'balanced':
    default:
      return s.mean + s.std;
  }
}

export function formatMinutes(min: number): string {
  if (!Number.isFinite(min)) return '—';
  const m = Math.round(min);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h} h ${String(r).padStart(2, '0')}` : `${h} h`;
}

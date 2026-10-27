import { describe, expect, it } from 'vitest';
import { formatMinutes, score, stats } from '../src/scoring';

describe('scoring', () => {
  it('stats', () => {
    const s = stats([10, 20, 30]);
    expect(s.mean).toBe(20);
    expect(s.max).toBe(30);
    expect(s.gap).toBe(20);
  });

  it('minimax préfère le lieu où personne ne fait un long trajet', () => {
    const fair = [25, 25, 25];
    const unfair = [5, 5, 40];
    expect(score(fair, 'minimax')).toBeLessThan(score(unfair, 'minimax'));
    // …alors que le total minimal préfère l'autre.
    expect(score(unfair, 'total')).toBeLessThan(score(fair, 'total'));
  });

  it('équilibré pénalise la dispersion', () => {
    expect(score([20, 20], 'balanced')).toBeLessThan(score([10, 30], 'balanced'));
  });

  it('inaccessible ou au-delà du max → Infinity', () => {
    expect(score([10, Infinity], 'balanced')).toBe(Infinity);
    expect(score([10, 50], 'balanced', 45)).toBe(Infinity);
  });

  it('formatMinutes', () => {
    expect(formatMinutes(7.4)).toBe('7 min');
    expect(formatMinutes(60)).toBe('1 h');
    expect(formatMinutes(95)).toBe('1 h 35');
    expect(formatMinutes(Infinity)).toBe('—');
  });
});

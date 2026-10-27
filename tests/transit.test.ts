import { describe, expect, it } from 'vitest';
import { TransitReach, walkMinutes } from '../src/api/transit';
import { offset } from '../src/geo';

describe('TransitReach', () => {
  const origin = { lat: 48.85, lon: 2.35 };
  const far = offset(origin, 10000, 0);
  const stop = { ...far, name: 'Arrêt', minutes: 20 };

  it('arrêt proche + marche', () => {
    const r = new TransitReach(origin, [stop]);
    const p = offset(far, 300, 0);
    expect(r.minutesTo(p)).toBeCloseTo(20 + walkMinutes(far, p), 5);
  });

  it('trop loin de tout arrêt → injoignable', () => {
    const r = new TransitReach(origin, [stop]);
    expect(r.minutesTo(offset(far, 0, 5000))).toBe(Infinity);
  });

  it('à proximité du départ, la marche directe est possible', () => {
    const r = new TransitReach(origin, [stop]);
    expect(r.minutesTo(offset(origin, 400, 0))).toBeLessThan(10);
  });
});

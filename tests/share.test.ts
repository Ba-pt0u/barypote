import { describe, expect, it } from 'vitest';
import { parseCoords } from '../src/api/geocode';
import { decodeState, encodeState } from '../src/share';

describe('lien de partage', () => {
  it('aller-retour, accents compris', () => {
    const s = {
      participants: [
        { name: 'Chloé', label: 'Gare de l’Est', pos: { lat: 48.87654, lon: 2.35912 }, mode: 'transit' as const },
        { name: 'Bob', label: '', pos: null, mode: 'bike' as const },
      ],
      category: 'restaurant',
      criterion: 'minimax' as const,
    };
    const back = decodeState('#' + encodeState(s));
    expect(back).toEqual(s);
  });

  it('fragment invalide → null', () => {
    expect(decodeState('#pas-du-base64!')).toBeNull();
    expect(decodeState('')).toBeNull();
  });

  it('coordonnées saisies à la main', () => {
    expect(parseCoords('48.8566, 2.3522')).toEqual({ lat: 48.8566, lon: 2.3522 });
    expect(parseCoords('45.76 4.83')).toEqual({ lat: 45.76, lon: 4.83 });
    expect(parseCoords('12 rue de la Paix')).toBeNull();
  });
});

describe('paramètres d’URL', () => {
  it('aller-retour lisible', async () => {
    const { fromQuery, toQuery } = await import('../src/share');
    const s = {
      participants: [
        { name: 'Chloé', label: 'Gare de l’Est; quai 3', pos: { lat: 48.87654, lon: 2.35912 }, mode: 'transit' as const },
        { name: 'Bob', label: '', pos: null, mode: 'bike' as const },
      ],
      category: 'restaurant',
      criterion: 'minimax' as const,
      departure: '2026-11-07T19:00',
      maxTime: 75,
      parking: 8,
      run: true,
      selected: 'node/42',
    };
    const q = toQuery(s);
    expect(q).toContain('p=Chlo%C3%A9;48.87654,2.35912;tc;');
    expect(q).toContain('depart=2026-11-07T19:00');
    expect(fromQuery('?' + q)).toEqual(s);
  });

  it('valeurs invalides ignorées', async () => {
    const { fromQuery } = await import('../src/share');
    const s = fromQuery('?p=A;999,2;fusee;X&max=abc&depart=demain');
    expect(s?.participants[0]).toEqual({ name: 'A', label: 'X', pos: null, mode: 'car' });
    expect(s?.maxTime).toBeUndefined();
    expect(s?.departure).toBeUndefined();
    expect(fromQuery('?lieu=bar')).toBeNull();
  });
});

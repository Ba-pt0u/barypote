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

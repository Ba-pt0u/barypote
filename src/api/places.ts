import { getConfig } from '../config';
import type { Category, Poi } from '../types';
import { findPoisGeoapify } from './geoapify';
import { findPoisOverpass, type Area } from './overpass';

export type { Area };

/** Lieux de la catégorie : Geoapify si une clé est configurée sur le serveur, sinon (ou en secours) Overpass. */
export async function findPois(category: Category, areas: { area: Area; limit: number }[]): Promise<Poi[]> {
  const { places } = await getConfig();
  if (places === 'geoapify') {
    try {
      return await findPoisGeoapify(category, areas);
    } catch (e) {
      console.warn('Geoapify indisponible, repli sur Overpass :', e);
    }
  }
  return findPoisOverpass(category, areas);
}

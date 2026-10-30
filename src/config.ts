/**
 * Configuration fournie par le serveur (image Docker) dans `config.json`.
 * Absente (développement, GitHub Pages) : services publics sans clé.
 */
export interface AppConfig {
  /** Fournisseur des lieux : Geoapify (clé configurée sur le serveur) ou Overpass. */
  places: 'geoapify' | 'overpass';
}

let loaded: Promise<AppConfig> | null = null;

export function getConfig(): Promise<AppConfig> {
  loaded ??= fetch('./config.json', { cache: 'no-store' })
    .then((r) => (r.ok ? r.json() : {}))
    .catch(() => ({}))
    .then((c: Partial<AppConfig>) => ({ places: c.places === 'geoapify' ? 'geoapify' : 'overpass' }));
  return loaded;
}

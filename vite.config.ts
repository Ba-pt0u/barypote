import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Chemins relatifs : l'appli fonctionne sur GitHub Pages (sous-dossier) comme en local.
  base: './',
  test: {
    environment: 'node',
  },
});

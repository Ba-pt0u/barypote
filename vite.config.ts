import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Chemins relatifs : l'appli fonctionne sur GitHub Pages (sous-dossier) comme en local.
  base: './',
  // MapLibre (rendu vectoriel) est volumineux mais chargé à la demande, dans son propre fichier.
  build: { chunkSizeWarningLimit: 1200 },
  test: {
    environment: 'node',
  },
});

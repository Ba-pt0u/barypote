# 🎯 Barypote

**Le point de rencontre le plus équitable pour tout le groupe.**

Chacun indique d’où il part et comment il se déplace (🚗 voiture, 🚇 transports en commun, 🚲 vélo, 🚶 à pied) ;
Barypote cherche la zone où les temps de trajet sont les plus justes, puis propose les meilleurs bars,
restaurants, cafés… autour, classés selon le critère d’équité choisi.

## Fonctionnalités

- **Jusqu’à 10 personnes**, chacune avec **son propre mode de transport** (on peut mélanger voiture, métro, vélo…).
- **Vrais temps de trajet** (pas de simple milieu géographique) : itinéraires routiers OSRM et transports en commun Transitous.
- **Trois définitions de l’équité** :
  - *Équilibré* : moyenne + écart-type (rapide pour le groupe sans laisser personne de côté) ;
  - *Personne ne galère* : minimise le trajet le plus long ;
  - *Total minimal* : minimise la somme des trajets.
- **Types de lieux** : bar, restaurant, café, sur le pouce, activité (bowling, escape game, ciné…), culture, parc, gare, ou juste le point.
- **Carte** avec le départ de chacun (marqueurs déplaçables), le point idéal, les lieux numérotés et, au clic, **les itinéraires de chacun** (lignes de métro/bus détaillées).
- **Carte d’équité** : une couche de chaleur montre les zones justes (vert) et injustes (rouge).
- **Lien de partage** : tout le groupe (adresses, modes, préférences) tient dans l’URL, à envoyer dans la conversation.
- **Résumé copiable** (« On se retrouve à… ») avec le temps de trajet de chacun.
- Options : heure de départ (horaires de transports), trajet maximal accepté, temps pour se garer.
- Saisie par adresse (autocomplétion), coordonnées, géolocalisation ou clic sur la carte. Thème sombre, mobile.

## Comment ça marche

1. **Transports en commun** : pour chaque usager, un seul appel Transitous *one-to-all* renvoie tous les arrêts
   atteignables et leur temps d’accès ; le temps vers n’importe quel point = meilleur arrêt proche + marche.
2. **Recherche de la zone** : une grille de 7×7 points couvrant le groupe (plus les arrêts accessibles à tous et
   les domiciles) est évaluée d’un coup via les matrices OSRM, puis la meilleure zone est affinée sur une grille plus fine.
3. **Lieux** : les établissements OpenStreetMap (Overpass) autour du point sont évalués de la même façon et classés.
4. **Itinéraires exacts** calculés à la sélection d’un lieu (les temps marqués « ≈ » sont des estimations).

Tout tourne dans le navigateur, **sans clé d’API ni serveur** :

| Besoin | Service (gratuit, données ouvertes) |
| --- | --- |
| Adresses | [Photon](https://photon.komoot.io) (OpenStreetMap) |
| Voiture, vélo, marche | [OSRM FOSSGIS](https://routing.openstreetmap.de), secours [OSRM démo](https://project-osrm.org) |
| Transports en commun | [Transitous](https://transitous.org) (MOTIS, données GTFS ouvertes) |
| Lieux | [Overpass API](https://overpass-api.de) (OpenStreetMap) |
| Fond de carte | [CARTO](https://carto.com/attributions) / OpenStreetMap |

Ce sont des services communautaires : merci de ne pas les solliciter de façon automatisée. Si l’un d’eux ne répond
pas, Barypote bascule sur une estimation et l’indique.

## Développement

```bash
npm install
npm run dev        # serveur de dev
npm test           # tests unitaires (Vitest)
npm run build      # build de production dans dist/
npm run e2e        # test navigateur (Playwright/Chromium), API simulées, après un build
```

Code : `src/engine.ts` (algorithme), `src/api/` (services externes), `src/map.ts` (carte Leaflet), `src/main.ts` (interface).

## Déploiement

Le workflow `.github/workflows/deploy.yml` teste, construit et publie sur **GitHub Pages** à chaque push sur `main`.
À activer une fois : *Settings → Pages → Build and deployment → Source : GitHub Actions*.

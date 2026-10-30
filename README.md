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
- **Recherche en direct** : la grille d’équité s’affiche dès les premiers calculs, la **zone équitable** (contour
  pointillé) se resserre à chaque niveau d’affinage, et les lieux de cette zone sont cherchés en parallèle.
- **Carte d’équité** : une couche de chaleur montre les zones justes (vert) et injustes (rouge).
- **Recherche dans l’URL** : participants, critères et options sont des paramètres lisibles ; après une recherche,
  le lien la relance à l’ouverture et resélectionne le lieu choisi (voir plus bas).
- **Résumé copiable** (« On se retrouve à… ») avec le temps de trajet de chacun.
- Options : heure de départ (horaires de transports), trajet maximal accepté, temps pour se garer.
- Saisie par adresse (autocomplétion), coordonnées, géolocalisation ou clic sur la carte. Thème sombre, mobile.

## Comment ça marche

1. **Transports en commun** : pour chaque usager, un seul appel Transitous *one-to-all* renvoie tous les arrêts
   atteignables et leur temps d’accès ; le temps vers n’importe quel point = meilleur arrêt proche + marche.
2. **Recherche de la zone** : une grille de 7×7 points couvrant le groupe (plus les arrêts accessibles à tous et
   les domiciles) est évaluée d’un coup via les matrices OSRM. Les cellules proches du meilleur score forment la
   zone équitable, affinée ensuite jusqu’à 3 fois sur des grilles 5×5 de plus en plus fines.
3. **Lieux** : dès la première zone connue, deux requêtes Overpass partent en parallèle (dans tout le polygone de la
   zone, et au plus près du meilleur point) ; les lieux trouvés sont ensuite évalués et classés sur temps réels.
4. **Itinéraires exacts** calculés à la sélection d’un lieu (les temps marqués « ≈ » sont des estimations).

Tout tourne dans le navigateur, **sans clé d’API ni serveur** :

| Besoin | Service (gratuit, données ouvertes) |
| --- | --- |
| Adresses | [Photon](https://photon.komoot.io) (OpenStreetMap) |
| Voiture, vélo, marche | [OSRM FOSSGIS](https://routing.openstreetmap.de), secours [OSRM démo](https://project-osrm.org) |
| Transports en commun | [Transitous](https://transitous.org) (MOTIS, données GTFS ouvertes) |
| Lieux | [Overpass API](https://overpass-api.de) (OpenStreetMap), ou [Geoapify](https://www.geoapify.com) avec une clé (voir plus bas) |
| Fond de carte | [OpenFreeMap](https://openfreemap.org) (vectoriel, sans clé), secours [OpenStreetMap](https://www.openstreetmap.org) |

Ce sont des services communautaires : merci de ne pas les solliciter de façon automatisée. Si l’un d’eux ne répond
pas, Barypote bascule sur une estimation et l’indique.

## Paramètres d’URL

L’URL suit la recherche en cours : la recharger ou l’envoyer reproduit la même recherche.

| Paramètre | Exemple | Rôle |
| --- | --- | --- |
| `p` (répété) | `Alice;48.88670,2.34310;tc;Montmartre` | nom ; latitude,longitude ; mode (`voiture`, `tc`, `velo`, `pied`) ; libellé |
| `lieu` | `bar` | `bar`, `restaurant`, `cafe`, `fastfood`, `fun`, `culture`, `park`, `station`, `none` |
| `critere` | `minimax` | `balanced` (équilibré), `minimax` (personne ne galère), `total` |
| `depart` | `2026-11-07T19:00` | date et heure de départ (heure locale) |
| `max` | `90` | trajet maximal pour chacun, en minutes |
| `parking` | `5` | minutes ajoutées aux trajets en voiture |
| `lancer` | `1` | lance la recherche à l’ouverture |
| `choix` | `node/123` | lieu à sélectionner dans les résultats |

Exemple : `?p=Alice;48.8867,2.3431;tc;Montmartre&p=Bob;48.8474,2.4396;voiture;Vincennes&lieu=bar&critere=minimax&lancer=1`

## Développement

```bash
npm install
npm run dev        # serveur de dev
npm test           # tests unitaires (Vitest)
npm run build      # build de production dans dist/
npm run e2e        # test navigateur (Playwright/Chromium), API simulées, après un build
```

Code : `src/engine.ts` (algorithme), `src/api/` (services externes), `src/map.ts` (carte Leaflet), `src/main.ts` (interface).

## Auto-hébergement avec Docker (Unraid, Synology, etc.)

L’image est un simple serveur nginx (~75 Mo) qui sert l’appli : rien à configurer, aucune donnée stockée.
C’est le **navigateur** des utilisateurs qui interroge les services cartographiques, le NAS n’a pas besoin d’accès Internet.
Elle est publiée automatiquement sur `ghcr.io/ba-pt0u/barypote:latest` (amd64 et arm64) à chaque push sur `main`.

> **Une fois après la première publication**, rendre l’image publique pour que le NAS puisse la télécharger sans
> identifiants : GitHub → profil → *Packages* → `barypote` → *Package settings* → *Change visibility* → *Public*.

### Unraid

**Option A, modèle de conteneur (le plus simple)**

1. Dans un terminal Unraid, récupérer le modèle :
   ```bash
   wget -O /boot/config/plugins/dockerMan/templates-user/my-barypote.xml \
     https://raw.githubusercontent.com/Ba-pt0u/barypote/main/unraid/barypote.xml
   ```
2. Onglet *Docker* → *Add Container* → *Template* : choisir **barypote**.
3. Ajuster le port si 8080 est déjà pris → *Apply*.
4. Ouvrir `http://IP-DU-NAS:8080` (ou *WebUI* dans le menu du conteneur).

**Option B, à la main** : *Add Container*, puis *Repository* = `ghcr.io/ba-pt0u/barypote:latest`,
*Add another Path, Port…* → *Port*, *Container Port* = `80`, *Host Port* = `8080`.

**Option C, Docker Compose** (plugin *Docker Compose Manager*) : utiliser le fichier `docker-compose.yml` du dépôt.

Mises à jour : *Check for Updates* dans l’onglet *Docker* récupère la dernière image.

### Ailleurs

```bash
docker run -d --name barypote -p 8080:80 --restart unless-stopped ghcr.io/ba-pt0u/barypote:latest
# ou, pour construire depuis le code :
docker build -t barypote . && docker run -d -p 8080:80 barypote
```

### Clé Geoapify (recommandée)

Les serveurs Overpass publics sont parfois saturés (« Recherche de lieux impossible »). Avec une clé
[Geoapify](https://www.geoapify.com) gratuite (3 000 crédits par jour, largement assez pour un usage entre amis),
les lieux viennent de son API Places, qui s’appuie sur les mêmes données OpenStreetMap.

1. Créer un compte et un projet sur <https://myprojects.geoapify.com>, copier la clé API.
2. La renseigner dans la variable `GEOAPIFY_API_KEY` du conteneur (champ *Clé API Geoapify* du modèle Unraid,
   ou `-e GEOAPIFY_API_KEY=…`), puis redémarrer.

La clé reste sur le serveur : le navigateur interroge `/api/geoapify/places` et nginx ajoute la clé (débit limité à
5 requêtes/s par visiteur). En cas d’échec de Geoapify, l’appli repasse automatiquement par Overpass.
Le journal du conteneur indique au démarrage le fournisseur utilisé.

### HTTPS (recommandé)

En simple `http://` sur le réseau local, tout fonctionne sauf **« Ma position »** (les navigateurs réservent la
géolocalisation au HTTPS) ; la copie du lien passe alors par une fenêtre à copier à la main. Pour en profiter
et ouvrir l’appli depuis l’extérieur, la placer derrière un reverse proxy avec certificat
(Nginx Proxy Manager, SWAG, Traefik, Caddy…) pointant vers `http://IP-DU-NAS:8080`.

## GitHub Pages

Le workflow `.github/workflows/deploy.yml` peut aussi publier l’appli sur **GitHub Pages** à chaque push sur `main`.
Pour l’activer : *Settings → Pages → Build and deployment → Source : GitHub Actions*, puis
*Settings → Secrets and variables → Actions → Variables* : créer `DEPLOY_PAGES` = `true`.

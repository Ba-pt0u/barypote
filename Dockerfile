# Étape 1 : tests et build de l'appli statique.
# L'étape tourne sur l'architecture de la machine de build : son résultat (HTML/JS/CSS) ne dépend pas de la cible.
FROM --platform=$BUILDPLATFORM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm test && npm run build

# Étape 2 : simple serveur nginx, aucune donnée stockée ; clé d'API facultative.
FROM nginx:1.27-alpine
# Clé Geoapify facultative (lieux plus fiables qu'Overpass) : docker run -e GEOAPIFY_API_KEY=...
ENV GEOAPIFY_API_KEY="" \
    NGINX_ENTRYPOINT_LOCAL_RESOLVERS=1
COPY docker/default.conf.template /etc/nginx/templates/default.conf.template
COPY docker/security-headers.conf /etc/nginx/snippets/security-headers.conf
COPY --chmod=755 docker/18-barypote-config.envsh /docker-entrypoint.d/18-barypote-config.envsh
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1/healthz >/dev/null || exit 1

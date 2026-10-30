// Test de bout en bout dans Chromium, API externes simulées (voir fake-apis.mjs).
// Usage : npm run build && npm run e2e
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { calls, handle } from './fake-apis.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const PORT = 4179;
// E2E_URL permet de tester une instance déjà lancée (ex. le conteneur Docker).
const BASE = process.env.E2E_URL ?? `http://localhost:${PORT}/`;
mkdirSync('e2e/screenshots', { recursive: true });

let server = null;
if (!process.env.E2E_URL) {
  server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'pipe', detached: true });
  await new Promise((resolve, reject) => {
    server.stdout.on('data', (d) => String(d).includes(String(PORT)) && resolve());
    server.on('exit', (c) => reject(new Error(`vite preview exited ${c}`)));
  });
}

const browser = await chromium.launch();
let failed = false;
const check = (cond, msg) => {
  console.log(`${cond ? '✔' : '✘'} ${msg}`);
  if (!cond) failed = true;
};

async function newPage(viewport, colorScheme = 'light') {
  const ctx = await browser.newContext({ viewport, colorScheme, permissions: ['clipboard-read', 'clipboard-write'] });
  await ctx.route('**/*', async (route) => {
    const req = route.request();
    if (req.url().startsWith(BASE)) return route.continue();
    const r = handle(req.url(), req.method(), req.postData() ?? '');
    // Délais proches des vrais services, pour voir la recherche progresser.
    const host = new URL(req.url()).host;
    const delay = host.includes('overpass') ? 1500 : host.includes('routing') || host.includes('transitous') ? 300 : 0;
    if (delay) await new Promise((res) => setTimeout(res, delay));
    if (!r) {
      console.log('  (non simulé)', req.url());
      return route.abort();
    }
    await route.fulfill({
      status: r.status,
      body: r.body ?? JSON.stringify(r.json),
      contentType: r.contentType ?? 'application/json',
      headers: { 'access-control-allow-origin': '*' },
    });
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  return { ctx, page, errors };
}

try {
  // --- Bureau : saisie d'adresse + exemple complet -------------------------------------
  const { page, errors, ctx } = await newPage({ width: 1366, height: 860 });
  await page.goto(BASE);
  check((await page.locator('.participant').count()) === 2, 'deux participants vides au démarrage');
  await page.locator('.leaflet-gl-layer, .maplibregl-canvas').first().waitFor({ timeout: 10000 });
  check(await page.locator('.raster-tiles').count() === 0, 'fond de carte vectoriel OpenFreeMap');
  check((await page.locator('.leaflet-control-attribution').innerText()).includes('OpenFreeMap'), 'attribution OpenFreeMap');

  const addr = page.locator('.participant').first().locator('.p-addr');
  await addr.fill('Montmartre');
  await page.locator('.participant').first().locator('.suggestions li[data-i]').first().waitFor();
  await addr.press('Enter');
  check(await addr.evaluate((el) => el.classList.contains('ok')), 'autocomplétion : adresse validée avec Entrée');
  check((await page.locator('.leaflet-marker-icon .pin').count()) === 1, 'marqueur du participant sur la carte');

  await page.click('#example');
  check((await page.locator('.participant').count()) === 4, 'exemple chargé (4 personnes)');
  await page.click('[data-cat="restaurant"]');
  await page.click('[data-crit="minimax"]');
  await page.click('#search');
  await page.locator('.live-zone .zone-card').waitFor({ timeout: 10000 });
  check((await page.locator('.leaflet-overlay-pane .heat-cell').count()) >= 49, 'grille d’équité affichée pendant la recherche');
  check((await page.locator('.leaflet-overlay-pane .fair-zone').count()) === 1, 'zone équitable dessinée avant les lieux');
  await page.locator('.poi-dot').first().waitFor({ timeout: 10000 });
  check((await page.locator('.steps li').count()) >= 3, `étapes affichées : ${(await page.locator('.steps').innerText()).replace(/\n/g, ' | ')}`);
  await page.screenshot({ path: 'e2e/screenshots/desktop-live.png' });
  await page.locator('.place').first().waitFor({ timeout: 20000 });
  check((await page.locator('.leaflet-overlay-pane .fair-zone').count()) === 1, 'zone équitable conservée sur le résultat');
  check((await page.locator('.place').count()) > 3, `${await page.locator('.place').count()} restaurants classés`);
  check((await page.locator('.zone-card .bars li').count()) === 4, 'temps de trajet de chacun vers le point');
  await page.locator('.place.selected .routes li').first().waitFor({ timeout: 10000 });
  check((await page.locator('.place.selected .routes li').count()) === 4, 'itinéraires détaillés du 1er lieu');
  const summary = await page.locator('.place.selected .routes').innerText();
  check(/Métro 4/.test(summary), 'itinéraire transports en commun avec la ligne');
  check((await page.locator('.leaflet-overlay-pane path').count()) >= 8, 'tracés des itinéraires sur la carte');
  await page.screenshot({ path: 'e2e/screenshots/desktop.png' });

  await page.check('#heat-toggle');
  check((await page.locator('.leaflet-overlay-pane path').count()) > 40, 'carte d’équité affichée');
  await page.screenshot({ path: 'e2e/screenshots/desktop-heat.png' });
  await page.uncheck('#heat-toggle');

  await page.locator('.place').nth(2).click();
  await page.locator('.place.selected .routes li').first().waitFor();
  check((await page.locator('.place.selected').getAttribute('data-id')) === (await page.locator('.place').nth(2).getAttribute('data-id')), 'sélection d’un autre lieu');

  await page.locator('.place.selected .copy').click();
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  check(clip.startsWith('📍 On se retrouve à') && clip.includes('Alice'), 'résumé copiable pour le groupe');

  await page.click('#share');
  const shared = await page.evaluate(() => navigator.clipboard.readText());
  check(shared.includes('?p=') && shared.includes('lancer=1'), 'lien de partage copié (relance la recherche)');

  // Le lien de partage restaure le groupe dans un navigateur vierge.
  const other = await newPage({ width: 1366, height: 860 });
  await other.page.goto(shared);
  const names = await other.page.locator('.p-name').evaluateAll((els) => els.map((e) => e.value));
  check(names.join(',') === 'Alice,Bastien,Chloé,David', 'lien de partage : participants restaurés');
  check((await other.page.locator('[data-cat="restaurant"]').getAttribute('aria-checked')) === 'true', 'lien de partage : catégorie restaurée');
  await other.ctx.close();

  check(errors.length === 0, `aucune erreur JS ${errors.length ? JSON.stringify(errors) : ''}`);
  await ctx.close();

  // --- Lien de recherche + lieux via Geoapify (serveur avec clé) ------------------------
  const g = await newPage({ width: 1280, height: 800 });
  const geoCalls = [];
  await g.ctx.route('**/config.json', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{"places":"geoapify"}' }));
  await g.ctx.route('**/api/geoapify/places?**', async (r) => {
    const u = new URL(r.request().url());
    geoCalls.push(u.searchParams.get('filter'));
    const f = u.searchParams.get('filter');
    const [lon, lat] = f.replace(/^(circle|rect):/, '').split(',').map(Number);
    const features = ['Le Zinc Geo', 'Chez Apify', 'Bar du Proxy'].map((name, k) => ({
      type: 'Feature',
      properties: {
        name,
        lat: lat + 0.001 * (k + 1),
        lon: lon + 0.001 * (k + 1),
        place_id: `pid${k}`,
        categories: ['catering.bar'],
        datasource: { raw: { osm_type: 'n', osm_id: 900 + k, amenity: 'bar', name } },
      },
      geometry: { type: 'Point', coordinates: [lon, lat] },
    }));
    await r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ features }) });
  });
  const link =
    `${BASE}?p=Alice;48.88670,2.34310;tc;Montmartre&p=Bastien;48.84740,2.43960;voiture;Vincennes` +
    `&p=Chlo%C3%A9;48.83530,2.24110;velo;Boulogne&lieu=bar&critere=minimax&depart=2026-11-07T19:00&max=75&parking=8&lancer=1&choix=node/901`;
  const overpassBefore = calls.filter((c) => c.includes('interpreter')).length;
  await g.page.goto(link);
  await g.page.locator('.place.selected').waitFor({ timeout: 20000 });
  check(true, 'lien avec lancer=1 : recherche relancée automatiquement');
  check((await g.page.locator('.place.selected .place-title b').innerText()) === 'Chez Apify', 'lien avec choix= : lieu resélectionné');
  check((await g.page.locator('#max-time').inputValue()) === '75' && (await g.page.locator('#parking').inputValue()) === '8', 'options restaurées depuis l’URL');
  check((await g.page.locator('#departure').inputValue()) === '2026-11-07T19:00', 'heure de départ restaurée');
  check((await g.page.locator('[data-crit="minimax"]').getAttribute('aria-checked')) === 'true', 'critère restauré');
  check(geoCalls.length >= 1 && calls.filter((c) => c.includes('interpreter')).length === overpassBefore, `lieux via Geoapify, pas d’Overpass (${geoCalls.join(' | ')})`);
  const url = new URL(g.page.url());
  check(url.searchParams.get('lancer') === '1' && url.searchParams.get('choix') === 'node/901', `URL à jour après la recherche : ${url.search.slice(0, 80)}…`);
  await g.page.click('[data-cat="restaurant"]');
  check(new URL(g.page.url()).searchParams.get('lancer') === null, 'changer un critère retire « lancer » de l’URL');
  await g.ctx.close();

  // --- Mobile, thème sombre ------------------------------------------------------------
  const m = await newPage({ width: 390, height: 844 }, 'dark');
  // OpenFreeMap en panne : la carte doit basculer sur les tuiles OpenStreetMap.
  await m.ctx.route('https://tiles.openfreemap.org/**', (r) => r.fulfill({ status: 503, body: 'down' }));
  await m.page.goto(BASE);
  await m.page.locator('.raster-tiles img.leaflet-tile').first().waitFor({ timeout: 10000 });
  check(true, 'repli sur les tuiles OpenStreetMap si OpenFreeMap est injoignable');
  await m.page.click('#example');
  await m.page.click('#search');
  await m.page.locator('.place').first().waitFor({ timeout: 20000 });
  const overflow = await m.page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check(overflow <= 0, `mobile : pas de défilement horizontal (${overflow}px)`);
  await m.page.screenshot({ path: 'e2e/screenshots/mobile-dark.png' });
  await m.page.locator('.place').first().click();
  await m.page.locator('.place.selected .routes li').first().waitFor();
  await m.page.locator('.place.selected').scrollIntoViewIfNeeded();
  await m.page.screenshot({ path: 'e2e/screenshots/mobile-dark-place.png' });
  // Le 503 simulé d'OpenFreeMap est attendu.
  const mErrors = m.errors.filter((e) => !e.includes('503'));
  check(mErrors.length === 0, `mobile : aucune erreur JS ${mErrors.length ? JSON.stringify(mErrors) : ''}`);
  await m.ctx.close();
} catch (e) {
  console.error(e);
  failed = true;
} finally {
  await browser.close();
  // Arrête npx et le serveur Vite qu'il a lancé (même groupe de processus).
  if (server) process.kill(-server.pid, 'SIGTERM');
}
process.exit(failed ? 1 : 0);

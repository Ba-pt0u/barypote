// Test de bout en bout dans Chromium, API externes simulées (voir fake-apis.mjs).
// Usage : npm run build && npm run e2e
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { handle } from './fake-apis.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const PORT = 4179;
// E2E_URL permet de tester une instance déjà lancée (ex. le conteneur Docker).
const BASE = process.env.E2E_URL ?? `http://localhost:${PORT}/`;
mkdirSync('e2e/screenshots', { recursive: true });

let server = null;
if (!process.env.E2E_URL) {
  server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'pipe' });
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
  await page.locator('.place').first().waitFor({ timeout: 20000 });
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
  check(shared.includes('#'), 'lien de partage copié');

  // Le lien de partage restaure le groupe dans un navigateur vierge.
  const other = await newPage({ width: 1366, height: 860 });
  await other.page.goto(shared);
  const names = await other.page.locator('.p-name').evaluateAll((els) => els.map((e) => e.value));
  check(names.join(',') === 'Alice,Bastien,Chloé,David', 'lien de partage : participants restaurés');
  check((await other.page.locator('[data-cat="restaurant"]').getAttribute('aria-checked')) === 'true', 'lien de partage : catégorie restaurée');
  await other.ctx.close();

  check(errors.length === 0, `aucune erreur JS ${errors.length ? JSON.stringify(errors) : ''}`);
  await ctx.close();

  // --- Mobile, thème sombre ------------------------------------------------------------
  const m = await newPage({ width: 390, height: 844 }, 'dark');
  await m.page.goto(BASE);
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
  check(m.errors.length === 0, `mobile : aucune erreur JS ${m.errors.length ? JSON.stringify(m.errors) : ''}`);
  await m.ctx.close();
} catch (e) {
  console.error(e);
  failed = true;
} finally {
  await browser.close();
  server?.kill();
}
process.exit(failed ? 1 : 0);

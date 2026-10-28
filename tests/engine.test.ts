import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// @ts-expect-error module JS sans types, partagé avec les tests navigateur
import { handle } from '../e2e/fake-apis.mjs';
import { CATEGORIES } from '../src/categories';
import { findMeetingPoint } from '../src/engine';
import { haversine } from '../src/geo';
import { stats } from '../src/scoring';
import type { Mode, Participant, SearchOptions } from '../src/types';

const person = (name: string, lat: number, lon: number, mode: Mode): Participant => ({
  id: name,
  name,
  label: name,
  pos: { lat, lon },
  mode,
  color: '#000',
});

const opts = (over: Partial<SearchOptions> = {}): SearchOptions => ({
  criterion: 'balanced',
  category: CATEGORIES[0],
  departure: new Date('2026-11-07T19:00:00Z'),
  maxTime: 120,
  parking: 0,
  ...over,
});

beforeEach(() => {
  vi.stubGlobal('fetch', async (input: string, init?: RequestInit) => {
    const r = handle(String(input), init?.method ?? 'GET', init?.body ? String(init.body) : '');
    if (!r) return new Response('not mocked', { status: 599 });
    return new Response(JSON.stringify(r.json), { status: r.status, headers: { 'content-type': 'application/json' } });
  });
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => vi.unstubAllGlobals());

describe('findMeetingPoint', () => {
  it('deux automobilistes : le point est à mi-chemin', async () => {
    const a = person('A', 48.85, 2.2, 'car');
    const b = person('B', 48.85, 2.5, 'car');
    const res = await findMeetingPoint([a, b], opts());
    const da = haversine(res.zone, a.pos!);
    const db = haversine(res.zone, b.pos!);
    expect(Math.abs(da - db)).toBeLessThan(1500);
    expect(res.places.length).toBeGreaterThan(0);
    // Les lieux sont triés par score croissant.
    const scores = res.places.map((p) => p.score);
    expect([...scores].sort((x, y) => x - y)).toEqual(scores);
    expect(stats(res.places[0].times).gap).toBeLessThan(6);
    expect(res.warnings).toEqual([]);
  });

  it('émet la zone équitable avant les lieux, puis l’affine', async () => {
    const events: string[] = [];
    const hulls: number[] = [];
    const res = await findMeetingPoint([person('A', 48.85, 2.2, 'car'), person('B', 48.85, 2.5, 'car')], opts(), (e) => {
      events.push(e.type === 'step' ? `${e.id}:${e.state}` : e.type);
      if (e.type === 'zone') hulls.push(haversine(e.hull[0], e.hull[Math.floor(e.hull.length / 2)]));
    });
    const firstZone = events.indexOf('zone');
    expect(firstZone).toBeGreaterThan(-1);
    expect(firstZone).toBeLessThan(events.indexOf('pois'));
    expect(events.indexOf('pois:active')).toBeLessThan(events.indexOf('refine:done'));
    expect(res.grids.length).toBeGreaterThanOrEqual(3);
    // La zone se resserre au fil des niveaux.
    expect(hulls[hulls.length - 1]).toBeLessThan(hulls[0]);
    expect(res.hull.length).toBeGreaterThanOrEqual(3);
  });

  it('un cycliste et un automobiliste : on se rapproche du cycliste', async () => {
    const car = person('Auto', 48.85, 2.2, 'car');
    const bike = person('Vélo', 48.85, 2.4, 'bike');
    const res = await findMeetingPoint([car, bike], opts({ category: CATEGORIES.find((c) => c.id === 'none')! }));
    expect(haversine(res.zone, bike.pos!)).toBeLessThan(haversine(res.zone, car.pos!));
    expect(res.places).toEqual([]);
  });

  it('transports en commun : temps estimés à partir des arrêts', async () => {
    const people = [person('A', 48.886, 2.343, 'transit'), person('B', 48.835, 2.241, 'transit'), person('C', 48.847, 2.44, 'car')];
    const res = await findMeetingPoint(people, opts({ criterion: 'minimax' }));
    expect(res.zone.times.every(Number.isFinite)).toBe(true);
    expect(res.zone.estimated).toEqual([true, true, false]);
    expect(res.places[0].poi?.name).toBeTruthy();
  });

  it('temps maximal trop court → message clair', async () => {
    const people = [person('A', 48.85, 2.0, 'foot'), person('B', 48.85, 3.0, 'foot')];
    await expect(findMeetingPoint(people, opts({ maxTime: 20 }))).rejects.toThrow(/Augmentez/);
  });

  it('serveurs de lieux en panne : la zone est quand même renvoyée, avec un avertissement', async () => {
    const real = globalThis.fetch;
    vi.stubGlobal('fetch', async (input: string, init?: RequestInit) =>
      String(input).includes('interpreter') ? new Response('busy', { status: 504 }) : real(input, init),
    );
    const res = await findMeetingPoint([person('A', 48.85, 2.2, 'car'), person('B', 48.85, 2.5, 'car')], opts());
    expect(Number.isFinite(res.zone.score)).toBe(true);
    expect(res.places).toEqual([]);
    expect(res.warnings.join(' ')).toMatch(/overpass-api\.de : erreur 504.*maps\.mail\.ru : erreur 504/);
  });

  it('service de transport en panne → repli estimé avec avertissement', async () => {
    const real = globalThis.fetch;
    vi.stubGlobal('fetch', async (input: string, init?: RequestInit) =>
      String(input).includes('transitous') ? new Response('down', { status: 503 }) : real(input, init),
    );
    const people = [person('A', 48.886, 2.343, 'transit'), person('B', 48.847, 2.44, 'car')];
    const res = await findMeetingPoint(people, opts());
    expect(res.warnings.join(' ')).toMatch(/Transports en commun indisponibles pour A/);
    expect(Number.isFinite(res.zone.score)).toBe(true);
  });
});

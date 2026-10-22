import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from '../web/node_modules/typescript/lib/typescript.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const js = ts.transpileModule(readFileSync(join(ROOT, 'web/src/lib/cityLayers.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const C = await import('data:text/javascript,' + encodeURIComponent(js));
const sq = (lon, lat, d) => ({ type: 'Polygon', coordinates: [[[lon - d, lat - d], [lon + d, lat - d], [lon + d, lat + d], [lon - d, lat + d], [lon - d, lat - d]]] });

describe('city layer queries', () => {
  it('filters events and leases by date only (bbox cannot be combined with cql)', () => {
    const q = new URLSearchParams(C.eventsQuery('2026-10-22'));
    assert.equal(q.get('cql_filter'), "rakentaminen_alkaa<='2026-10-22' AND purkaminen_paattyy>='2026-10-22'");
    assert.equal(q.get('bbox'), null);
    for (const l of C.leaseQueries('2026-10-22')) assert.match(new URLSearchParams(l).get('cql_filter'), /vuokraus_paattyy>='2026-10-22'/);
  });
  it('uses lat/lon bbox for line layers', () => {
    const q = new URLSearchParams(C.accessQuery({ minLon: 24.9, minLat: 60.1, maxLon: 25, maxLat: 60.2 }));
    assert.equal(q.get('bbox'), '60.10000,24.90000,60.20000,25.00000,urn:ogc:def:crs:EPSG::4326');
  });
});

describe('helFetch', () => {
  it('falls back to the city server when the proxy fails, and throws when both fail', async () => {
    const calls = [];
    const ok = { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => ({ type: 'FeatureCollection', features: [{ type: 'Feature' }] }) };
    const f = async (u) => { calls.push(u); return u.startsWith('/api') ? { ok: false, status: 502 } : ok; };
    assert.equal((await C.helFetch('a=1', f)).length, 1);
    assert.equal(calls.length, 2);
    await assert.rejects(C.helFetch('a=1', async () => ({ ok: false, status: 500 })));
  });
  it('rejects an HTML SPA fallback instead of treating it as data', async () => {
    const html = { ok: true, status: 200, headers: { get: () => 'text/html' }, json: async () => ({}) };
    await assert.rejects(C.helFetch('a=1', async () => html));
  });
});

describe('busy day and zones', () => {
  const events = C.toEvents([
    { type: 'Feature', geometry: sq(24.95, 60.2, 0.001), properties: { nimi: 'Lähellä', tapahtuma_alkaa: '2026-10-22', tapahtuma_paattyy: '2026-10-23', rakentaminen_alkaa: '2026-10-20', purkaminen_paattyy: '2026-10-25' } },
    { type: 'Feature', geometry: sq(25.2, 60.25, 0.001), properties: { nimi: 'Kaukana' } },
    { type: 'Feature', geometry: null, properties: { nimi: 'Ei sijaintia' } },
  ], '2026-10-22');
  it('lists only events within 1.5 km, with real dates', () => {
    const b = C.busyDay(events, 60.205, 24.95);
    assert.equal(b.length, 1);
    assert.equal(b[0].title, 'Lähellä');
    assert.equal(b[0].phase, 'Tapahtuma käynnissä');
    assert.equal(b[0].period, '22.10.2026 – 23.10.2026');
    assert.ok(b[0].distanceM > 300 && b[0].distanceM < 600);
  });
  it('is empty when nothing is near', () => assert.deepEqual(C.busyDay(events, 60.3, 24.6), []));
  it('finds zones containing the point and keeps the city text verbatim', () => {
    const z = C.toZones([{ type: 'Feature', geometry: sq(24.94, 60.17, 0.02), properties: { nimi: 'Maksuvyöhyke 1', lisatiedot: 'Lähdeteksti.' } }], []);
    assert.equal(C.zonesAt(z, 60.17, 24.94)[0].info, 'Lähdeteksti.');
    assert.equal(C.zonesAt(z, 60.3, 24.94).length, 0);
  });
  it('keeps only valid contractors whose area contains the venue', () => {
    const f = [
      { type: 'Feature', geometry: sq(24.92, 60.23, 0.01), properties: { nimi: 'Läntinen vastuualue', urakoitsija: 'Stara', status: 'voimassa', alku_pvm: '2024-01-01', loppu_pvm: '2026-12-31' } },
      { type: 'Feature', geometry: sq(24.92, 60.23, 0.01), properties: { nimi: 'Vanha', urakoitsija: 'X', status: 'voimassa', loppu_pvm: '2025-12-31' } },
      { type: 'Feature', geometry: sq(25.1, 60.23, 0.01), properties: { nimi: 'Muu', urakoitsija: 'Y', status: 'voimassa' } },
    ];
    const c = C.toContractors(f, 60.23, 24.92, '2026-10-22');
    assert.deepEqual(c.map((x) => x.contractor), ['Stara']);
    assert.equal(c[0].period, '1.1.2024–31.12.2026');
  });
});

describe('FMI forecast', () => {
  const xml = ['2026-10-22T18:00:00Z', '2026-10-22T19:00:00Z'].map((t, i) => `
    <BsWfs:BsWfsElement><BsWfs:Location/><BsWfs:Time>${t}</BsWfs:Time>
    <BsWfs:ParameterName>Temperature</BsWfs:ParameterName>
    <BsWfs:ParameterValue>${5 + i}</BsWfs:ParameterValue></BsWfs:BsWfsElement>
    <BsWfs:BsWfsElement><BsWfs:Time>${t}</BsWfs:Time>
    <BsWfs:ParameterName>WeatherSymbol3</BsWfs:ParameterName>
    <BsWfs:ParameterValue>NaN</BsWfs:ParameterValue></BsWfs:BsWfsElement>`).join('');
  it('parses hours and drops NaN values', () => {
    const h = C.parseFmi(xml);
    assert.equal(h.length, 2);
    assert.equal(h[1].temperature, 6);
    assert.equal(h[0].symbol, undefined);
  });
  it('never extrapolates beyond the forecast range', () => {
    const h = C.parseFmi(xml);
    assert.equal(C.pickForecast(h, new Date('2026-10-22T19:10:00Z')).temperature, 6);
    assert.equal(C.pickForecast(h, new Date('2026-11-05T12:00:00Z')), null);
  });
  it('reads match date and time in Helsinki time', () => {
    assert.equal(C.matchTarget('?date=2026-10-24&time=18:30', new Date()).at.toISOString(), '2026-10-24T15:30:00.000Z');
    assert.equal(C.matchTarget('?date=2026-12-24&time=18:30', new Date()).at.toISOString(), '2026-12-24T16:30:00.000Z');
    assert.equal(C.matchTarget('', new Date(0)).label, 'now');
    assert.equal(C.matchDateFrom('?date=bad', new Date('2026-10-22T21:30:00Z')).date, '2026-10-23');
  });
});

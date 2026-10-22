import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from '../web/node_modules/typescript/lib/typescript.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const load = async (f) => {
  const js = ts.transpileModule(readFileSync(join(ROOT, f), 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  return import('data:text/javascript,' + encodeURIComponent(js));
};
const P = await load('web/src/lib/plough.ts');
const { navLinks } = await load('web/src/lib/navigate.ts');
// Real Digitraffic response (state roads, capital region, 2026-02-10 06–07 UTC).
const feb = JSON.parse(readFileSync(join(ROOT, 'tests/fixtures/digitraffic-routes-2026-02-10.json'), 'utf8'));
const NOW = new Date('2026-02-10T07:30:00Z');
const REGION = { minLon: 24.45, minLat: 60.08, maxLon: 25.3, maxLat: 60.42 };
const res = (status, body) => ({ ok: status < 400, status, json: async () => body });

describe('Digitraffic request', () => {
  it('stays inside the API 24 h limit and asks for state roads in the bbox', () => {
    const u = new URL(P.routesUrl(REGION, NOW));
    assert.equal(u.searchParams.get('endFrom'), '2026-02-09T19:30:00Z');
    assert.equal(u.searchParams.get('domain'), 'state-roads');
    assert.equal(u.searchParams.get('xMin'), '24.4500');
    assert.ok(new URL(P.routesUrl(REGION, NOW, 48)).searchParams.get('endFrom') > '2026-02-09T07:30');
  });
});

describe('winter layer from real data', () => {
  const fc = P.toPloughLayer(feb, NOW, REGION);
  it('keeps only winter tasks, with Finnish names and Helsinki times', () => {
    assert.ok(fc.features.length > 0);
    for (const f of fc.features) {
      assert.match(f.properties.tasksFi, /Pistehiekoitus|Lumensiirto|Auraus|Suolaus|hiekoitus|tasaus/);
      assert.match(f.properties.timeFi, /\d{1,2}\.\d{1,2}\. klo|\d{2}\.\d{2}/);
    }
    assert.ok(!JSON.stringify(fc).includes('Koneellinen vesakonraivaus'));
  });
  it('drops segments outside the bbox', () => {
    for (const f of fc.features) assert.ok(JSON.stringify(f.geometry.coordinates).match(/\[(24\.[4-9]|25\.[0-2])/));
  });
  it('colours by age: <1 h, 1–3 h, 3–12 h, older dropped', () => {
    const one = { type: 'FeatureCollection', features: [feb.features[0]] };
    const end = Date.parse(feb.features[0].properties.endTime);
    const at = (min) => P.toPloughLayer(one, new Date(end + min * 60000), null).features[0]?.properties.age;
    assert.equal(at(10), 'lt1h');
    assert.equal(at(90), '1to3h');
    assert.equal(at(600), '3to12h');
    assert.equal(at(800), undefined);
  });
  it('shows Helsinki local time (UTC+2 in February)', () => {
    assert.equal(P.helsinkiTime('2026-02-10T06:00:59Z'), 'klo 08.00 (10.2.)');
  });
});

describe('venue banner', () => {
  const fc = P.toPloughLayer(feb, NOW, REGION);
  it('reports a past run near the venue with minutes and time, never a prediction', () => {
    const f = fc.features[0];
    const [lon, lat] = f.geometry.type === 'Point' ? f.geometry.coordinates : f.geometry.coordinates[0];
    const b = P.venueBanner(fc, lat, lon);
    assert.ok(b);
    assert.equal(b.ageMin, f.properties.ageMin);
    assert.match(b.text, /min sitten/);
    assert.match(b.text, /klo \d/);
    assert.doesNotMatch(b.text, /tulossa|edessä|saapuu|ennuste/i);
  });
  it('is silent when nothing is within 2 km', () => {
    assert.equal(P.venueBanner(fc, 60.16357, 24.8675, 10), null);
  });
});

describe('fetchPlough', () => {
  it('off-season: an empty response is empty, not an error', async () => {
    const fc = await P.fetchPlough(REGION, NOW, async () => res(200, { type: 'FeatureCollection', dataUpdatedTime: '2026-10-21T10:59:16Z', features: [] }));
    assert.equal(fc.features.length, 0);
    assert.equal(P.EMPTY_TEXT, 'Ei auraustietoja viime tunneilta');
  });
  it('HTTP errors and malformed bodies throw so the UI can say loading failed', async () => {
    await assert.rejects(P.fetchPlough(REGION, NOW, async () => res(503, {})), /HTTP 503/);
    await assert.rejects(P.fetchPlough(REGION, NOW, async () => res(200, '<html>')));
    await assert.rejects(P.fetchPlough(REGION, NOW, async () => { throw new TypeError('Failed to fetch'); }));
    assert.match(P.ERROR_TEXT, /epäonnistui/);
  });
  it('the state-roads note is exact', () => {
    assert.equal(P.STATE_ROADS_NOTE, 'Espoon kadut (Espoon kaupunki) ja valtion tiet (Fintraffic). Helsingin katuja ei ole avoimessa datassa.');
  });
});

describe('navigate links', () => {
  it('builds Google, Waze and Apple URLs', () => {
    assert.deepEqual(navLinks(60.16357, 24.8675).map((l) => l.href), [
      'https://www.google.com/maps/dir/?api=1&destination=60.163570,24.867500',
      'https://waze.com/ul?ll=60.163570,24.867500&navigate=yes',
      'https://maps.apple.com/?daddr=60.163570,24.867500',
    ]);
    assert.deepEqual(navLinks(NaN, 1), []);
  });
});

const gml = readFileSync(join(ROOT, 'tests/fixtures/espoo-auratkartalla-2026-10-22.xml'), 'utf8');
const ENOW = new Date('2026-10-22T16:00:00Z'); // 19.00 Helsinki
const textRes = (status, body, ct = 'text/xml') => ({ ok: status < 400, status, headers: { get: () => ct }, text: async () => body, json: async () => JSON.parse(body) });

describe('Espoo city streets (real WFS sample)', () => {
  it('reads Helsinki wall-clock times, incl. DST', () => {
    assert.equal(P.helsinkiLocalToDate('2026-10-22T12:14').toISOString(), '2026-10-22T09:14:00.000Z');
    assert.equal(P.helsinkiLocalToDate('2026-01-15T08:00').toISOString(), '2026-01-15T06:00:00.000Z');
  });
  it('reprojects EPSG:3879 <-> WGS84 (round trip < 1 cm, meridian check)', () => {
    for (const [lon, lat] of [[24.653, 60.1485], [24.8675, 60.16357], [25, 60]]) {
      const [e, n] = P.wgs84ToGk25(lon, lat);
      const [l2, b2] = P.gk25ToWgs84(e, n);
      assert.ok(Math.abs(l2 - lon) < 1e-7 && Math.abs(b2 - lat) < 1e-7, `${lon},${lat} -> ${l2},${b2}`);
    }
    const [e, n] = P.wgs84ToGk25(25, 60);
    assert.equal(Math.round(e), 25500000);
    assert.ok(Math.abs(n - 6654189) < 300, String(n)); // GRS80 meridian arc to 60°N ≈ 6 654 1xx m
  });
  it('labels each segment with its real time and drops records older than 48 h', () => {
    const fc = P.parseEspooGml(gml, ENOW, null);
    assert.ok(fc.features.length >= 20);
    const f = fc.features[0];
    assert.equal(f.properties.source, 'espoo');
    assert.equal(f.properties.street, 'Orionintie');
    assert.equal(f.properties.tasksFi, 'Harjattu');
    assert.equal(f.properties.timeFi, 'klo 12.14 (22.10.)');
    assert.equal(f.properties.age, '3to12h');
    for (const x of fc.features) assert.ok(x.properties.ageMin < 48 * 60);
    for (const c of f.geometry.coordinates) assert.ok(c[0] > 24.5 && c[0] < 25 && c[1] > 60.1 && c[1] < 60.4);
  });
  it('the older Espoonlahti records are labelled with real age, never hidden as recent', () => {
    const later = P.parseEspooGml(gml, new Date('2026-10-08T12:00:00Z'), null);
    const old = later.features.find((x) => x.properties.street === 'Alakartanontie');
    assert.ok(old);
    assert.equal(old.properties.age, '12to48h');
  });
  it('Espoonlahti 1 TN A: banner names the street, the time, and Espoo, past tense only', () => {
    const fc = P.parseEspooGml(gml, new Date('2026-10-08T06:00:00Z'), null);
    const b = P.venueBanner(fc, 60.1485, 24.653);
    assert.ok(b, 'expected a run within 2 km');
    assert.match(b.text, /Alakartanontie|km päässä|lähellä/);
    assert.match(b.text, /klo \d{2}\.\d{2} \(7\.10\.\)/);
    assert.match(b.text, /Espoon kaupunki/);
    assert.doesNotMatch(b.text, /tulossa|edessä|saapuu|ennuste/i);
    // Today the newest Espoonlahti record is from 7.10., older than 48 h: no banner.
    assert.equal(P.venueBanner(P.parseEspooGml(gml, ENOW, null), 60.1485, 24.653), null);
  });
  it('request bbox in GK25 covers the WGS84 box', () => {
    const b = P.bboxAround(60.1485, 24.653, 2500);
    const [x1, y1, x2, y2] = P.wgs84ToGk25Bbox(b);
    for (const [lon, lat] of [[b.minLon, b.minLat], [b.maxLon, b.maxLat]]) {
      const [l2, b2] = P.gk25ToWgs84(lon === b.minLon ? x1 : x2, lat === b.minLat ? y1 : y2);
      assert.ok(lon === b.minLon ? l2 <= lon : l2 >= lon); assert.ok(lat === b.minLat ? b2 <= lat : b2 >= lat);
    }
  });
});

describe('combined fetch', () => {
  const B = P.bboxAround(60.1485, 24.653, 2500);
  it('off-season: both empty -> empty collection', async () => {
    const empty = '<wfs:FeatureCollection numberOfFeatures="0"></wfs:FeatureCollection>';
    const r = await P.fetchWinterMaintenance(B, ENOW, async (u) => String(u).includes('digitraffic') ? res(200, { features: [] }) : textRes(200, empty));
    assert.deepEqual(r, { fc: { type: 'FeatureCollection', features: [] }, failed: [] });
  });
  it('falls back to Espoo directly when the proxy answers HTML (SPA fallback)', async () => {
    const seen = [];
    const r = await P.fetchWinterMaintenance(B, new Date('2026-10-08T06:00:00Z'), async (u) => {
      seen.push(String(u));
      if (String(u).includes('digitraffic')) return res(200, { features: [] });
      if (String(u).startsWith('/api/')) return textRes(200, '<!doctype html>', 'text/html');
      return textRes(200, gml);
    });
    assert.ok(seen.some((u) => u.startsWith('https://kartat.espoo.fi/')));
    assert.ok(r.fc.features.every((f) => f.properties.source === 'espoo'));
  });
  it('one source failing is reported, both failing throws', async () => {
    const r = await P.fetchWinterMaintenance(B, ENOW, async (u) => String(u).includes('digitraffic') ? res(503, {}) : textRes(200, gml));
    assert.deepEqual(r.failed, ['state']);
    await assert.rejects(P.fetchWinterMaintenance(B, ENOW, async () => { throw new TypeError('Failed to fetch'); }));
  });
});

describe('Espoo proxy ships with pages deploy', () => {
  it('web/functions/api/espoo-streets.ts exists and only forwards a numeric bbox', () => {
    const src = readFileSync(join(ROOT, 'web/functions/api/espoo-streets.ts'), 'utf8');
    assert.match(src, /onRequestGet/);
    assert.match(src, /kartat\.espoo\.fi/);
    assert.match(src, /bad bbox/);
  });
});

describe('Helsinki prioritised winter routes (static)', () => {
  // Shape of the real WFS response (2026-10-22), geometry shortened.
  const raw = { type: 'FeatureCollection', totalFeatures: 80, features: [
    { type: 'Feature', geometry: { type: 'LineString', coordinates: [[24.85951855, 60.16261067], [24.90853971, 60.16529147]] }, properties: { id: 446, nimi: 'Lauttasaari - Töölö', hoitotapa: 'Harjasuolaus', urakoitsija: 'Stara', paivitetty_tietopalveluun: '2026-10-21' } },
    { type: 'Feature', geometry: { type: 'Point', coordinates: [24.9, 60.1] }, properties: {} },
  ] };
  it('keeps lines with name, method, contractor and update date only', () => {
    const fc = P.toHelPriority(raw);
    assert.equal(fc.features.length, 1);
    assert.deepEqual(fc.features[0].properties, { nimi: 'Lauttasaari - Töölö', hoitotapa: 'Harjasuolaus', urakoitsija: 'Stara', paivitetty: '2026-10-21' });
  });
  it('is labelled as not real-time, and errors throw', async () => {
    assert.equal(P.HEL_PRIORITY_LABEL, 'Talvihoidon ensisijaiset reitit (ei reaaliaikainen)');
    await assert.rejects(P.fetchHelPriority(async () => res(500, {})), /HTTP 500/);
  });
});

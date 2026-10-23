import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from '../web/node_modules/typescript/lib/typescript.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const tx = (p) => ts.transpileModule(read(p), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const url = (js) => 'data:text/javascript,' + encodeURIComponent(js);
const signsUrl = url(tx('web/src/lib/signs.ts'));
const coverageUrl = url(tx('web/src/lib/coverage.ts'));
const S = await import(signsUrl);
const A = await import(url(tx('web/src/lib/allowed.ts').replace('"./coverage"', JSON.stringify(coverageUrl)).replace('"./signs"', JSON.stringify(signsUrl))));

describe('sign popup is in Finnish', () => {
  it('names every sign type in the Digiroad snapshot', () => {
    for (const t of ['C32', 'C34', 'C37', 'C38', 'C39', 'C40', 'C44.1', 'C44.2', 'E2', 'E3.1', 'E3.4', 'E4.1', 'E4.2', 'E4.3', 'E22', 'E23', 'E24', 'E26', 'E28']) {
      assert.ok(S.SIGN_NAMES[t], `missing ${t}`);
      assert.doesNotMatch(S.signLabel(t), /\b(No|Parking|Place|Limit|Zone|Stopping)\b/, t);
    }
    assert.equal(S.signLabel('C38'), 'Pysäköinti kielletty');
    assert.equal(S.signLabel('C37'), 'Pysäyttäminen kielletty');
    assert.equal(S.signLabel('C39'), 'Pysäköintikieltoalue');
    assert.equal(S.signLabel('E2'), 'Pysäköintipaikka');
    assert.equal(S.signLabel('C32', 30), 'Nopeusrajoitus 30 km/h');
    assert.equal(S.signLabel('C38', 0), 'Pysäköinti kielletty');
  });
  it('labels each plate with its official Finnish name and keeps the text', () => {
    // Arto's sign: C38 with "2 h 8-17" (H19.1) and "25 m" (H3).
    const rows = S.plateRows({ tyyppi: 'C38', kilpityyp1: 'H19.1', kilpi_txt1: '2 h 8-17', kilpityyp2: 'H3', kilpi_txt2: '25 m' });
    assert.deepEqual(rows.map((r) => `${r.label}: ${r.text}`), ['Pysäköintikiekko pakollinen: 2 h 8–17', 'Vaikutusalueen pituus: 25 m']);
    assert.equal(S.PLATE_NAMES['H4'], 'Etäisyys kohteeseen');
    assert.equal(S.PLATE_NAMES['H12.9'], 'Mopo');
    assert.equal(S.PLATE_NAMES['H24'], 'Tekstillinen lisäkilpi');
    assert.equal(S.PLATE_NAMES['H20'], 'Maksullinen pysäköinti');
    assert.equal(S.plateRows({ kilpityyp1: 'H99', kilpi_txt1: 'x' })[0].label, 'Lisäkilpi H99');
    assert.deepEqual(S.plateRows({}), []);
  });
  it('explains Saturday times in parentheses', () => {
    assert.equal(S.hasSaturdayTimes(S.plateRows({ kilpityyp1: 'H20', kilpi_txt1: '9-21 (9-18)' })), true);
    assert.equal(S.hasSaturdayTimes(S.plateRows({ kilpityyp1: 'H20', kilpi_txt1: '9-21' })), false);
  });
  it('covers every plate type used in the signs snapshot (2026-10 audit)', () => {
    for (const t of ['H1', 'H2.1', 'H2.2', 'H3', 'H4', 'H9.1', 'H9.2', 'H10', 'H11', 'H12.1', 'H12.2', 'H12.3', 'H12.4', 'H12.7', 'H12.8', 'H12.10', 'H13.1', 'H13.2', 'H14', 'H15', 'H17.1', 'H17.2', 'H17.3', 'H18', 'H19.1', 'H19.2', 'H20', 'H21', 'H23.1', 'H23.2', 'H24', 'H25']) {
      assert.ok(S.PLATE_NAMES[t], `missing ${t}`);
    }
  });
});

describe('allowed parking comes only from city data', () => {
  const free = { category: 'free', luokka_nimi: 'Ilman asukas-/yritystunnusta ilmainen lyhytaikainen pysäköinti. Käytä pysäköintikiekkoa.', kesto: '4 H', voimassaolo: '8-20' };
  const paid = { category: 'paid', luokka_nimi: 'Kertamaksu enintään 4 tuntia', kesto: '', voimassaolo: '9-21, (9-18)' };
  it('popup rows: payment, time limit, disc, hours', () => {
    assert.deepEqual(A.parkingFacts(free), [
      { label: 'Maksu', value: 'Maksuton' },
      { label: 'Aikaraja', value: '4 h' },
      { label: 'Pysäköintikiekko', value: 'Kyllä' },
      { label: 'Voimassa', value: '8–20' },
    ]);
    assert.deepEqual(A.parkingFacts(paid).map((r) => r.value), ['Maksullinen', 'enintään 4 h', 'Ei tietoa', '9–21, (9–18)']);
  });
  it('says "Ei tietoa" instead of guessing', () => {
    const none = { category: 'other', luokka_nimi: null, kesto: '4', voimassaolo: '' };
    assert.deepEqual(A.parkingFacts(none).map((r) => r.value), ['Ei tietoa', 'Ei tietoa', 'Ei tietoa', 'Ei tietoa']);
    assert.equal(A.timeLimit({ kesto: '30 min, (30 мин)' }), '30 min');
  });
  it('counts only paid and free spaces near the venue, never restricted or unknown', () => {
    const at = { latitude: 60.2035, longitude: 24.955 };
    const poly = (lon, lat, props) => ({ type: 'Feature', properties: props, geometry: { type: 'MultiPolygon', coordinates: [[[[lon, lat], [lon + 0.0001, lat], [lon, lat + 0.0001], [lon, lat]]]] } });
    const hel = { type: 'FeatureCollection', features: [
      poly(24.955, 60.2035, { category: 'paid', paikat_ala: 10 }),
      poly(24.956, 60.2036, { category: 'free', paikat_ala: null }),
      poly(24.955, 60.2034, { category: 'restricted', paikat_ala: 5 }),
      poly(24.955, 60.2034, { category: 'other', paikat_ala: 5 }),
      poly(24.99, 60.25, { category: 'paid', paikat_ala: 50 }),
    ] };
    const esp = { type: 'FeatureCollection', features: [
      { type: 'Feature', properties: { class: 'yleinenpysakointialue' }, geometry: { type: 'Point', coordinates: [24.9551, 60.2035] } },
      { type: 'Feature', properties: { class: 'invapysakointi' }, geometry: { type: 'Point', coordinates: [24.9551, 60.2035] } },
    ] };
    const a = A.allowedNear(hel, esp, at, 300);
    assert.deepEqual(a, { paid: 1, free: 1, spaces: 10, espoo: 1 });
    assert.match(A.allowedNearText(a), /1 maksullista ja 1 maksutonta katupysäköintialuetta \(10 paikkaa\) Helsingin kaupungin aineistossa, 1 yleinen pysäköintialue Espoon/);
  });
  it('no data nearby: "Ei tietoa", never "allowed"', () => {
    const t = A.allowedNearText({ paid: 0, free: 0, spaces: 0, espoo: 0 });
    assert.match(t, /Ei tietoa/);
    assert.doesNotMatch(t, /maksullista|maksutonta|pysäköintialue /);
    assert.match(A.allowedNearText(null), /Ei tietoa/);
  });
});

describe('map wiring', () => {
  const map = read('web/src/components/ParkingMapView.tsx');
  const app = read('web/src/App.tsx');
  it('green fill is tappable and only for paid/free spaces', () => {
    assert.match(map, /id="allowed-fill"[\s\S]*?ALLOWED_CATEGORIES/);
    assert.deepEqual([...A.ALLOWED_CATEGORIES], ['paid', 'free']);
    const ids = [...map.matchAll(/interactiveLayerIds=\{\[([\s\S]*?)\]\}/g)][0][1].match(/"[^"]+"/g).map((s) => s.slice(1, -1));
    const tap = JSON.parse(app.match(/const TAP_LAYERS = (\[[^\]]*\])/)[1]);
    assert.deepEqual([...ids].sort(), [...tap].sort());
    assert.ok(ids.includes('allowed-fill'));
  });
  it('signs are muted until close zoom', () => {
    assert.match(map, /"circle-radius": \["interpolate", \["linear"\], \["zoom"\], 13, 1\.5/);
    assert.match(map, /id="sign-selected"/);
  });
  it('allowed parking colours are green-ish in every theme', () => {
    const themes = read('web/src/lib/mapThemes.ts');
    const hue = (hex) => {
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
      const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
      if (!d) return 0;
      const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
      return (h * 60 + 360) % 360;
    };
    for (const m of themes.matchAll(/(paid|free): "(#[0-9a-f]{6})"/g)) {
      const h = hue(m[2]);
      assert.ok(h >= 75 && h <= 170, `${m[1]} ${m[2]} hue ${h}`);
    }
  });
  it('fine toggle and its texts share one name', () => {
    const sheet = read('web/src/components/LayerSheet.tsx');
    assert.match(sheet, /label="Sakot alueittain"/);
    assert.match(sheet, /Sakot alueittain: Helsingin/);
    assert.match(app, /<b>Sakot alueittain<\/b>/);
    assert.doesNotMatch(sheet + app, /Sakkopaikat|Sakkoriski"/);
  });
});

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from '../web/node_modules/typescript/lib/typescript.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(join(ROOT, 'web/src/lib/coverage.ts'), 'utf8');
const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { venueCoverage, coverageNoteText } = await import('data:text/javascript,' + encodeURIComponent(js));

const pt = (lon, lat) => ({ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [lon, lat] } });
const fc = (...f) => ({ type: 'FeatureCollection', features: f });
const espoonlahti = { latitude: 60.1485, longitude: 24.653 };

describe('venue coverage note', () => {
  it('counts Espoo areas near an Espoo venue and says Helsinki data does not reach', () => {
    const c = venueCoverage(espoonlahti, 600, { helsinki: fc(pt(24.94, 60.17)), espoo: fc(pt(24.654, 60.149), pt(24.70, 60.20)), osm: fc() });
    assert.deepEqual(c, { failed: false, helsinki: false, espoo: 1, osm: 0 });
    const t = coverageNoteText(c);
    assert.match(t, /1 Espoon kaupungin pysäköintialuetta/);
    assert.match(t, /Vapaista paikoista, hinnoista ja rajoituksista ei ole tietoa/);
  });
  it('falls back to OSM, then to an honest "no data" note', () => {
    assert.match(coverageNoteText({ helsinki: false, espoo: 0, osm: 3 }), /3 OpenStreetMapiin/);
    assert.match(coverageNoteText({ helsinki: false, espoo: 0, osm: 0 }), /ei ole pysäköintitietoja/);
  });
  it('never invents numbers it was not given', () => {
    for (const t of [coverageNoteText(null), coverageNoteText({ helsinki: false, espoo: 0, osm: 0 })])
      assert.doesNotMatch(t, /\d|€|min/);
  });
});

describe('failed data load is never reported as "no data nearby"', () => {
  it('says the load failed instead', () => {
    const t = coverageNoteText({ helsinki: false, espoo: 0, osm: 0, failed: true });
    assert.match(t, /Tietojen lataus epäonnistui/);
    assert.doesNotMatch(t, /ei ole pysäköintitietoja/);
  });
});

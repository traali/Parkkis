import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from '../web/node_modules/typescript/lib/typescript.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const js = ts.transpileModule(read('web/src/lib/fines.ts'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const F = await import('data:text/javascript,' + encodeURIComponent(js));

describe('fines are drawn as areas, not spots', () => {
  it('builds ~100 m squares that contain the source point', () => {
    const lon = 24.9258, lat = 60.1875;
    const gx = Math.floor(lon / F.FINE_CELL_LON), gy = Math.floor(lat / F.FINE_CELL_LAT);
    const fc = F.cellsToCollection([{ gx: BigInt(gx), gy: BigInt(gy), fines: 12n, notices: 3n, top_reason: '0401 Pysäköintikieltoalue ' }], 'tammikuu–joulukuu 2023');
    assert.equal(fc.features.length, 1);
    const ring = fc.features[0].geometry.coordinates[0];
    assert.equal(ring.length, 5);
    assert.ok(ring[0][0] <= lon && lon <= ring[2][0] && ring[0][1] <= lat && lat <= ring[2][1]);
    const wM = (ring[1][0] - ring[0][0]) * 111320 * Math.cos((lat * Math.PI) / 180);
    const hM = (ring[2][1] - ring[1][1]) * 111320;
    assert.ok(wM > 80 && wM < 120 && hM > 80 && hM < 120, `${wM} x ${hM}`);
    assert.deepEqual(fc.features[0].properties, { fines: 12, notices: 3, top_reason: 'Pysäköintikieltoalue', period: 'tammikuu–joulukuu 2023' });
  });
  it('drops cells without fines and never invents counts', () => {
    assert.equal(F.cellsToCollection([{ gx: 1, gy: 1, fines: 0, notices: 4 }]).features.length, 0);
    assert.equal(F.cellsToCollection([]).features.length, 0);
  });
  it('states the period from the data months', () => {
    const months = ['Tammikuu', 'Kesäkuu', 'Joulukuu'].map((k) => ({ vuosi: 2023, kuukausi: k }));
    assert.equal(F.finePeriod(months), 'tammikuu–joulukuu 2023');
    assert.equal(F.finePeriod([{ vuosi: 2023, kuukausi: 'Lokakuu' }, { vuosi: 2024, kuukausi: 'Helmikuu' }]), 'lokakuu 2023–helmikuu 2024');
    assert.equal(F.finePeriod([{ vuosi: 2023, kuukausi: 'Kesäkuu' }]), 'kesäkuu 2023');
    assert.equal(F.finePeriod([]), '');
  });
  it('legend classes and map opacity come from one list', () => {
    assert.deepEqual(F.FINE_OPACITY, ['step', ['get', 'fines'], 0.14, 10, 0.28, 50, 0.42, 200, 0.6]);
    assert.deepEqual(F.FINE_CLASSES.map((c) => c.label), ['1–9', '10–49', '50–199', '200+']);
  });
  it('the map has no point layer for fines and the cells are tappable', () => {
    const map = read('web/src/components/ParkingMapView.tsx');
    assert.ok(!map.includes('violation-points'));
    assert.match(map, /id="violation-cells"\s+type="fill"/);
    assert.match(read('web/src/App.tsx'), /const TAP_LAYERS = \[[^\]]*"violation-cells"/);
  });
  it('popup and legend use plain wording, no risk score', () => {
    const popup = read('web/src/components/ParkingPopup.tsx');
    const fn = popup.slice(popup.indexOf('function FineCellPopup'), popup.indexOf('export interface HoverInfo'));
    assert.match(fn, /Pysäköintivirhemaksuja tällä alueella/);
    assert.match(fn, /Lähde: Helsingin kaupunki/);
    assert.ok(!/riski|risk/i.test(fn));
  });
});

describe('fines review fixes', () => {
  it('SQL drops null and out-of-bounds coordinates; near-check uses real cells', () => {
    assert.match(F.FINE_CELLS_SQL, /geom IS NOT NULL/);
    assert.match(F.FINE_CELLS_SQL, /BETWEEN 60\.0 AND 60\.4/);
    assert.match(F.FINE_CELLS_SQL, /BETWEEN 24\.5 AND 25\.3/);
    const fc = F.cellsToCollection([{ gx: Math.floor(24.9242 / F.FINE_CELL_LON), gy: Math.floor(60.1878 / F.FINE_CELL_LAT), fines: 3, notices: 0 }]);
    assert.equal(F.fineCellsNear(fc, 60.1878, 24.9242, F.FINES_NEAR_M), true);
    assert.equal(F.fineCellsNear(fc, 60.1485, 24.653, F.FINES_NEAR_M), false);
    assert.equal(F.fineCellsNear(null, 60.1878, 24.9242, F.FINES_NEAR_M), false);
  });
});

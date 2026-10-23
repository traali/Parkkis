import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from '../web/node_modules/typescript/lib/typescript.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const js = ts.transpileModule(read('web/src/lib/banner.ts'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const B = await import('data:text/javascript,' + encodeURIComponent(js));

describe('one banner at a time', () => {
  it('picks by priority: load error > coverage > busy day > plough > loading', () => {
    const all = { loadError: 'virhe', coverage: 'ei dataa', busyDay: 'vilkas', plough: 'aurattu', loading: 'ladataan' };
    assert.equal(B.pickBanner(all).kind, 'load-error');
    assert.equal(B.pickBanner({ ...all, loadError: null }).kind, 'coverage');
    assert.equal(B.pickBanner({ ...all, loadError: null, coverage: '' }).kind, 'busy-day');
    assert.equal(B.pickBanner({ plough: 'aurattu', loading: 'ladataan' }).kind, 'plough');
    assert.equal(B.pickBanner({ loading: 'ladataan' }).kind, 'loading');
    assert.equal(B.pickBanner({}), null);
  });
  it('the app renders exactly one banner slot', () => {
    const app = read('web/src/App.tsx');
    assert.equal((app.match(/pickBanner\(/g) ?? []).length, 1);
    assert.equal((app.match(/\{banner && \(/g) ?? []).length, 1);
  });
});

describe('plough default', () => {
  it('on only with a recent real run near the venue', () => {
    assert.equal(B.ploughOnByDefault(null), false);
    assert.equal(B.ploughOnByDefault({ ageMin: 30 }), true);
    assert.equal(B.ploughOnByDefault({ ageMin: 13 * 60 }), false);
  });
});

describe('OpenStreetMap points only outside city data', () => {
  it('hidden where Helsinki or Espoo data exists, shown when OSM is all there is', () => {
    assert.equal(B.showOsmFor(null), false);
    assert.equal(B.showOsmFor({ helsinki: true, espoo: 0, osm: 40 }), false);
    assert.equal(B.showOsmFor({ helsinki: false, espoo: 3, osm: 40 }), false);
    assert.equal(B.showOsmFor({ helsinki: false, espoo: 0, osm: 40 }), true);
    assert.equal(B.showOsmFor({ helsinki: false, espoo: 0, osm: 0 }), false);
    assert.ok(B.OSM_MIN_ZOOM >= 14);
  });
});

describe('time limit label', () => {
  it('keeps the city text, drops the duplicate Russian', () => {
    assert.equal(B.timeLimitLabel('30 min, (30 мин)'), '30 min');
    assert.equal(B.timeLimitLabel('4 h'), '4 h');
    assert.equal(B.timeLimitLabel(null), '');
  });
});

describe('quiet default view', () => {
  it('secondary layers start hidden', () => {
    const hook = read('web/src/hooks/useParkingLayers.ts');
    for (const n of ['NewTraps', 'Violations', 'Roadworks', 'Reservations', 'Signs'])
      assert.match(hook, new RegExp(`\\[show${n}, setShow${n}\\] = useState\\(false\\)`), n);
  });
  it('fine-risk halo is drawn under the parking lines, not over them', () => {
    const map = read('web/src/components/ParkingMapView.tsx');
    assert.ok(map.indexOf('id="parking-glow"') < map.indexOf('id="parking-lines"'));
  });
});

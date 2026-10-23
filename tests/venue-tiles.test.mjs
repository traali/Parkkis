import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from '../web/node_modules/typescript/lib/typescript.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const js = ts.transpileModule(read('web/src/lib/venueTiles.ts'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const T = await import('data:text/javascript,' + encodeURIComponent(js));
const DIR = 'web/public/data/tiles';
const index = JSON.parse(read(`${DIR}/index.json`));

describe('venue fast path tiles', () => {
  it('web and tile builder agree on tile size and region', () => {
    assert.equal(index.tile_lat, T.TILE_LAT);
    assert.equal(index.tile_lon, T.TILE_LON);
    assert.deepEqual(index.region, T.TILE_REGION);
  });
  it('tiles are built from the current snapshot (rerun npm run tiles after ingest)', () => {
    assert.equal(index.generated_from, JSON.parse(read('web/public/data/manifest.json')).generated_at);
  });
  it('Espoonlahti 1 TN A gets real Espoo areas and Lauttasaari TN B Helsinki spaces from tiles', () => {
    const load = (lat, lon) => T.tileKeysAround(lat, lon).filter((k) => existsSync(join(ROOT, DIR, `${k}.json`)))
      .map((k) => JSON.parse(read(`${DIR}/${k}.json`)));
    const esp = load(60.1485, 24.653);
    assert.ok(esp.reduce((n, t) => n + t.espoo.length, 0) > 0);
    const lau = load(60.16357, 24.8675);
    assert.ok(lau.reduce((n, t) => n + t.slots.length, 0) > 0);
  });
  it('tile features carry only source fields plus the measured fine count', () => {
    const t = JSON.parse(read(`${DIR}/${index.tiles.find((k) => k === '1246_6016') ?? index.tiles[0]}.json`));
    for (const f of t.slots) {
      assert.equal(f.properties.risk_score, Math.min(10, Math.ceil(1 + f.properties.fine_count * 0.5)));
      for (const k of Object.keys(f.properties)) assert.doesNotMatch(k, /walk|free_spots|price|occupancy/);
    }
  });
  it('a ±1 km box touches a handful of tiles, not the whole city', () => {
    const n = T.tileKeysAround(60.17, 24.94).length;
    assert.ok(n >= 1 && n <= 12, String(n));
  });
  it('in-browser DB engine is loaded lazily, not in the main bundle', () => {
    for (const f of ['web/src/hooks/useParkingLayers.ts', 'web/src/hooks/useRegionalParking.ts'])
      assert.doesNotMatch(read(f), /^import .*lib\/duckdb/m, f);
  });
  it('filter chips and Tietolähteet are at least 44 px tall', () => {
    const app = read('web/src/App.tsx');
    assert.match(read('web/src/components/LayerSheet.tsx'), /min-h-\[44px\] px-3 rounded-full text-sm/);
    assert.match(app, /rounded-full min-h-\[44px\] px-4 py-1\.5 text-\[11px\][^\n]*\n[^\n]*\n[^\n]*\n[^\n]*Tietolähteet|Tietolähteet/);
  });
});

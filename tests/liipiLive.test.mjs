import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from '../web/node_modules/typescript/lib/typescript.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const js = ts.transpileModule(readFileSync(join(ROOT, 'web/src/lib/liipiLive.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const L = await import('data:text/javascript,' + encodeURIComponent(js));
// Real rows from parking.fintraffic.fi/api/v1/utilizations (2026-10-22), plus a stale one.
const ROWS = [
  { facilityId: 517, capacityType: 'CAR', usage: 'PARK_AND_RIDE', timestamp: '2026-10-22T20:40:43.000+03:00', spacesAvailable: 76, capacity: 79, openNow: true },
  { facilityId: 41, capacityType: 'CAR', usage: 'PARK_AND_RIDE', timestamp: '2026-10-22T20:40:42.000+03:00', spacesAvailable: 79, capacity: 79, openNow: true },
  { facilityId: 41, capacityType: 'DISABLED', timestamp: '2024-03-01T10:00:00.000+02:00', spacesAvailable: 2 },
];
const NOW = new Date('2026-10-22T17:50:00Z');

describe('Fintraffic utilization', () => {
  it('labels a fresh row live and keeps the real counts', () => {
    const r = L.rowsFor(ROWS, 517, NOW);
    assert.equal(r.length, 1);
    assert.deepEqual([r[0].spacesAvailable, r[0].capacity, r[0].fresh, r[0].ageMin], [76, 79, true, 9]);
  });
  it('never labels a stale row live and shows its age', () => {
    const stale = L.rowsFor(ROWS, 41, NOW).find((x) => x.capacityType === 'DISABLED');
    assert.equal(stale.fresh, false);
    assert.equal(stale.capacity, null);
    assert.match(L.ageText(stale.ageMin), /vrk sitten/);
  });
  it('returns nothing for a facility without data', () => assert.deepEqual(L.rowsFor(ROWS, 9999, NOW), []));
  it('rejects the HTML SPA fallback', async () => {
    const f = async () => ({ ok: true, status: 200, headers: { get: () => 'text/html' }, json: async () => [] });
    await assert.rejects(L.fetchUtilizations(f, 1));
  });
});

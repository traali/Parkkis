import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from '../web/node_modules/typescript/lib/typescript.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const js = ts.transpileModule(readFileSync(join(ROOT, 'web/src/lib/dataFile.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { isParquetBytes, fetchParquet, DataFileError } = await import('data:text/javascript,' + encodeURIComponent(js));
const enc = (s) => new TextEncoder().encode(s);
const HTML = '<!doctype html><html lang="fi"><head>';

describe('HTML is never treated as data', () => {
  it('rejects the HTML app served in place of a missing parquet', async () => {
    assert.equal(isParquetBytes(enc(HTML)), false);
    const fake = async () => new Response(HTML, { status: 200, headers: { 'content-type': 'text/html' } });
    await assert.rejects(fetchParquet('/data/espoo.parquet', fake), DataFileError);
  });
  it('rejects network errors and HTTP errors', async () => {
    await assert.rejects(fetchParquet('/x', async () => { throw new TypeError('offline'); }), DataFileError);
    await assert.rejects(fetchParquet('/x', async () => new Response('', { status: 404 })), DataFileError);
  });
  it('accepts real parquet bytes', async () => {
    const buf = readFileSync(join(ROOT, 'web/public/data/espoo.parquet'));
    const r = await fetchParquet('/x', async () => new Response(buf, { status: 200 }));
    assert.equal(isParquetBytes(r), true);
  });
  it('every dataset in the manifest is committed and is parquet (build check passes)', () => {
    const m = JSON.parse(readFileSync(join(ROOT, 'web/public/data/manifest.json'), 'utf8'));
    for (const k of Object.keys(m.datasets)) assert.ok(existsSync(join(ROOT, `web/public/data/${k}.parquet`)), k);
    const tracked = execFileSync('git', ['ls-files', 'web/public/data'], { cwd: ROOT }).toString();
    for (const k of Object.keys(m.datasets)) assert.match(tracked, new RegExp(`web/public/data/${k}\\.parquet`), `${k}.parquet not committed`);
    execFileSync('node', [join(ROOT, 'web/scripts/check-data-files.mjs')]);
  });
  it('.gitignore does not hide the bundled parquet files', () => {
    assert.doesNotMatch(readFileSync(join(ROOT, '.gitignore'), 'utf8'), /^web\/public\/data\/\*\.parquet$/m);
  });
});

describe('phone tap targets and touch popups', () => {
  const drawer = readFileSync(join(ROOT, 'web/src/components/ReservationsDrawer.tsx'), 'utf8');
  const app = readFileSync(join(ROOT, 'web/src/App.tsx'), 'utf8');
  const map = readFileSync(join(ROOT, 'web/src/components/ParkingMapView.tsx'), 'utf8');
  it('list drawer close button is labelled in Finnish and 44 px; tabs and sort 44 px', () => {
    assert.match(drawer, /aria-label="Sulje lista"[\s\S]{0,120}min-w-\[44px\] min-h-\[44px\]/);
    assert.match(drawer, /px-3 py-1\.5 min-h-\[44px\]/);
    assert.match(drawer, /px-2 py-0\.5 min-h-\[44px\]/);
    assert.doesNotMatch(drawer, /Sort by/);
  });
  it('filter chips and footer buttons are 44 px', () => {
    assert.match(app, /min-h-\[44px\] rounded-2xl text-nv-text-xs/);
    assert.match(app, /rounded-full min-h-\[44px\] px-4 py-1\.5 text-\[11px\]/);
  });
  it('a tap opens the popup (touch has no mousemove) with a finger-sized hit box', () => {
    assert.match(map, /onClick=\{onMouseMove\}/);
    assert.match(map, /closeOnClick=\{false\}/);
    assert.match(app, /event\.type === "click"[\s\S]{0,400}queryRenderedFeatures/);
  });
});

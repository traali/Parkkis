import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|html)$/.test(name)) out.push(p);
  }
  return out;
}

const shipped = [...walk(join(ROOT, 'web/src')), join(ROOT, 'web/index.html'), join(ROOT, 'src/contracts.ts'), join(ROOT, 'src/mcp-app.ts')];
const read = (p) => readFileSync(p, 'utf8');

describe('No fabricated data ships to users (kids use this)', () => {
  it('has no hand-written venue presets or coordinate-box risk heuristics', () => {
    for (const f of shipped) {
      const src = read(f);
      assert.doesNotMatch(src, /ARENA_PRESETS|CuratedArenaPreset/, `${f} contains curated presets`);
      assert.doesNotMatch(src, /isTrap\s*=\s*coords\.lat/, `${f} contains a lat/lng box heuristic`);
      assert.doesNotMatch(src, /\b(lorem|mock|dummy|faker)\b/i, `${f} mentions mock/dummy data`);
    }
  });

  it('does not route requests through third-party CORS proxies', () => {
    for (const f of shipped) assert.doesNotMatch(read(f), /allorigins|corsproxy|cors-anywhere/i, f);
  });

  it('does not show a stale bundled street-works snapshot', () => {
    const hook = read(join(ROOT, 'web/src/hooks/useParkingLayers.ts'));
    assert.doesNotMatch(hook, /roadworks\.parquet/);
    assert.match(hook, /Kaivuilmoitus_alue/);
  });

  it('computes "new sign" at runtime, not from the frozen ingest flag', () => {
    const hook = read(join(ROOT, 'web/src/hooks/useParkingLayers.ts'));
    assert.doesNotMatch(hook, /'is_new': is_new/);
    assert.match(hook, /mod_ts >= now\(\)/);
  });

  it('does not hard-code the fine total', () => {
    assert.doesNotMatch(read(join(ROOT, 'web/src/App.tsx')), /165[\s\u00a0]?700/);
  });

  it('keeps the old static maplet with its default "3/10 safe" badge removed', () => {
    assert.equal(existsSync(join(ROOT, 'web/public/mcp-maplet.html')), false);
  });
});

describe('Pelipäivä venue deep link', () => {
  it('builds with an absolute base so /venue/<name> can load its assets', () => {
    assert.match(read(join(ROOT, 'web/vite.config.ts')), /base:\s*"\/"/);
  });

  it('keeps the SPA fallback for /venue/* paths', () => {
    assert.match(read(join(ROOT, 'web/public/_redirects')), /^\/\*\s+\/index\.html\s+200/m);
  });

  it('web and root contract adapters stay identical', () => {
    assert.equal(read(join(ROOT, 'src/contracts.ts')), read(join(ROOT, 'web/src/lib/contracts.ts')));
  });
});

describe('MapLibre 6', () => {
  it('uses maplibre-gl 6 (GHSA fix) and sets the bundled worker URL', () => {
    const pkg = JSON.parse(read(join(ROOT, 'web/package.json')));
    assert.match(pkg.dependencies['maplibre-gl'], /^\^6\./);
    const view = read(join(ROOT, 'web/src/components/ParkingMapView.tsx'));
    assert.match(view, /maplibre-gl-worker\.mjs\?worker&url/);
    assert.match(view, /setWorkerUrl\(/);
    assert.match(view, /mapLib=\{maplibreLib\}/);
  });

  it('has no default import of maplibre-gl (removed in v6)', () => {
    for (const f of ['web/src/App.tsx', 'web/src/components/ParkingMapView.tsx']) {
      assert.doesNotMatch(read(join(ROOT, f)), /import (type )?maplibregl from "maplibre-gl"/);
    }
  });
});

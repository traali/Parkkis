// Pre-splits the bundled snapshot into small GeoJSON tiles so a venue deep link
// can show nearby parking in seconds, before the in-browser DuckDB engine loads.
// Same data and same fine-count rule as web/src/hooks/useParkingLayers.ts; nothing added.
// Output: web/public/data/tiles/<ix>_<iy>.json + tiles/index.json
import { DuckDBInstance } from '@duckdb/node-api';
import { mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DATA = join(ROOT, 'web/public/data');
const OUT = join(DATA, 'tiles');
// Must match web/src/lib/venueTiles.ts
const TILE_LAT = 0.01;
const TILE_LON = 0.02;
// Capital region only (Helsinki, Espoo, Vantaa, Kauniainen); elsewhere the full
// snapshot still loads lazily, just not pre-split.
const REGION = { minLon: 24.45, maxLon: 25.3, minLat: 60.08, maxLat: 60.42 };

const db = await DuckDBInstance.create();
const c = await db.connect();
await c.run('INSTALL spatial; LOAD spatial;');
const q = async (sql) => (await c.runAndReadAll(sql)).getRowObjectsJson();
for (const t of ['slots', 'violations', 'espoo', 'osm'])
  await c.run(`CREATE TABLE ${t} AS SELECT * FROM read_parquet('${join(DATA, t + '.parquet')}')`);
await c.run(`CREATE TABLE real_violations AS SELECT * FROM violations WHERE todellinen_sijainti = 'Kyllä'`);

const slots = await q(`
  SELECT ST_AsGeoJSON(s.geom) AS geometry, ST_X(ST_Centroid(s.geom)) AS cx, ST_Y(ST_Centroid(s.geom)) AS cy,
    s.id, s.luokka_nimi, s.tyyppi, s.paikat_ala, s.kesto, s.voimassaolo, s.lisatieto, s.asukaspysakointitunnus,
    CAST(s.paivitetty_tietopalveluun AS VARCHAR) AS paivitetty,
    COALESCE(s.asukaspysakointitunnus, '') <> '' AS resident_zone,
    CASE
      WHEN s.tyyppi = 'Pysäköintikielto' THEN 'restricted'
      WHEN COALESCE(s.tyyppi, '') NOT IN ('', '0', '8', '9') THEN 'special'
      WHEN s.luokka_nimi ILIKE 'Maksullinen%' OR s.luokka_nimi ILIKE 'Kertamaksu%' THEN 'paid'
      WHEN s.luokka_nimi ILIKE '%ilmainen%' THEN 'free'
      ELSE 'other'
    END AS category,
    (SELECT count(*) FROM real_violations v WHERE ST_Intersects(ST_Buffer(s.geom, 0.0002), v.geom)) AS fine_count,
    (SELECT v.virheen_paasyy_ja_paaluokka FROM real_violations v WHERE ST_Intersects(ST_Buffer(s.geom, 0.0002), v.geom)
       GROUP BY v.virheen_paasyy_ja_paaluokka ORDER BY count(*) DESC LIMIT 1) AS top_violation_reason
  FROM slots s`);
const espoo = await q(`SELECT ST_X(geom) AS lon, ST_Y(geom) AS lat, * EXCLUDE (geom) FROM espoo`);
const osm = await q(`SELECT ST_X(geom) AS lon, ST_Y(geom) AS lat, * EXCLUDE (geom) FROM osm`);

const round = (v) => (Array.isArray(v) ? v.map(round) : Math.round(v * 1e6) / 1e6);
const clean = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== null && v !== ''));
const tiles = new Map();
const put = (lon, lat, layer, f) => {
  if (lon < REGION.minLon || lon > REGION.maxLon || lat < REGION.minLat || lat > REGION.maxLat) return;
  const k = `${Math.floor(lon / TILE_LON)}_${Math.floor(lat / TILE_LAT)}`;
  if (!tiles.has(k)) tiles.set(k, { slots: [], espoo: [], osm: [] });
  tiles.get(k)[layer].push(f);
};
for (const r of slots) {
  const { geometry, cx, cy, fine_count, ...p } = r;
  const g = JSON.parse(geometry);
  g.coordinates = round(g.coordinates);
  const n = Number(fine_count);
  put(Number(cx), Number(cy), 'slots', { type: 'Feature', geometry: g,
    properties: clean({ ...p, fine_count: n }) });
}
for (const [layer, rows] of [['espoo', espoo], ['osm', osm]])
  for (const r of rows) {
    const { lon, lat, ...p } = r;
    put(Number(lon), Number(lat), layer, { type: 'Feature', geometry: { type: 'Point', coordinates: round([Number(lon), Number(lat)]) }, properties: clean(p) });
  }

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
const manifest = JSON.parse(readFileSync(join(DATA, 'manifest.json'), 'utf8'));
for (const [k, t] of tiles) writeFileSync(join(OUT, `${k}.json`), JSON.stringify(t));
writeFileSync(join(OUT, 'index.json'), JSON.stringify({ tile_lat: TILE_LAT, tile_lon: TILE_LON, region: REGION, generated_from: manifest.generated_at, tiles: [...tiles.keys()].sort() }));
console.log(`wrote ${tiles.size} tiles from ${slots.length} slots, ${espoo.length} Espoo, ${osm.length} OSM`);

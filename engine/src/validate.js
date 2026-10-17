// Validate the freshly built parquet files and write web/public/data/manifest.json.
// Exits non-zero on any problem so the daily workflow never commits empty or
// broken data. The manifest gives the UI honest "fetched on" dates.
const { DuckDBInstance } = require("@duckdb/node-api");
const fs = require("fs-extra");
const path = require("node:path");

const CACHE_DIR = path.join(__dirname, "../.cache");
const DATA_DIR = path.join(__dirname, "../../web/public/data");
const MANIFEST = path.join(DATA_DIR, "manifest.json");
const VENUES = path.join(__dirname, "../data/pelipaiva-venues.json");

/** Finland, generously. Anything outside means an axis swap or a CRS mistake. */
const FINLAND = { minLon: 19.0, maxLon: 31.7, minLat: 59.3, maxLat: 70.2 };

const RULES = {
  slots: { minRows: 7000, bbox: { minLon: 24.5, maxLon: 25.4, minLat: 60.0, maxLat: 60.4 }, columns: ["luokka_nimi", "tyyppi", "asukaspysakointitunnus", "voimassaolo", "paivitetty_tietopalveluun"] },
  violations: { minRows: 100000, bbox: { minLon: 24.5, maxLon: 25.4, minLat: 60.0, maxLat: 60.4 }, columns: ["vuosi", "todellinen_sijainti", "virheen_paasyy_ja_paaluokka"] },
  hubi: { minRows: 1000, bbox: FINLAND, columns: ["capacity_estimate"] },
  signs: { minRows: 12000, bbox: { minLon: 24.4, maxLon: 25.4, minLat: 60.0, maxLat: 60.5 }, columns: ["tyyppi", "muokkauspv", "mod_ts"] },
  liipi: { minRows: 500, bbox: FINLAND, columns: ["facility_id", "name", "builtCapacity"] },
  espoo: { minRows: 400, bbox: { minLon: 24.4, maxLon: 24.95, minLat: 60.05, maxLat: 60.4 }, columns: ["espoo_id", "class", "parking_spaces", "street_address_fi"] },
  osm: { minRows: 35000, bbox: FINLAND, columns: ["osm_id", "capacity", "fee", "access", "parking", "capacity_disabled"] },
};

/** A refresh may not shrink a dataset by more than this vs. the committed one. */
const MAX_DROP = 0.3;

async function main() {
  const instance = await DuckDBInstance.create(":memory:");
  const con = await instance.connect();
  await con.run("INSTALL spatial; LOAD spatial;");
  const one = async (sql) => (await con.runAndReadAll(sql)).getRowObjectsJson()[0];

  const previous = (await fs.pathExists(MANIFEST)) ? await fs.readJson(MANIFEST) : null;
  const problems = [];
  const datasets = {};

  for (const [name, rule] of Object.entries(RULES)) {
    const file = path.join(DATA_DIR, `${name}.parquet`).replace(/\\/g, "/");
    if (!(await fs.pathExists(file))) { problems.push(`${name}: parquet missing`); continue; }
    const tbl = `read_parquet('${file}')`;
    const cols = (await con.runAndReadAll(`DESCRIBE SELECT * FROM ${tbl}`)).getRowObjectsJson().map((c) => c.column_name);
    for (const c of rule.columns) if (!cols.includes(c)) problems.push(`${name}: column ${c} missing`);
    if (!cols.includes("geom")) { problems.push(`${name}: geom column missing`); continue; }

    const s = await one(`SELECT count(*) AS n, count(*) FILTER (WHERE geom IS NULL OR ST_IsEmpty(geom)) AS empty,
      min(ST_XMin(geom)) AS minx, max(ST_XMax(geom)) AS maxx, min(ST_YMin(geom)) AS miny, max(ST_YMax(geom)) AS maxy FROM ${tbl}`);
    const n = Number(s.n);
    if (n < rule.minRows) problems.push(`${name}: ${n} rows < minimum ${rule.minRows}`);
    if (Number(s.empty) > n * 0.01) problems.push(`${name}: ${s.empty} empty geometries`);
    const b = rule.bbox;
    if (s.minx < b.minLon || s.maxx > b.maxLon || s.miny < b.minLat || s.maxy > b.maxLat) {
      problems.push(`${name}: extent ${[s.minx, s.miny, s.maxx, s.maxy].map((v) => Number(v).toFixed(3)).join(",")} outside expected area`);
    }
    const prevRows = previous?.datasets?.[name]?.rows;
    if (prevRows && n < prevRows * (1 - MAX_DROP)) problems.push(`${name}: ${n} rows, was ${prevRows} (>${MAX_DROP * 100}% drop)`);

    const meta = (await fs.pathExists(path.join(CACHE_DIR, `${name}.meta.json`)))
      ? await fs.readJson(path.join(CACHE_DIR, `${name}.meta.json`))
      : {};
    const entry = { rows: n, fetched_at: meta.fetched_at ?? null, source: meta.source ?? null, licence: meta.licence ?? null };

    // Source-side "last updated" when the data carries one.
    if (name === "slots") entry.source_updated = (await one(`SELECT CAST(max(paivitetty_tietopalveluun) AS VARCHAR) AS d FROM ${tbl}`)).d;
    if (name === "signs") entry.source_updated = (await one(`SELECT strftime(max(mod_ts), '%Y-%m-%d') AS d FROM ${tbl}`)).d;
    if (name === "violations") entry.years = (await one(`SELECT string_agg(DISTINCT CAST(vuosi AS VARCHAR), ',' ORDER BY CAST(vuosi AS VARCHAR)) AS y FROM ${tbl}`)).y;
    if (name === "osm") entry.source_updated = meta.source_timestamp ?? null;
    datasets[name] = entry;
  }

  // The OSM snapshot must actually cover the venues Pelipäivä links to.
  const { venues } = await fs.readJson(VENUES);
  const osmFile = path.join(DATA_DIR, "osm.parquet").replace(/\\/g, "/");
  if (datasets.osm) {
    await con.run(`CREATE TABLE osm AS SELECT ST_X(geom) AS lon, ST_Y(geom) AS lat FROM read_parquet('${osmFile}')`);
    let covered = 0;
    for (const v of venues) {
      // ~1 km box (lat 0.009°, lon 0.018° at 60°N)
      const r = await one(`SELECT count(*) AS n FROM osm WHERE lat BETWEEN ${v.lat - 0.009} AND ${v.lat + 0.009} AND lon BETWEEN ${v.lon - 0.018} AND ${v.lon + 0.018}`);
      if (Number(r.n) > 0) covered++;
    }
    datasets.osm.venues_checked = venues.length;
    datasets.osm.venues_with_parking_within_1km = covered;
    if (covered < venues.length * 0.8) problems.push(`osm: only ${covered}/${venues.length} Pelipäivä venues have OSM parking within ~1 km`);
  }

  if (problems.length) {
    console.error("❌ Validation failed:\n  - " + problems.join("\n  - "));
    process.exit(1);
  }
  const manifest = { generated_at: new Date().toISOString(), datasets };
  await fs.writeJson(MANIFEST, manifest, { spaces: 2 });
  console.log("✅ Validation passed; manifest written");
  console.table(Object.fromEntries(Object.entries(datasets).map(([k, v]) => [k, { rows: v.rows, updated: v.source_updated ?? v.years ?? "" }])));
}

main().catch((e) => {
  console.error("❌ Validation crashed:", e.message ?? e);
  process.exit(1);
});

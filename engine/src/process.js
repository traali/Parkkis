// Convert engine/.cache/*.json (GeoJSON from the fetchers) into GeoParquet files
// in web/public/data, read in the browser by DuckDB-WASM.
const { DuckDBInstance } = require("@duckdb/node-api");
const fs = require("fs-extra");
const path = require("node:path");

const CACHE_DIR = path.join(__dirname, "../.cache");
const OUTPUT_DIR = path.join(__dirname, "../../web/public/data");

/** All datasets the app reads. A missing source is an error, never a silent skip. */
const DATASETS = ["slots", "violations", "hubi", "signs", "liipi", "espoo", "osm"];

const posix = (p) => p.replace(/\\/g, "/");

function sourceQuery(name, file) {
  const read = `ST_Read('${posix(file)}')`;
  switch (name) {
    case "signs":
      // `mod_ts` lets the app decide what is "new" at view time.
      return `SELECT *, strptime(muokkauspv, '%d.%m.%Y %H:%M:%S') AS mod_ts FROM ${read}`;
    case "osm":
      // Sorted so nearby lots share row groups (smaller file, faster scans).
      return `SELECT * FROM ${read} ORDER BY ST_Y(geom), ST_X(geom)`;
    default:
      return `SELECT * FROM ${read}`;
  }
}

async function main() {
  const instance = await DuckDBInstance.create(":memory:");
  const con = await instance.connect();
  await con.run("INSTALL spatial; LOAD spatial;");
  await fs.ensureDir(OUTPUT_DIR);

  for (const name of DATASETS) {
    const file = path.join(CACHE_DIR, `${name}.json`);
    if (!(await fs.pathExists(file))) throw new Error(`${name}: ${file} missing; run the fetchers first`);

    const cols = (await con.runAndReadAll(`DESCRIBE ${sourceQuery(name, file)}`)).getRowObjectsJson().map((c) => c.column_name);
    const geomCol = cols.find((c) => c === "geom" || c === "geometry");
    if (!geomCol) throw new Error(`${name}: no geometry column`);
    const q = geomCol === "geom" ? sourceQuery(name, file) : `SELECT * EXCLUDE ${geomCol}, ${geomCol} AS geom FROM (${sourceQuery(name, file)})`;

    const out = path.join(OUTPUT_DIR, `${name}.parquet`);
    const tmp = `${out}.tmp`;
    await con.run(`COPY (${q}) TO '${posix(tmp)}' (FORMAT PARQUET, COMPRESSION ZSTD)`);
    await fs.move(tmp, out, { overwrite: true });
    const { size } = await fs.stat(out);
    console.log(`✅ ${name}.parquet (${(size / 1024 / 1024).toFixed(2)} MB)`);
  }
}

main().catch((e) => {
  console.error("❌ DuckDB process failed:", e.message ?? e);
  process.exit(1);
});

const duckdb = require("duckdb");
const fs = require("fs-extra");
const path = require("node:path");

const db = new duckdb.Database(":memory:");
const con = db.connect();

const CACHE_DIR = path.join(__dirname, "../.cache");
const OUTPUT_DIR = path.join(__dirname, "../../web/public/data");

async function runQuery(query) {
  return new Promise((resolve, reject) => {
    con.run(query, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

async function main() {
  console.log("🦆 DuckDB: Converting GeoJSON to optimized Parquet...");
  await fs.ensureDir(OUTPUT_DIR);

  try {
    // Install and load spatial extension
    await runQuery("INSTALL spatial; LOAD spatial;");

    const files = [
      { name: "slots", path: path.join(CACHE_DIR, "slots.json") },
      { name: "violations", path: path.join(CACHE_DIR, "violations.json") },
      { name: "hubi", path: path.join(CACHE_DIR, "hubi.json") },
      { name: "signs", path: path.join(CACHE_DIR, "signs.json") },
      { name: "roadworks", path: path.join(CACHE_DIR, "roadworks.json") },
      { name: "liipi", path: path.join(CACHE_DIR, "liipi.json") },
    ];

    for (const file of files) {
      if (!(await fs.pathExists(file.path))) {
        console.warn(`[WARN] Skipping ${file.name}, source not found.`);
        continue;
      }

      console.log(`[PROCESS] ${file.name} -> Parquet...`);

      const parquetPath = path.join(OUTPUT_DIR, `${file.name}.parquet`);

      // Clean up old file
      if (await fs.pathExists(parquetPath)) await fs.remove(parquetPath);

      let sourceQuery = `SELECT * FROM ST_Read('${file.path.replace(/\\/g, "/")}')`;

      if (file.name === "signs") {
        sourceQuery = `
          SELECT 
            *,
            strptime(muokkauspv, '%d.%m.%Y %H:%M:%S') as mod_ts,
            (current_date - strptime(muokkauspv, '%d.%m.%Y %H:%M:%S')::DATE) <= 60 as is_new
          FROM ST_Read('${file.path.replace(/\\/g, "/")}')
        `;
      } else if (file.name === "slots") {
        sourceQuery = `
          SELECT 
            *,
            COALESCE(luokka_nimi, 'Other') as luokka_nimi,
            COALESCE(asukaspysakointitunnus, '') as asukaspysakointitunnus,
            COALESCE(kesto, 'Unlimited') as kesto
          FROM ST_Read('${file.path.replace(/\\/g, "/")}')
        `;
      }

      // Standardize geometry column name to 'geom' for ALL files
      const finalQuery = `
        SELECT 
          COLUMNS(* EXCLUDE (geom, geometry)), 
          COALESCE(geom, geometry) as geom 
        FROM (${sourceQuery}) sub
      `;

      await runQuery(`
        COPY (${finalQuery}) TO '${parquetPath.replace(/\\/g, "/")}' (FORMAT 'PARQUET');
      `);

      const stats = await fs.stat(parquetPath);
      console.log(
        `✅ ${file.name}.parquet created (${(stats.size / 1024 / 1024).toFixed(2)} MB)`,
      );
    }

    console.log("🚀 All spatial assets optimized for DuckDB-Wasm.");
  } catch (e) {
    console.error("❌ DuckDB Process Failed:", e);
    process.exit(1);
  }
}

main();

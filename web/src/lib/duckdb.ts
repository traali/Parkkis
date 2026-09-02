import * as duckdb from "@duckdb/duckdb-wasm";

let db: duckdb.AsyncDuckDB | null = null;
let dbPromise: Promise<duckdb.AsyncDuckDB> | null = null;

export async function getDuckDB() {
  if (db) return db;
  if (dbPromise) return dbPromise;

  dbPromise = (async () => {
    try {
      const bundles = duckdb.getJsDelivrBundles();
      const bundle = await duckdb.selectBundle(bundles);
      if (!bundle.mainWorker) {
        throw new Error("DuckDB bundle missing mainWorker");
      }
      
      // Blob wrapper to bypass Cross-Origin Worker security restrictions on CDN scripts
      const workerBlob = new Blob([`importScripts("${bundle.mainWorker}");`], {
        type: "text/javascript",
      });
      const workerUrl = URL.createObjectURL(workerBlob);
      const worker = new Worker(workerUrl);
      const logger = new duckdb.ConsoleLogger();
      const localDb = new duckdb.AsyncDuckDB(logger, worker);
      await localDb.instantiate(bundle.mainModule, bundle.pthreadWorker);

    // Load Spatial extension if possible (DuckDB-Wasm support varies)
    const conn = await localDb.connect();
    try {
      // WORKAROUND for duckdb-wasm issue #2199 'stoi: no conversion' on GeoParquet:
      // Force loading the default CRS by querying coordinate systems BEFORE loading spatial
      await conn.query(`SELECT * FROM duckdb_coordinate_systems();`);

      await conn.query(`INSTALL spatial; LOAD spatial;`);
      console.log("🦆 DuckDB-Wasm Spatial Loaded");
    } catch (e) {
      console.warn(
        "🦆 DuckDB-Wasm Spatial not supported in this bundle, falling back to basic analysis",
        e,
      );
    }
    await conn.close();

    db = localDb;
    return localDb;
  } catch (err) {
    console.warn("🦆 DuckDB WASM initialization error (falling back to spatial GeoJSON presets):", err);
    dbPromise = null;
    throw err;
  }
})();

  return dbPromise;
}

export async function loadParquet(name: string, url: string) {
  const db = await getDuckDB();
  const conn = await db.connect();

  console.log(`🦆 DuckDB: Registering ${name} from ${url}...`);

  try {
    await db.registerFileURL(name, url, duckdb.DuckDBDataProtocol.HTTP, false);

    // MATERIALIZE as a table
    await conn.query(
      `CREATE TABLE ${name} AS SELECT * FROM read_parquet('${name}')`,
    );

    const result = await conn.query(`SELECT count(*) FROM ${name}`);
    console.log(`✅ Materialized ${name}:`, result.toArray()[0]);
  } catch (error) {
    console.error(`❌ Failed to load ${name}:`, error);
    throw error;
  } finally {
    await conn.close();
  }
}

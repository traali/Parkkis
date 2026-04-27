import * as duckdb from '@duckdb/duckdb-wasm';
import duckdb_wasm from '@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm?url';
import mvp_worker from '@duckdb/duckdb-wasm/dist/duckdb-browser-mvp.worker.js?url';
import duckdb_wasm_next from '@duckdb/duckdb-wasm/dist/duckdb-eh.wasm?url';
import eh_worker from '@duckdb/duckdb-wasm/dist/duckdb-browser-eh.worker.js?url';

const MANUAL_BUNDLES: duckdb.DuckDBBundles = {
    mvp: {
        mainModule: duckdb_wasm,
        mainWorker: mvp_worker,
    },
    eh: {
        mainModule: duckdb_wasm_next,
        mainWorker: eh_worker,
    },
};

let db: duckdb.AsyncDuckDB | null = null;

export async function getDuckDB() {
    if (db) return db;

    const bundle = await duckdb.selectBundle(MANUAL_BUNDLES);
    const worker = new Worker(bundle.mainWorker!);
    const logger = new duckdb.ConsoleLogger();
    db = new duckdb.AsyncDuckDB(logger, worker);
    await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
    
    // Load Spatial extension if possible (DuckDB-Wasm support varies)
    const conn = await db.connect();
    try {
        await conn.query(`INSTALL spatial; LOAD spatial;`);
        console.log('🦆 DuckDB-Wasm Spatial Loaded');
    } catch (e) {
        console.warn('🦆 DuckDB-Wasm Spatial not supported in this bundle, falling back to basic analysis');
    }
    await conn.close();

    return db;
}

export async function loadParquet(name: string, url: string) {
    const db = await getDuckDB();
    const conn = await db.connect();
    
    // Register file from URL using the .parquet filename so DuckDB detects the format
    const filename = `${name}.parquet`;
    await db.registerFileURL(filename, url, duckdb.DuckDBDataProtocol.HTTP, false);
    
    // Create a named view so the table can be queried by name (e.g. FROM slots)
    await conn.query(`CREATE OR REPLACE VIEW "${name}" AS SELECT * FROM read_parquet('${filename}')`);
    
    // Test query
    const result = await conn.query(`SELECT count(*) FROM "${name}"`);
    console.log(`🦆 Loaded ${name}:`, result.toArray()[0]);
    
    await conn.close();
}

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
        // WORKAROUND for duckdb-wasm issue #2199 'stoi: no conversion' on GeoParquet:
        // Force loading the default CRS by querying coordinate systems BEFORE loading spatial
        await conn.query(`SELECT * FROM duckdb_coordinate_systems();`);
        
        await conn.query(`INSTALL spatial; LOAD spatial;`);
        console.log('🦆 DuckDB-Wasm Spatial Loaded');
    } catch (e) {
        console.warn('🦆 DuckDB-Wasm Spatial not supported in this bundle, falling back to basic analysis', e);
    }
    await conn.close();

    return db;
}

export async function loadParquet(name: string, url: string) {
    const db = await getDuckDB();
    const conn = await db.connect();
    
    console.log(`🦆 DuckDB: Registering ${name} from ${url}...`);
    
    try {
        await db.registerFileURL(name, url, duckdb.DuckDBDataProtocol.HTTP, false);
        
        // MATERIALIZE as a table
        await conn.query(`CREATE TABLE ${name} AS SELECT * FROM read_parquet('${name}')`);
        
        const result = await conn.query(`SELECT count(*) FROM ${name}`);
        console.log(`✅ Materialized ${name}:`, result.toArray()[0]);
    } catch (error) {
        console.error(`❌ Failed to load ${name}:`, error);
        throw error;
    } finally {
        await conn.close();
    }
}

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
    
    console.log(`🦆 DuckDB: Fetching ${name} from ${url}...`);
    
    try {
        // Fetch as buffer to avoid DuckDB's internal HTTP-stoi parsing issues
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        
        const buffer = new Uint8Array(await response.arrayBuffer());
        
        // Register as a LOCAL buffer
        await db.registerFileBuffer(`${name}.parquet`, buffer);
        
        // MATERIALIZE as a table
        await conn.query(`CREATE TABLE ${name} AS SELECT * FROM read_parquet('${name}.parquet')`);
        
        const result = await conn.query(`SELECT count(*) FROM ${name}`);
        console.log(`✅ Materialized ${name}:`, result.toArray()[0]);
    } catch (error) {
        console.error(`❌ Failed to load ${name}:`, error);
        throw error;
    } finally {
        await conn.close();
    }
}

const duckdb = require('duckdb');
const fs = require('fs-extra');
const path = require('path');

const db = new duckdb.Database(':memory:');
const con = db.connect();

const CACHE_DIR = path.join(__dirname, '../.cache');
const OUTPUT_DIR = path.join(__dirname, '../../web/public/data');

async function runQuery(query) {
    return new Promise((resolve, reject) => {
        con.run(query, (err) => {
            if (err) reject(err);
            else resolve();
        });
    });
}

async function main() {
    console.log('🦆 DuckDB: Converting GeoJSON to optimized Parquet...');
    await fs.ensureDir(OUTPUT_DIR);

    try {
        // Install and load spatial extension
        await runQuery('INSTALL spatial; LOAD spatial;');

        const files = [
            { name: 'slots', path: path.join(CACHE_DIR, 'slots.json') },
            { name: 'violations', path: path.join(CACHE_DIR, 'violations.json') },
            { name: 'hubi', path: path.join(CACHE_DIR, 'hubi.json') }
        ];

        for (const file of files) {
            if (!(await fs.pathExists(file.path))) {
                console.warn(`[WARN] Skipping ${file.name}, source not found.`);
                continue;
            }

            console.log(`[PROCESS] ${file.name} -> Parquet...`);
            
            // 2026 Strategy: Read GeoJSON, extract properties and geometry as WKB
            // This makes it compatible with most GeoParquet readers
            const parquetPath = path.join(OUTPUT_DIR, `${file.name}.parquet`);
            
            // Clean up old file
            if (await fs.pathExists(parquetPath)) await fs.remove(parquetPath);

            await runQuery(`
                COPY (
                    SELECT * FROM ST_Read('${file.path.replace(/\\/g, '/')}')
                ) TO '${parquetPath.replace(/\\/g, '/')}' (FORMAT 'PARQUET');
            `);
            
            const stats = await fs.stat(parquetPath);
            console.log(`✅ ${file.name}.parquet created (${(stats.size / 1024 / 1024).toFixed(2)} MB)`);
        }

        console.log('🚀 All spatial assets optimized for DuckDB-Wasm.');
    } catch (e) {
        console.error('❌ DuckDB Process Failed:', e);
        process.exit(1);
    }
}

main();

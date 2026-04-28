const duckdb = require('duckdb');
const path = require('path');

const db = new duckdb.Database(':memory:');
const con = db.connect();

const OUTPUT_DIR = path.join(__dirname, '../../web/public/data');
const slotsPath = path.join(OUTPUT_DIR, 'slots.parquet').replace(/\\/g, '/');
const violationsPath = path.join(OUTPUT_DIR, 'violations.parquet').replace(/\\/g, '/');

async function runQuery(query) {
    return new Promise((resolve, reject) => {
        con.all(query, (err, res) => {
            if (err) reject(err);
            else resolve(res);
        });
    });
}

async function main() {
    await runQuery('INSTALL spatial; LOAD spatial;');
    
    console.log("--- Slots Schema ---");
    const slotsSchema = await runQuery(`DESCRIBE SELECT * FROM '${slotsPath}'`);
    console.log(slotsSchema);

    console.log("--- Sample Slots Data ---");
    const slotsData = await runQuery(`SELECT * EXCLUDE (geom) FROM '${slotsPath}' LIMIT 3`);
    console.log(slotsData);
    
    console.log("--- Fines Schema ---");
    const finesSchema = await runQuery(`DESCRIBE SELECT * FROM '${violationsPath}'`);
    console.log(finesSchema);

    console.log("--- Sample Fines Data ---");
    const finesData = await runQuery(`SELECT * EXCLUDE (geom) FROM '${violationsPath}' LIMIT 3`);
    console.log(finesData);
}

main().catch(console.error);

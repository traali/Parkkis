const duckdb = require('duckdb');
const db = new duckdb.Database(':memory:');
const con = db.connect();

con.all(`
INSTALL spatial; LOAD spatial; 
SELECT 
    luokka_nimi, 
    tyyppi, 
    count(*) as count 
FROM 'c:/dev/parkkisakko2/web/public/data/slots.parquet' 
GROUP BY 1, 2 
ORDER BY count DESC;
`, function(err, res) {
    if (err) console.error(err);
    else console.table(res);
});

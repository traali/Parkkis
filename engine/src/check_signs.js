const duckdb = require("duckdb");
const path = require("node:path");

const db = new duckdb.Database(":memory:");
const con = db.connect();

const parquetPath = path.join(
  __dirname,
  "../../web/public/data/signs.parquet"
);

// First, describe the schema
con.all(`DESCRIBE SELECT * FROM '${parquetPath}' LIMIT 1`, (err, schema) => {
  if (err) {
    console.error("DESCRIBE error:", err);
    process.exit(1);
  }
  console.log("\n=== SCHEMA ===");
  console.table(schema);

  // Then check for speed limit related columns and values
  con.all(
    `SELECT tyyppi, kilpi_txt1, kilpi_txt2, kilpi_txt3, kilpi_txt4, kilpi_txt5
     FROM '${parquetPath}'
     WHERE tyyppi IN ('C32', 'C34', 'C37', 'C38', 'C39', 'C40')
     LIMIT 30`,
    (err2, rows) => {
      if (err2) {
        console.error("Query error:", err2);
        process.exit(1);
      }
      console.log("\n=== SPEED LIMIT SIGN SAMPLES (C32/C34/C37-C40) ===");
      console.table(rows);

      // Check all unique tyyppi values and their counts
      con.all(
        `SELECT tyyppi, count(*) as count FROM '${parquetPath}' GROUP BY tyyppi ORDER BY count DESC`,
        (err3, counts) => {
          if (err3) {
            console.error("Count query error:", err3);
            process.exit(1);
          }
          console.log("\n=== SIGN TYPE COUNTS ===");
          console.table(counts);

          // Check all columns that might have ordering info
          con.all(
            `SELECT * FROM '${parquetPath}' LIMIT 3`,
            (err4, sample) => {
              if (err4) {
                console.error("Sample query error:", err4);
                process.exit(1);
              }
              console.log("\n=== FULL ROW SAMPLE ===");
              if (sample && sample.length > 0) {
                console.log("Columns:", Object.keys(sample[0]));
                sample.forEach((row, i) => {
                  console.log(`\nRow ${i + 1}:`, JSON.stringify(row, null, 2));
                });
              }
            }
          );
        }
      );
    }
  );
});

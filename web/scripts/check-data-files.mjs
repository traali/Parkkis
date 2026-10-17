// Fails the build if a data file the app loads is missing or is not Parquet
// (a missing file is served as the HTML app by the static host and breaks DuckDB).
import { readFileSync, existsSync, openSync, readSync, closeSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const DATA = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'data');
const manifest = JSON.parse(readFileSync(join(DATA, 'manifest.json'), 'utf8'));
const bad = [];
for (const name of Object.keys(manifest.datasets)) {
  const p = join(DATA, `${name}.parquet`);
  if (!existsSync(p)) { bad.push(`${name}.parquet missing`); continue; }
  const fd = openSync(p, 'r'); const b = Buffer.alloc(4); readSync(fd, b, 0, 4, 0); closeSync(fd);
  if (b.toString('latin1') !== 'PAR1') bad.push(`${name}.parquet is not Parquet`);
}
if (bad.length) { console.error('Data check failed:\n  ' + bad.join('\n  ')); process.exit(1); }
console.log(`Data check ok: ${Object.keys(manifest.datasets).length} parquet files`);

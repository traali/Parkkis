#!/usr/bin/env node
// Refresh engine/data/pelipaiva-venues.json from Pelipäivä's venue table
// (src/lib/geo/sportsGeocoder.ts, NATIONAL_FIELD_ALIASES). Used by the ingest
// validation to check that the OSM snapshot covers the venues Pelipäivä links to.
//   node engine/scripts/sync-venues.mjs [path-or-url-to-sportsGeocoder.ts]
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_URL = "https://raw.githubusercontent.com/traali/pelipaiva/main/src/lib/geo/sportsGeocoder.ts";
const src = process.argv[2] ?? DEFAULT_URL;
const text = /^https?:/.test(src) ? await (await fetch(src)).text() : readFileSync(src, "utf8");

const re = /\{\s*name:\s*'((?:[^'\\]|\\.)*)',\s*lat:\s*([\d.]+),\s*lng:\s*([\d.]+)/g;
const byName = new Map();
for (const m of text.matchAll(re)) {
  const name = m[1].replace(/\\'/g, "'");
  if (!byName.has(name)) byName.set(name, { name, lat: Number(m[2]), lon: Number(m[3]) });
}
const venues = [...byName.values()].sort((a, b) => a.name.localeCompare(b.name, "fi"));
if (venues.length < 20) throw new Error(`Only ${venues.length} venues parsed from ${src}; format changed?`);
const out = join(dirname(fileURLToPath(import.meta.url)), "../data/pelipaiva-venues.json");
writeFileSync(out, `${JSON.stringify({ source: src, synced_at: new Date().toISOString().slice(0, 10), venues }, null, 1)}\n`);
console.log(`Wrote ${venues.length} venues to ${out}`);

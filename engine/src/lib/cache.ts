import path from "node:path";
import fs from "fs-extra";

export const CACHE_DIR = path.join(__dirname, "../../.cache");

export interface FetchMeta {
  dataset: string;
  source: string;
  licence: string;
  fetched_at: string;
  /** Source-side timestamp when the source publishes one (e.g. OSM replication time). */
  source_timestamp?: string | null;
  [key: string]: unknown;
}

/** Write a FeatureCollection plus a small metadata file used for the manifest. */
export interface DatasetInfo {
  source: string;
  licence: string;
  source_timestamp?: string | null;
  [key: string]: unknown;
}

export async function writeDataset(name: string, features: any[], meta: DatasetInfo) {
  if (features.length === 0) throw new Error(`${name}: refusing to write an empty dataset`);
  await fs.ensureDir(CACHE_DIR);
  await fs.writeJson(path.join(CACHE_DIR, `${name}.json`), { type: "FeatureCollection", features });
  const full: FetchMeta = { ...meta, dataset: name, fetched_at: new Date().toISOString() };
  await fs.writeJson(path.join(CACHE_DIR, `${name}.meta.json`), full, { spaces: 2 });
  console.log(`[WRITE] ${name}: ${features.length} features`);
}

/** Run a fetcher; any error exits non-zero so CI never commits partial data. */
export function runMain(label: string, fn: () => Promise<void>) {
  fn().then(
    () => console.log(`✅ ${label} done`),
    (err) => {
      console.error(`❌ ${label} failed:`, err?.message ?? err);
      process.exit(1);
    },
  );
}

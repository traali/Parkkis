import path from "node:path";
import * as turf from "@turf/turf";
import axios from "axios";
import fs from "fs-extra";
import pLimit from "p-limit";

const _limit = pLimit(5);

// Digiroad covers ALL municipalities (Helsinki=91, Espoo=49, Vantaa=92, Kauniainen=235)
// Helsinki/Espoo/Vantaa municipal sign WFS layers are not available publicly (400 errors).
const SOURCES = {
  DIGI_WFS:
    "https://avoinapi.vaylapilvi.fi/vaylatiedot/digiroad/ows?service=WFS&version=2.0.0&request=GetFeature&typeName=dr_liikennemerkit&outputFormat=application/json&srsName=EPSG:4326",
};

const HEADERS = {
  "User-Agent": "Parkkis/2.6 (Regional Sign Harvester; arto.oinonen@gmail.com)",
  Accept: "application/json",
};

export class HarvesterClient {
  async fetchWithRetry(url: string, retries = 3) {
    for (let i = 0; i < retries; i++) {
      try {
        return await axios.get(url, { headers: HEADERS, timeout: 180000 });
      } catch (err: any) {
        if (i === retries - 1) throw err;
        console.warn(`[RETRY ${i + 1}] Failed: ${err.message}`);
        await new Promise((res) => setTimeout(res, 5000 * (i + 1)));
      }
    }
  }

  async fetchWFS(baseUrl: string, label: string) {
    console.log(`[WFS] ${label}...`);
    const pageSize = 5000;
    let startIndex = 0;
    const allFeatures: any[] = [];
    let hasMore = true;

    while (hasMore) {
      const url = `${baseUrl}&count=${pageSize}&startIndex=${startIndex}`;
      const response = await this.fetchWithRetry(url);
      const features = response?.data?.features || [];
      allFeatures.push(...features);
      console.log(`  +${features.length} (total ${allFeatures.length})`);
      if (features.length < pageSize) hasMore = false;
      else startIndex += pageSize;
    }
    return allFeatures;
  }

  async fetchDigiroadSigns() {
    // Covers Helsinki (91), Espoo (49), Vantaa (92), Kauniainen (235)
    console.log(`[SIGNS] Fetching Digiroad signs for Capital Region (kuntakoodi 91,49,92,235)...`);
    const signTypes = [
      "C37", "C38", "C39", "C40", "C44.1", "C44.2",
      "E2", "E3.1", "E3.2", "E3.3", "E3.4", "E3.5",
      "E4.1", "E4.2", "E4.3", "E22", "E23", "E24", "E26", "E28",
      "C32", "C34",
      "H12.1", "H12.2", "H17.1", "H17.2", "H17.3", "H18", "H19", "H20", "H21", "H24", "H25",
    ];
    const cql = `kuntakoodi IN (91, 49, 92, 235) AND tyyppi IN (${signTypes.map((t) => `'${t}'`).join(",")})`;
    const pageSize = 5000;
    let startIndex = 0;
    const allFeatures: any[] = [];
    let hasMore = true;

    while (hasMore) {
      const url = `${SOURCES.DIGI_WFS}&count=${pageSize}&startIndex=${startIndex}&cql_filter=${encodeURIComponent(cql)}`;
      const response = await this.fetchWithRetry(url);
      const features = response?.data?.features || [];
      allFeatures.push(...features);
      console.log(`  Digiroad: +${features.length} (total ${allFeatures.length})`);
      if (features.length < pageSize) hasMore = false;
      else startIndex += pageSize;
    }
    return allFeatures;
  }
}

async function main() {
  const client = new HarvesterClient();
  const CACHE_DIR = path.join(process.cwd(), ".cache");
  await fs.ensureDir(CACHE_DIR);

  try {
    console.log("🚀 Starting Regional Sign Harvest...");

    const signs = await client.fetchDigiroadSigns();

    console.log(`\n[WRITE] Saving ${signs.length} signs to cache...`);
    await fs.writeJson(path.join(CACHE_DIR, "signs.json"), turf.featureCollection(signs));

    console.log(`✅ Sign Harvest Complete. Digiroad: ${signs.length} (covers Helsinki, Espoo, Vantaa, Kauniainen)`);
  } catch (e) {
    console.error("❌ Sign Harvest Failed:", e);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

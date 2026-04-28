import path from "node:path";
import axios from "axios";
import fs from "fs-extra";

const LIIPI_API = "https://parking.fintraffic.fi/api/v1/facilities.geojson";
const CACHE_DIR = path.join(process.cwd(), ".cache");

async function fetchLiipi() {
  console.log("[LIIPI] Fetching Park & Ride facilities from Fintraffic...");
  try {
    const response = await axios.get(LIIPI_API, {
      headers: {
        "Digitraffic-User":
          "Parkkis/2.4 (Transit Synergy Engine; arto.oinonen@gmail.com)",
      },
    });

    const data = response.data;
    if (data.type !== "FeatureCollection") {
      throw new Error("Invalid GeoJSON response from LiiPi");
    }

    console.log(`[LIIPI] Received ${data.features.length} facilities.`);

    await fs.ensureDir(CACHE_DIR);
    await fs.writeJson(path.join(CACHE_DIR, "liipi.json"), data);
    console.log("✅ LiiPi Harvest Complete.");
  } catch (err: any) {
    console.error("❌ LiiPi Harvest Failed:", err.message);
    process.exit(1);
  }
}

fetchLiipi();

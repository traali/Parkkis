import path from "node:path";
import axios from "axios";
import fs from "fs-extra";

const HEL_WFS_URL = "https://kartta.hel.fi/ws/geoserver/avoindata/wfs";
const LAYER_NAME = "avoindata:Winkki_works";

async function fetchRoadworks() {
  console.log("--- Phase 2: Fetching Roadworks ---");
  const CACHE_DIR = path.join(process.cwd(), ".cache");
  await fs.ensureDir(CACHE_DIR);

  const params = {
    service: "WFS",
    version: "2.0.0",
    request: "GetFeature",
    typeName: LAYER_NAME,
    outputFormat: "application/json",
    srsName: "EPSG:4326",
    cql_filter: "licence_status='ACTIVE'",
  };

  try {
    const response = await axios.get(HEL_WFS_URL, { params });
    const data = response.data;

    console.log(
      `Fetched ${data.features.length} active roadworks/disruptions.`,
    );

    const outputPath = path.join(CACHE_DIR, "roadworks.json");
    await fs.writeJson(outputPath, data);
    console.log(`Saved to ${outputPath}`);
  } catch (err: any) {
    console.error("Error fetching roadworks:", err.message);
    if (err.response) {
      console.error("Response:", err.response.data);
    }
  }
}

fetchRoadworks();

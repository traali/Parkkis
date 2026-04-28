import path from "node:path";
import * as turf from "@turf/turf";
import axios from "axios";
import fs from "fs-extra";
import pLimit from "p-limit";

// Constants
const CACHE_DIR = path.join(process.cwd(), ".cache/raw");
const OUTPUT_DIR = path.join(process.cwd(), "frontend/public/data");
const CONCURRENCY_LIMIT = 5;
const _limit = pLimit(CONCURRENCY_LIMIT);

// Sources
const SOURCES = {
  PARKKIHUBI_AREAS: "https://pubapi.parkkiopas.fi/public/v1/parking_area/",
  FINTRAFFIC_PR: "https://liippapi.fintraffic.fi/v1/parking-facilities", // Standard LIIPI endpoint
  VIOLATIONS:
    "https://kartta.hel.fi/ws/geoserver/avoindata/wfs?service=WFS&version=2.0.0&request=GetFeature&typeName=avoindata:Pysakointivirheet&outputFormat=application/json",
  PARKKIPAIKAT_HEL:
    "https://kartta.hel.fi/ws/geoserver/avoindata/wfs?service=WFS&version=2.0.0&request=GetFeature&typeName=avoindata:Pysakointipaikat_alue&outputFormat=application/json",
};

const WEIGHTS = {
  VIOLATION: 0.2,
  BASE_RISK: 1.0,
};

async function fetchWithRetry(url: string, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      return await axios.get(url, { timeout: 30000 });
    } catch (err: any) {
      if (i === retries - 1) throw err;
      await new Promise((res) => setTimeout(res, 1000 * (i + 1)));
    }
  }
}

async function fetchParkkihubi() {
  console.log("[PIPELINE] Fetching Parkkihubi (Helsinki) areas...");
  let url: string | null = SOURCES.PARKKIHUBI_AREAS;
  const allFeatures: any[] = [];

  while (url) {
    console.log(`[FETCH] ${url}`);
    const response = await fetchWithRetry(url);
    if (!response?.data) break;

    allFeatures.push(...(response.data.features || []));
    url = response.data.next;
  }

  return turf.featureCollection(allFeatures);
}

async function fetchFintraffic() {
  console.log("[PIPELINE] Fetching Fintraffic (Espoo/Vantaa) P&R...");
  try {
    const response = await fetchWithRetry(SOURCES.FINTRAFFIC_PR);
    if (!response?.data) return turf.featureCollection([]);

    // LIIPI returns a list of facilities, we need to map them to points
    const features = response.data.map((fac: any) => {
      return turf.point([fac.longitude, fac.latitude], {
        id: fac.id,
        name: fac.name,
        city: fac.city,
        capacity: fac.capacity,
        provider: "Fintraffic",
        type: "P&R",
      });
    });
    return turf.featureCollection(features);
  } catch (_e) {
    console.warn("[WARN] Fintraffic fetch failed, continuing without P&R.");
    return turf.featureCollection([]);
  }
}

async function fetchViolations() {
  console.log("[PIPELINE] Fetching historical violations (chunked)...");
  const cacheFile = path.join(CACHE_DIR, "violations.json");

  if (await fs.pathExists(cacheFile)) {
    const stats = await fs.stat(cacheFile);
    if (Date.now() - stats.mtimeMs < 86400000) {
      console.log("[CACHE] Using cached violations.");
      return fs.readJson(cacheFile);
    }
  }

  const pageSize = 5000;
  let startIndex = 0;
  const allFeatures: any[] = [];
  let hasMore = true;

  while (hasMore) {
    console.log(`[FETCH] Violations: ${startIndex}...`);
    const url = `${SOURCES.VIOLATIONS}&count=${pageSize}&startIndex=${startIndex}`;
    const response = await fetchWithRetry(url);
    if (!response?.data) break;

    const features = response.data.features || [];
    allFeatures.push(...features);

    if (features.length < pageSize) {
      hasMore = false;
    } else {
      startIndex += pageSize;
    }
  }

  const finalResult = { type: "FeatureCollection", features: allFeatures };
  await fs.ensureDir(CACHE_DIR);
  await fs.writeJson(cacheFile, finalResult);
  return finalResult;
}

async function fetchParkingPlaces() {
  console.log(
    "[PIPELINE] Fetching Helsinki individual slots (Pysakointipaikat)...",
  );
  const pageSize = 5000;
  let startIndex = 0;
  const allFeatures: any[] = [];
  let hasMore = true;

  while (hasMore) {
    console.log(`[FETCH] Slots: ${startIndex}...`);
    const url = `${SOURCES.PARKKIPAIKAT_HEL}&count=${pageSize}&startIndex=${startIndex}`;
    const response = await fetchWithRetry(url);
    if (!response?.data) break;

    const features = response.data.features || [];
    allFeatures.push(...features);

    if (features.length < pageSize) {
      hasMore = false;
    } else {
      startIndex += pageSize;
    }
  }

  return turf.featureCollection(allFeatures);
}

async function main() {
  console.log("🚀 Starting Parkkisakko Ingestion Pipeline (Docker-Free)");
  await fs.ensureDir(OUTPUT_DIR);

  const [helsinkiAreas, fintrafficSpots, violations, helsinkiSlots] =
    await Promise.all([
      fetchParkkihubi(),
      fetchFintraffic(),
      fetchViolations(),
      fetchParkingPlaces(),
    ]);

  console.log(
    `[PROCESS] Analyzing ${helsinkiAreas.features.length} Helsinki areas and ${helsinkiSlots.features.length} slots...`,
  );

  // Risk Calculation
  const processedHelsinki = helsinkiAreas.features.map((area: any) => {
    const center = turf.centroid(area);
    const buffer = turf.circle(center, 0.1, { units: "kilometers" }); // 100m radius for fine density
    const nearbyViolations = turf.pointsWithinPolygon(violations, buffer);

    let risk =
      WEIGHTS.BASE_RISK + nearbyViolations.features.length * WEIGHTS.VIOLATION;
    risk = Math.min(10, Math.ceil(risk));

    return turf.feature(area.geometry, {
      ...area.properties,
      risk_score: risk,
      violation_count: nearbyViolations.features.length,
      city: "Helsinki",
      source: "Parkkihubi",
    });
  });

  // Process Slots (Individual places)
  const processedSlots = helsinkiSlots.features.map((slot: any) => {
    const center = turf.centroid(slot);
    const buffer = turf.circle(center, 0.05, { units: "kilometers" }); // 50m radius for precision
    const nearbyViolations = turf.pointsWithinPolygon(violations, buffer);

    let risk =
      WEIGHTS.BASE_RISK + nearbyViolations.features.length * WEIGHTS.VIOLATION;
    risk = Math.min(10, Math.ceil(risk));

    return turf.feature(slot.geometry, {
      ...slot.properties,
      address: slot.properties.osoite || slot.properties.street_name,
      max_duration:
        slot.properties.pysakointiaika || slot.properties.max_duration,
      payment_types:
        slot.properties.maksullisuus || slot.properties.payment_types,
      risk_score: risk,
      violation_count: nearbyViolations.features.length,
      city: "Helsinki",
      source: "Helsinki_WFS",
      type: "slot",
    });
  });

  // Merge everything
  const allSpots = [
    ...processedHelsinki.map((f) => ({
      ...f,
      properties: { ...f.properties, type: "area" },
    })),
    ...processedSlots,
    ...fintrafficSpots.features.map((f: any) => ({
      ...f,
      properties: {
        ...f.properties,
        risk_score: 1,
        violation_count: 0,
        type: "p_and_r",
      },
    })),
  ];

  const finalFC = turf.featureCollection(allSpots);

  console.log("[WRITE] Saving unified risk map...");
  await fs.writeJson(path.join(OUTPUT_DIR, "risk.geojson"), finalFC);

  await fs.writeJson(path.join(OUTPUT_DIR, "meta.json"), {
    updated_at: new Date().toISOString(),
    total_features: allSpots.length,
    version: "2.0.0-dockerfree",
  });

  console.log("✅ Ingestion Complete. Data saved to public/data/risk.geojson");
}

main().catch((error) => {
  console.error("❌ Pipeline Failed:", error);
  process.exit(1);
});

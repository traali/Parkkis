import path from "node:path";
import * as turf from "@turf/turf";
import axios from "axios";
import fs from "fs-extra";
import pLimit from "p-limit";
import { XMLParser } from "fast-xml-parser";

const _limit = pLimit(5);

// Espoo has 555 parking zones total — small enough to fetch in one shot

// ─── Regional Configuration ───────────────────────────────────────────────────
// Espoo only supports GML (not JSON), so uses a separate adapter.
// Vantaa does not publish parking WFS publicly — covered by Digiroad (kuntakoodi=92).
const REGIONS = [
  {
    name: "Helsinki",
    wfs: "https://kartta.hel.fi/ws/geoserver/avoindata/wfs",
    version: "2.0.0",
    format: "json" as const,
    layers: ["avoindata:Pysakointipaikat_alue"],
    srs: "EPSG:4326",
  },
  {
    name: "Espoo",
    wfs: "https://kartat.espoo.fi/teklaogcweb/wfs.ashx",
    version: "1.1.0",
    format: "gml" as const,
    layers: ["GIS:PKSEspooPysakointialueet"],
    srs: "EPSG:4326",
  },
];

const SOURCES = {
  PARKKIHUBI: "https://pubapi.parkkiopas.fi/public/v1/parking_area/",
  WFS_FINES:
    "https://kartta.hel.fi/ws/geoserver/avoindata/wfs?service=WFS&version=2.0.0&request=GetFeature&typeName=avoindata:Pysakointivirheet&outputFormat=application/json&srsName=EPSG:4326",
};

const HEADERS = {
  "User-Agent": "Parkkis/2.6 (Regional Expansion Engine; arto.oinonen@gmail.com)",
  Accept: "application/json, text/xml",
};

// ─── GML → GeoJSON converter ──────────────────────────────────────────────────
// NOTE: do NOT use isArray for featureMember — it causes sub-nodes to be treated as features
const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  parseAttributeValue: true,
});

function gmlGeomToGeoJSON(geomNode: any): any {
  if (!geomNode) return null;

  // Point
  if (geomNode["gml:Point"]) {
    const pos = geomNode["gml:Point"]["gml:pos"];
    if (!pos) return null;
    const parts = pos.trim().split(/\s+/).map(Number);
    return { type: "Point", coordinates: [parts[0], parts[1]] };
  }

  // Polygon
  const polygon = geomNode["gml:Polygon"];
  if (polygon) {
    const posList = polygon?.["gml:exterior"]?.["gml:LinearRing"]?.["gml:posList"];
    if (posList) {
      const parts = posList.trim().split(/\s+/).map(Number);
      const ring: number[][] = [];
      for (let i = 0; i < parts.length; i += 2) ring.push([parts[i], parts[i + 1]]);
      return { type: "Polygon", coordinates: [ring] };
    }
  }

  // MultiPolygon
  const mp = geomNode["gml:MultiPolygon"];
  if (mp) {
    const member = mp["gml:polygonMember"];
    const members = Array.isArray(member) ? member : [member];
    const polygons: number[][][] = [];
    for (const m of members) {
      const posList = m?.["gml:Polygon"]?.["gml:exterior"]?.["gml:LinearRing"]?.["gml:posList"];
      if (posList) {
        const parts = posList.trim().split(/\s+/).map(Number);
        const ring: number[][] = [];
        for (let i = 0; i < parts.length; i += 2) ring.push([parts[i], parts[i + 1]]);
        polygons.push(ring);
      }
    }
    return { type: "MultiPolygon", coordinates: polygons.map((r) => [r]) };
  }

  return null;
}

function parseEspooGML(xmlText: string, region: string): any[] {
  const parsed = xmlParser.parse(xmlText);
  const fc = parsed?.["wfs:FeatureCollection"];
  if (!fc) return [];

  // featureMember may be a single object or array
  const rawMembers = fc["gml:featureMember"];
  const members: any[] = Array.isArray(rawMembers) ? rawMembers : rawMembers ? [rawMembers] : [];

  const results: any[] = [];
  for (const m of members) {
    // Each member has exactly one feature key
    const featureKey = Object.keys(m).find((k) => k.startsWith("GIS:"));
    if (!featureKey) continue;
    const feature = m[featureKey];
    if (!feature || typeof feature !== "object") continue;

    const props: Record<string, any> = { city: region, source: `WFS_${region}` };
    for (const [k, v] of Object.entries(feature)) {
      if (!k.toLowerCase().includes("geom") && !k.toLowerCase().includes("geometry")) {
        const propName = k.replace(/^GIS:/, "").toLowerCase();
        props[propName] = v;
      }
    }
    props.address = String(props.street_address_fi || props.street_address_en || "");
    props.luokka_nimi = String(props.class || "");
    props.capacity = Number(props.parking_spaces || 0);

    const geomKey = Object.keys(feature).find((k) =>
      k.toLowerCase().includes("geometry") || k.toLowerCase().includes("shape")
    );
    const geometry = geomKey ? gmlGeomToGeoJSON(feature[geomKey]) : null;
    if (!geometry) continue; // Skip features with no parseable geometry

    results.push({ type: "Feature", geometry, properties: props });
  }
  return results;
}

// ─── Client ───────────────────────────────────────────────────────────────────
export class HarvesterClient {
  async fetchWithRetry(url: string, retries = 3, responseType: "json" | "text" = "json") {
    for (let i = 0; i < retries; i++) {
      try {
        return await axios.get(url, { headers: HEADERS, timeout: 90000, responseType });
      } catch (err: any) {
        if (i === retries - 1) throw err;
        console.warn(`[RETRY ${i + 1}] ${url.substring(0, 80)}: ${err.message}`);
        await new Promise((res) => setTimeout(res, 2000 * (i + 1)));
      }
    }
  }

  /** Fetch a JSON WFS layer with pagination */
  async fetchWFSJson(baseUrl: string, version: string, typeName: string, region: string) {
    console.log(`[WFS/JSON] ${region}: ${typeName}`);
    const pageSize = 5000;
    let startIndex = 0;
    const allFeatures: any[] = [];
    let hasMore = true;

    while (hasMore) {
      const url = `${baseUrl}?service=WFS&version=${version}&request=GetFeature&typeName=${typeName}&outputFormat=application/json&srsName=EPSG:4326&count=${pageSize}&startIndex=${startIndex}`;
      const response = await this.fetchWithRetry(url, 3, "json");
      const features = response?.data?.features || [];

      const normalized = features.map((f: any) => ({
        ...f,
        properties: {
          ...f.properties,
          city: region,
          source: `WFS_${region}`,
          address: f.properties.osoite || f.properties.osoite_fi || f.properties.street_name || "",
          capacity: Number(f.properties.paikat_ala || f.properties.paikkamaara || 0),
        },
      }));

      allFeatures.push(...normalized);
      console.log(`  +${features.length} (total ${allFeatures.length})`);

      if (features.length < pageSize) hasMore = false;
      else startIndex += pageSize;
    }
    return allFeatures;
  }

  /** Fetch a GML WFS layer (Espoo Tekla) — single shot, total ≤ 2000 features */
  async fetchWFSGml(baseUrl: string, version: string, typeName: string, region: string) {
    console.log(`[WFS/GML] ${region}: ${typeName} (single-shot fetch)`);
    // Espoo has ≤ 600 parking zones — fetch all at once with a safe upper cap
    const url = `${baseUrl}?service=WFS&version=${version}&request=GetFeature&typeName=${typeName}&outputFormat=text/xml; subtype=gml/3.1.1&srsName=EPSG:4326&maxFeatures=5000`;
    const response = await this.fetchWithRetry(url, 3, "text");
    const xmlText = response?.data;
    if (!xmlText) return [];
    const features = parseEspooGML(xmlText, region);
    console.log(`  fetched ${features.length} features`);
    return features;
  }

  async fetchParkkihubi() {
    console.log("[HUBI] Fetching real-time areas...");
    let url: string | null = SOURCES.PARKKIHUBI;
    const allFeatures: any[] = [];

    while (url) {
      const response = await this.fetchWithRetry(url, 3, "json");
      allFeatures.push(...(response?.data?.features || []));
      url = response?.data?.next;
      if (url) console.log(`  → next: ${url.substring(0, 60)}`);
    }
    return turf.featureCollection(allFeatures);
  }
}

// ─── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  const client = new HarvesterClient();
  const CACHE_DIR = path.join(process.cwd(), ".cache");
  await fs.ensureDir(CACHE_DIR);

  try {
    console.log("🚀 Starting Multi-Regional Parking Harvest...");

    // 1. Fetch slots from all regions
    let allSlots: any[] = [];
    for (const region of REGIONS) {
      for (const layer of region.layers) {
        try {
          const features =
            region.format === "gml"
              ? await client.fetchWFSGml(region.wfs, region.version, layer, region.name)
              : await client.fetchWFSJson(region.wfs, region.version, layer, region.name);
          allSlots.push(...features);
          console.log(`[OK] ${region.name} (${layer}): ${features.length} features`);
        } catch (e: any) {
          console.error(`[ERROR] ${region.name} (${layer}): ${e.message}`);
        }
      }
    }

    // 2. Violations (Helsinki) + Parkkihubi
    console.log("\n[WFS/JSON] Violations + Parkkihubi...");
    const [fines, hubi] = await Promise.all([
      client.fetchWFSJson(
        SOURCES.WFS_FINES.split("?")[0],
        "2.0.0",
        "avoindata:Pysakointivirheet",
        "Helsinki"
      ),
      client.fetchParkkihubi(),
    ]);

    // 3. Write cache
    console.log("\n[WRITE] Saving to cache...");
    await fs.writeJson(path.join(CACHE_DIR, "slots.json"), turf.featureCollection(allSlots));
    await fs.writeJson(path.join(CACHE_DIR, "violations.json"), turf.featureCollection(fines));
    await fs.writeJson(path.join(CACHE_DIR, "hubi.json"), hubi);

    console.log(`\n✅ Harvest Complete.`);
    console.log(`   Slots: ${allSlots.length} (Helsinki + Espoo)`);
    console.log(`   Violations: ${fines.length}`);
  } catch (e) {
    console.error("❌ Harvest Failed:", e);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

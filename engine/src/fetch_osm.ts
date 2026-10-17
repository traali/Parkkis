// OpenStreetMap parking (amenity=parking) for all of Finland via Overpass.
// © OpenStreetMap contributors, ODbL 1.0. Covers every venue Pelipäivä can link
// to, including those outside Helsinki/Espoo open-data coverage.
import axios from "axios";
import { writeDataset, runMain } from "./lib/cache";
import { USER_AGENT } from "./lib/http";

/** Public Overpass instances, tried in order (overpass-api.de is often busy). */
export const OVERPASS_MIRRORS = [
  "https://overpass-api.de/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];

const QUERY = `[out:json][timeout:600];
area["ISO3166-1"="FI"][admin_level=2]->.fi;
nwr["amenity"="parking"](area.fi);
out center tags;`;

/** Tags passed through to the map. Each is shown only when OSM has it. */
export const OSM_TAGS = [
  "name", "capacity", "capacity:disabled", "capacity:charging", "fee", "access",
  "parking", "maxstay", "operator", "opening_hours", "park_ride", "wheelchair", "surface",
] as const;

/** Lots closed to visitors are left out: they are not somewhere a family can park. */
const EXCLUDED_ACCESS = new Set(["private", "no"]);

export function osmElementsToFeatures(elements: any[]): any[] {
  const out: any[] = [];
  for (const e of elements) {
    const tags = e.tags ?? {};
    if (tags.amenity !== "parking") continue;
    if (EXCLUDED_ACCESS.has(tags.access)) continue;
    const lat = e.lat ?? e.center?.lat;
    const lon = e.lon ?? e.center?.lon;
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const props: Record<string, string | null> = { osm_id: `${e.type}/${e.id}` };
    for (const t of OSM_TAGS) props[t.replace(/:/g, "_")] = tags[t] ?? null;
    out.push({ type: "Feature", geometry: { type: "Point", coordinates: [lon, lat] }, properties: props });
  }
  return out;
}

async function queryOverpass(): Promise<{ elements: any[]; osmBase: string | null; mirror: string }> {
  const errors: string[] = [];
  for (const mirror of OVERPASS_MIRRORS) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        console.log(`[OSM] ${mirror} (attempt ${attempt})`);
        const res = await axios.post(mirror, new URLSearchParams({ data: QUERY }).toString(), {
          headers: { "User-Agent": USER_AGENT, "Content-Type": "application/x-www-form-urlencoded" },
          timeout: 660000,
          maxContentLength: 200 * 1024 * 1024,
        });
        const data = res.data;
        if (!Array.isArray(data?.elements)) throw new Error("no elements array (HTML error page?)");
        if (data.remark) throw new Error(`Overpass remark: ${data.remark}`);
        return { elements: data.elements, osmBase: data.osm3s?.timestamp_osm_base ?? null, mirror };
      } catch (err: any) {
        errors.push(`${mirror}: ${err.message}`);
        console.warn(`[OSM] failed: ${err.message}`);
        await new Promise((r) => setTimeout(r, 15000 * attempt));
      }
    }
  }
  throw new Error(`All Overpass mirrors failed:\n${errors.join("\n")}`);
}

if (require.main === module) {
  runMain("OpenStreetMap parking harvest", async () => {
    const { elements, osmBase, mirror } = await queryOverpass();
    const features = osmElementsToFeatures(elements);
    console.log(`[OSM] ${elements.length} elements → ${features.length} visitor-usable parking features`);
    await writeDataset("osm", features, {
      source: `${mirror} (amenity=parking, Finland)`,
      licence: "ODbL 1.0, © OpenStreetMap contributors",
      source_timestamp: osmBase,
      elements_total: elements.length,
    });
  });
}

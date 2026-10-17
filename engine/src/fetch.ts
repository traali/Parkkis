// Helsinki parking spaces + fines, Espoo parking areas, Parkkihubi areas.
// Every source must succeed; a failure exits non-zero (see runMain) so the
// daily workflow never commits empty or partial data.
import { XMLParser } from "fast-xml-parser";
import { writeDataset, runMain } from "./lib/cache";
import { fetchWfsJsonAll, getWithRetry } from "./lib/http";

const HEL_WFS = "https://kartta.hel.fi/ws/geoserver/avoindata/wfs";
const ESPOO_WFS = "https://kartat.espoo.fi/teklaogcweb/wfs.ashx";
const PARKKIHUBI = "https://pubapi.parkkiopas.fi/public/v1/parking_area/";
const HEL_LICENCE = "CC BY 4.0, Helsingin kaupunki";

// ─── Espoo (Tekla WFS, GML only) ──────────────────────────────────────────────
const xmlParser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_", parseTagValue: false });

function posListToRing(posList: string): number[][] {
  const n = String(posList).trim().split(/\s+/).map(Number);
  const ring: number[][] = [];
  for (let i = 0; i + 1 < n.length; i += 2) ring.push([n[i], n[i + 1]]);
  return ring;
}

/** GML 3.1 geometry → GeoJSON. With srsName=EPSG:4326 Espoo returns lon lat order. */
export function gmlGeometryToGeoJSON(node: any): any {
  if (!node) return null;
  if (node["gml:Point"]) {
    const [lon, lat] = String(node["gml:Point"]["gml:pos"] ?? "").trim().split(/\s+/).map(Number);
    return Number.isFinite(lon) && Number.isFinite(lat) ? { type: "Point", coordinates: [lon, lat] } : null;
  }
  const poly = node["gml:Polygon"];
  if (poly) {
    const posList = poly?.["gml:exterior"]?.["gml:LinearRing"]?.["gml:posList"];
    return posList ? { type: "Polygon", coordinates: [posListToRing(posList)] } : null;
  }
  return null;
}

const ESPOO_CLASS: Record<string, string> = {
  yleinenpysakointialue: "Yleinen pysäköintialue",
  invapysakointi: "Liikuntaesteisten pysäköinti",
  yhteiskayttoautopysakointi: "Yhteiskäyttöautojen pysäköinti",
};

export function parseEspooGml(xml: string): any[] {
  const fc = xmlParser.parse(xml)?.["wfs:FeatureCollection"];
  if (!fc) throw new Error("Espoo: response is not a wfs:FeatureCollection");
  const raw = fc["gml:featureMember"];
  const members: any[] = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const out: any[] = [];
  for (const m of members) {
    const f = m["GIS:PKSEspooPysakointialueet"];
    if (!f) continue;
    const geometry = gmlGeometryToGeoJSON(f["GIS:Geometry"]);
    if (!geometry) continue;
    const cls = String(f["GIS:class"] ?? "");
    const spaces = Number(f["GIS:parking_spaces"]);
    out.push({
      type: "Feature",
      geometry,
      properties: {
        espoo_id: String(f["GIS:ID"] ?? ""),
        name_fi: f["GIS:name_fi"] ?? null,
        class: cls,
        class_fi: ESPOO_CLASS[cls] ?? null,
        parking_spaces: Number.isFinite(spaces) ? spaces : null,
        street_address_fi: f["GIS:street_address_fi"] ?? null,
        address_zip: f["GIS:address_zip"] ?? null,
        info: f["GIS:info"] ?? null,
        www_fi: f["GIS:www_fi"] ?? null,
      },
    });
  }
  return out;
}

async function fetchEspoo() {
  const params = new URLSearchParams({
    service: "WFS",
    version: "1.1.0",
    request: "GetFeature",
    typeName: "GIS:PKSEspooPysakointialueet",
    srsName: "EPSG:4326",
    maxFeatures: "5000",
  });
  const xml = await getWithRetry<string>(`${ESPOO_WFS}?${params}`, { responseType: "text" });
  const features = parseEspooGml(xml);
  await writeDataset("espoo", features, {
    source: `${ESPOO_WFS} (GIS:PKSEspooPysakointialueet)`,
    licence: "CC BY 4.0, Espoon kaupunki",
  });
}

async function fetchHelsinkiSlots() {
  const features = await fetchWfsJsonAll(HEL_WFS, "avoindata:Pysakointipaikat_alue");
  await writeDataset("slots", features, { source: `${HEL_WFS} (avoindata:Pysakointipaikat_alue)`, licence: HEL_LICENCE });
}

async function fetchHelsinkiFines() {
  const features = await fetchWfsJsonAll(HEL_WFS, "avoindata:Pysakointivirheet");
  await writeDataset("violations", features, { source: `${HEL_WFS} (avoindata:Pysakointivirheet)`, licence: HEL_LICENCE });
}

async function fetchParkkihubi() {
  const all: any[] = [];
  let url: string | null = PARKKIHUBI;
  while (url) {
    const data: any = await getWithRetry(url);
    if (!Array.isArray(data?.features)) throw new Error("Parkkihubi: not a FeatureCollection");
    all.push(...data.features);
    url = data.next ?? null;
  }
  await writeDataset("hubi", all, { source: PARKKIHUBI, licence: "Parkkihubi / Helsingin kaupunki (avoin rajapinta)" });
}

if (require.main === module) {
  runMain("Helsinki/Espoo/Parkkihubi harvest", async () => {
    // Sequential on purpose: each failure should be attributable in the log.
    await fetchHelsinkiSlots();
    await fetchEspoo();
    await fetchParkkihubi();
    await fetchHelsinkiFines();
  });
}

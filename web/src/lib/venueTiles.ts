import type { Feature, FeatureCollection } from "geojson";

/** Must match engine/scripts/build-venue-tiles.mjs. */
export const TILE_LAT = 0.01;
export const TILE_LON = 0.02;
/** Tiles exist only for the capital region; elsewhere the full snapshot loads instead. */
export const TILE_REGION = { minLon: 24.45, maxLon: 25.3, minLat: 60.08, maxLat: 60.42 };
/** Half-width of the box around a venue that the fast path covers. */
export const VENUE_BOX_M = 1000;

export interface VenueTileData {
  slots: FeatureCollection;
  espoo: FeatureCollection;
  osm: FeatureCollection;
}

export function inTileRegion(lat: number, lon: number): boolean {
  const r = TILE_REGION;
  return lon >= r.minLon && lon <= r.maxLon && lat >= r.minLat && lat <= r.maxLat;
}

/** Tile keys ("ix_iy") that a box of ±radiusM around the point touches. */
export function tileKeysAround(lat: number, lon: number, radiusM = VENUE_BOX_M): string[] {
  const dLat = radiusM / 111320;
  const dLon = radiusM / (111320 * Math.cos((lat * Math.PI) / 180));
  const keys: string[] = [];
  for (let ix = Math.floor((lon - dLon) / TILE_LON); ix <= Math.floor((lon + dLon) / TILE_LON); ix++)
    for (let iy = Math.floor((lat - dLat) / TILE_LAT); iy <= Math.floor((lat + dLat) / TILE_LAT); iy++)
      keys.push(`${ix}_${iy}`);
  return keys;
}

const empty = (): FeatureCollection => ({ type: "FeatureCollection", features: [] });

/**
 * Fetches the pre-split snapshot tiles around a venue. A tile that does not exist
 * means no data there (the static host answers with the HTML app, not JSON).
 */
export async function loadVenueTiles(lat: number, lon: number, fetcher: typeof fetch = fetch): Promise<VenueTileData> {
  const base = new URL(`${import.meta.env?.BASE_URL ?? "/"}data/tiles/`, window.location.origin).href;
  const parts = await Promise.all(
    tileKeysAround(lat, lon).map(async (k) => {
      const r = await fetcher(`${base}${k}.json`);
      if (!r.ok || !(r.headers.get("content-type") || "").includes("json")) return null;
      return (await r.json()) as { slots: Feature[]; espoo: Feature[]; osm: Feature[] };
    }),
  );
  const out: VenueTileData = { slots: empty(), espoo: empty(), osm: empty() };
  for (const p of parts) {
    if (!p) continue;
    out.slots.features.push(...p.slots);
    out.espoo.features.push(...p.espoo);
    out.osm.features.push(...p.osm);
  }
  return out;
}

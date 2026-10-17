import { useEffect, useState } from "react";
import type { Feature, FeatureCollection } from "geojson";
import { safeGeoJSON } from "../lib/mapThemes";
import type { LiveStatus } from "./useParkingLayers";

/** web/public/data/manifest.json, written by the ingest validation step. */
export interface DatasetManifestEntry {
  rows: number;
  fetched_at: string | null;
  source: string | null;
  licence: string | null;
  source_updated?: string | null;
  years?: string | null;
  venues_checked?: number;
  venues_with_parking_within_1km?: number;
}
export interface DataManifest {
  generated_at: string;
  datasets: Record<string, DatasetManifestEntry>;
}

const dataUrl = (file: string) => new URL(`${import.meta.env.BASE_URL}data/${file}`, window.location.origin).href;

/** Snapshot dates for the bundled data, so the UI can say how old it is. */
export function useDataManifest() {
  const [manifest, setManifest] = useState<DataManifest | null>(null);
  const [status, setStatus] = useState<LiveStatus>("loading");
  useEffect(() => {
    fetch(dataUrl("manifest.json"), { cache: "no-cache" })
      .then((r) => {
        if (!r.ok) throw new Error(`manifest HTTP ${r.status}`);
        return r.json() as Promise<DataManifest>;
      })
      .then((m) => {
        if (!m?.generated_at || !m.datasets) throw new Error("manifest malformed");
        setManifest(m);
        setStatus("ok");
      })
      .catch((err) => {
        console.error("Data manifest unavailable:", err);
        setStatus("error");
      });
  }, []);
  return { manifest, manifestStatus: status };
}

type Row = Record<string, unknown>;

function toPoints(rows: Row[]): FeatureCollection {
  const features: Feature[] = [];
  for (const row of rows) {
    const lon = Number(row.lon);
    const lat = Number(row.lat);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
    const { lon: _lon, lat: _lat, ...props } = row;
    features.push({ type: "Feature", geometry: { type: "Point", coordinates: [lon, lat] }, properties: props });
  }
  return safeGeoJSON({ type: "FeatureCollection", features }) as FeatureCollection;
}

/**
 * Espoo's public parking areas and OpenStreetMap parking (Finland-wide).
 * Loaded after the Helsinki layers so the first map paint is not delayed.
 */
export function useRegionalParking(start: boolean) {
  const [espooData, setEspooData] = useState<FeatureCollection | null>(null);
  const [osmData, setOsmData] = useState<FeatureCollection | null>(null);
  const [regionalStatus, setRegionalStatus] = useState<LiveStatus>("loading");

  useEffect(() => {
    if (!start) return;
    let cancelled = false;
    (async () => {
      try {
        const { getDuckDB, loadParquet } = await import("../lib/duckdb");
        await Promise.all([loadParquet("espoo", dataUrl("espoo.parquet")), loadParquet("osm", dataUrl("osm.parquet"))]);
        const db = await getDuckDB();
        const conn = await db.connect();
        try {
          const espoo = await conn.query(`
            SELECT ST_X(geom) AS lon, ST_Y(geom) AS lat, espoo_id, name_fi, class, class_fi,
                   parking_spaces, street_address_fi, address_zip, info, www_fi
            FROM espoo`);
          const osm = await conn.query(`
            SELECT ST_X(geom) AS lon, ST_Y(geom) AS lat, COLUMNS(* EXCLUDE (geom))
            FROM osm`);
          if (cancelled) return;
          setEspooData(toPoints(espoo.toArray().map((r) => r.toJSON() as Row)));
          setOsmData(toPoints(osm.toArray().map((r) => r.toJSON() as Row)));
          setRegionalStatus("ok");
        } finally {
          await conn.close();
        }
      } catch (err) {
        console.error("Espoo/OSM parking failed to load:", err);
        if (!cancelled) setRegionalStatus("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [start]);

  return { espooData, osmData, regionalStatus };
}

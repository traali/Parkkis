import type { Feature, FeatureCollection, Polygon } from "geojson";

/**
 * Helsinki's open parking-fine data (avoindata:Pysakointivirheet) gives each record a street
 * address and the city's geocoded point for that address, plus month and year. There is no day,
 * time or exact spot, so the map shows ~100 m squares with the real number of records in each.
 */

/** Cell size in degrees: 0.0009° lat ≈ 100 m, 0.0018° lon ≈ 100 m at Helsinki's latitude (~60.2°). */
export const FINE_CELL_LAT = 0.0009;
export const FINE_CELL_LON = 0.0018;

/** Count classes for the shading (lower bound inclusive). Same list drives the map and the legend. */
export const FINE_CLASSES = [
  { min: 1, label: "1–9", opacity: 0.14 },
  { min: 10, label: "10–49", opacity: 0.28 },
  { min: 50, label: "50–199", opacity: 0.42 },
  { min: 200, label: "200+", opacity: 0.6 },
] as const;

const MONTHS = [
  "tammikuu", "helmikuu", "maaliskuu", "huhtikuu", "toukokuu", "kesäkuu",
  "heinäkuu", "elokuu", "syyskuu", "lokakuu", "marraskuu", "joulukuu",
];

/** "Kesäkuu" → 6, unknown → null. */
export function monthNumber(name: unknown): number | null {
  const i = MONTHS.indexOf(String(name ?? "").trim().toLowerCase());
  return i < 0 ? null : i + 1;
}

/** Plain Finnish period from the (year, month name) pairs present in the data, e.g. "tammikuu–joulukuu 2023". */
export function finePeriod(rows: { vuosi: unknown; kuukausi: unknown }[]): string {
  const keys = rows
    .map((r) => {
      const y = Number(r.vuosi);
      const m = monthNumber(r.kuukausi);
      return Number.isInteger(y) && y > 1900 && m ? y * 12 + (m - 1) : null;
    })
    .filter((k): k is number => k !== null);
  if (!keys.length) return "";
  const lo = Math.min(...keys);
  const hi = Math.max(...keys);
  const y1 = Math.floor(lo / 12);
  const y2 = Math.floor(hi / 12);
  const m1 = MONTHS[lo % 12];
  const m2 = MONTHS[hi % 12];
  if (lo === hi) return `${m1} ${y1}`;
  return y1 === y2 ? `${m1}–${m2} ${y1}` : `${m1} ${y1}–${m2} ${y2}`;
}

export interface FineCellRow {
  gx: unknown;
  gy: unknown;
  fines: unknown;
  notices: unknown;
  top_reason?: unknown;
}

/** Aggregated grid rows (cell indices + real counts) → square polygons for the map. */
export function cellsToCollection(rows: FineCellRow[], period = ""): FeatureCollection<Polygon> {
  const features: Feature<Polygon>[] = [];
  for (const r of rows) {
    const gx = Number(r.gx);
    const gy = Number(r.gy);
    const fines = Number(r.fines);
    if (!Number.isFinite(gx) || !Number.isFinite(gy) || !(fines > 0)) continue;
    const w = +(gx * FINE_CELL_LON).toFixed(6);
    const e = +((gx + 1) * FINE_CELL_LON).toFixed(6);
    const s = +(gy * FINE_CELL_LAT).toFixed(6);
    const n = +((gy + 1) * FINE_CELL_LAT).toFixed(6);
    features.push({
      type: "Feature",
      geometry: { type: "Polygon", coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]] },
      properties: {
        fines,
        notices: Number(r.notices) || 0,
        top_reason: r.top_reason ? String(r.top_reason).replace(/^\d+\s+/, "").trim() : null,
        period,
      },
    });
  }
  return { type: "FeatureCollection", features };
}

/** Radius for the "no fines near this venue" note. */
export const FINES_NEAR_M = 600;

/** True if any fine cell centre lies within radiusM of the point (cells are ~100 m, so this is approximate). */
export function fineCellsNear(fc: FeatureCollection | null | undefined, lat: number, lon: number, radiusM: number): boolean {
  if (!fc) return false;
  const mPerLat = 111_320;
  const mPerLon = 111_320 * Math.cos((lat * Math.PI) / 180);
  for (const f of fc.features) {
    if (f.geometry?.type !== "Polygon") continue;
    const [w, s] = f.geometry.coordinates[0][0];
    const dx = (w + FINE_CELL_LON / 2 - lon) * mPerLon;
    const dy = (s + FINE_CELL_LAT / 2 - lat) * mPerLat;
    if (dx * dx + dy * dy <= radiusM * radiusM) return true;
  }
  return false;
}

/** SQL for the cells; real_violations is the table of records with a real location. */
export const FINE_CELLS_SQL = `
  SELECT
    CAST(floor(ST_X(geom) / ${FINE_CELL_LON}) AS BIGINT) AS gx,
    CAST(floor(ST_Y(geom) / ${FINE_CELL_LAT}) AS BIGINT) AS gy,
    count(*) FILTER (WHERE virhemaksun_vaihe = 'Pysäköintivirhemaksu') AS fines,
    count(*) FILTER (WHERE virhemaksun_vaihe = 'Huomautus') AS notices,
    mode(virheen_paasyy_ja_paaluokka) FILTER (WHERE virhemaksun_vaihe = 'Pysäköintivirhemaksu') AS top_reason
  FROM real_violations
  WHERE geom IS NOT NULL
    AND ST_Y(geom) BETWEEN 60.0 AND 60.4
    AND ST_X(geom) BETWEEN 24.5 AND 25.3
  GROUP BY 1, 2
  HAVING count(*) FILTER (WHERE virhemaksun_vaihe = 'Pysäköintivirhemaksu') > 0
`;

/** MapLibre step expression: fill opacity by fine count, from FINE_CLASSES. */
export const FINE_OPACITY = [
  "step",
  ["get", "fines"],
  FINE_CLASSES[0].opacity,
  ...FINE_CLASSES.slice(1).flatMap((c) => [c.min, c.opacity]),
] as unknown as number;

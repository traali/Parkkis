import { useEffect, useState } from "react";
import type { Feature, FeatureCollection, Geometry } from "geojson";
import { getDuckDB, loadParquet } from "../lib/duckdb";
import { getCentroid, safeGeoJSON } from "../lib/mapThemes";

/** Facts about the bundled snapshot, read from the data itself. */
export interface DataFacts {
  /** Fines with a real (not approximated) location. */
  fineCount: number;
  fineYears: string;
  /** Newest `paivitetty_tietopalveluun` in the parking-space snapshot. */
  slotsUpdated: string | null;
  /** Newest sign edit (`muokkauspv`) in the Digiroad snapshot. */
  signsUpdated: string | null;
}

/** State of a layer fetched live from the City of Helsinki in the browser. */
export type LiveStatus = "loading" | "ok" | "error";

type Row = Record<string, unknown>;

const HEL_WFS = "https://kartta.hel.fi/ws/geoserver/avoindata/wfs";
/** A sign counts as "new" if Digiroad says it was edited in the last 60 days. */
const NEW_SIGN_DAYS = 60;

/** Today in Helsinki as YYYY-MM-DD (WFS date filters compare local dates). */
function helsinkiToday(): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Helsinki" }).format(new Date());
}

function wfsUrl(typeName: string, cql: string, propertyNames?: string[]): string {
  const params = new URLSearchParams({
    service: "WFS",
    version: "2.0.0",
    request: "GetFeature",
    typeName,
    outputFormat: "application/json",
    srsName: "EPSG:4326",
    count: "5000",
    cql_filter: cql,
  });
  if (propertyNames) params.set("propertyName", propertyNames.join(","));
  return `${HEL_WFS}?${params.toString()}`;
}

async function fetchFeatures(url: string): Promise<Feature[]> {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`WFS HTTP ${resp.status}`);
  const data = (await resp.json()) as FeatureCollection;
  if (!Array.isArray(data.features)) throw new Error("WFS: not a FeatureCollection");
  return data.features;
}

function parseJsonObject(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object") return value as Record<string, unknown>;
  if (typeof value !== "string" || !value) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function rowsToCollection(rows: Row[]): FeatureCollection {
  return safeGeoJSON({
    type: "FeatureCollection",
    features: rows.map((row) => ({
      type: "Feature",
      geometry: JSON.parse(String(row.geometry)) as Geometry,
      properties: (row.properties as Record<string, unknown>) ?? {},
    })),
  }) as FeatureCollection;
}

export function useParkingLayers() {
  const [dbReady, setDbReady] = useState(false);
  const [riskData, setRiskData] = useState<FeatureCollection | null>(null);
  const [violationData, setViolationData] = useState<FeatureCollection | null>(null);
  const [signData, setSignData] = useState<FeatureCollection | null>(null);
  const [roadworkData, setRoadworkData] = useState<FeatureCollection | null>(null);
  const [reservationData, setReservationData] = useState<FeatureCollection | null>(null);
  const [liipiData, setLiipiData] = useState<FeatureCollection | null>(null);
  const [hubiData, setHubiData] = useState<FeatureCollection | null>(null);
  const [dataFacts, setDataFacts] = useState<DataFacts | null>(null);
  const [roadworkStatus, setRoadworkStatus] = useState<LiveStatus>("loading");
  const [reservationStatus, setReservationStatus] = useState<LiveStatus>("loading");
  const [loadingMsg, setLoadingMsg] = useState("Avataan Helsingin parkkikarttaa...");
  const [loadFailed, setLoadFailed] = useState(false);

  // Layer visibility toggles
  const [activeFilter, setActiveFilter] = useState("all");
  const [showNewTraps, setShowNewTraps] = useState(true);
  const [showViolations, setShowViolations] = useState(true);
  const [showRoadworks, setShowRoadworks] = useState(true);
  const [showReservations, setShowReservations] = useState(true);
  const [showSigns, setShowSigns] = useState(true);

  // Live layers: fetched straight from the City of Helsinki, never from a stale copy.
  useEffect(() => {
    const today = helsinkiToday();

    // Street works. Winkki_works only holds two records from 2010 and 2013, so
    // current excavation notices and temporary traffic arrangements are used.
    Promise.all([
      fetchFeatures(
        wfsUrl(
          "avoindata:Kaivuilmoitus_alue",
          `tyo_alkaa<='${today}' AND tyo_paattyy>='${today}'`,
          ["hakemustunnus", "osoite", "tyo_alkaa_txt", "tyo_paattyy_txt", "status", "singlegeom"],
        ),
      ),
      fetchFeatures(
        wfsUrl(
          "avoindata:Tilapainen_liikennejarjestely_alue",
          `liikennejarjestely_alkaa<='${today}' AND liikennejarjestely_paattyy>='${today}'`,
          [
            "hakemustunnus",
            "osoite",
            "liikennejarjestely_alkaa_txt",
            "liikennejarjestely_paattyy_txt",
            "status",
            "singlegeom",
          ],
        ),
      ),
    ])
      .then(([digs, arrangements]) => {
        const features: Feature[] = [
          ...digs.map((f) => ({
            ...f,
            properties: {
              work_kind: "Kaivutyö",
              work_id: f.properties?.hakemustunnus ?? null,
              work_address: f.properties?.osoite ?? null,
              work_start: f.properties?.tyo_alkaa_txt ?? null,
              work_end: f.properties?.tyo_paattyy_txt ?? null,
            },
          })),
          ...arrangements.map((f) => ({
            ...f,
            properties: {
              work_kind: "Tilapäinen liikennejärjestely",
              work_id: f.properties?.hakemustunnus ?? null,
              work_address: f.properties?.osoite ?? null,
              work_start: f.properties?.liikennejarjestely_alkaa_txt ?? null,
              work_end: f.properties?.liikennejarjestely_paattyy_txt ?? null,
            },
          })),
        ];
        setRoadworkData({ type: "FeatureCollection", features });
        setRoadworkStatus("ok");
      })
      .catch((err) => {
        console.error("Street works fetch failed:", err);
        setRoadworkStatus("error");
      });

    // Street-area leases that are valid today (status alone keeps expired ones).
    fetchFeatures(
      wfsUrl(
        "avoindata:Winkki_rents_audiences",
        `licence_status='ACTIVE' AND event_startdate<='${today}' AND event_enddate>='${today}'`,
      ),
    )
      .then((features) => {
        setReservationData({ type: "FeatureCollection", features });
        setReservationStatus("ok");
      })
      .catch((err) => {
        console.error("Street-area lease fetch failed:", err);
        setReservationStatus("error");
      });
  }, []);

  useEffect(() => {
    const initData = async () => {
      try {
        setLoadingMsg("Ladataan pysäköintipaikkoja...");
        const dataUrl = (file: string) =>
          new URL(`${import.meta.env.BASE_URL}data/${file}`, window.location.origin).href;

        await Promise.all([
          loadParquet("slots", dataUrl("slots.parquet")),
          loadParquet("violations", dataUrl("violations.parquet")),
          loadParquet("signs", dataUrl("signs.parquet")),
          loadParquet("liipi", dataUrl("liipi.parquet")),
          loadParquet("hubi", dataUrl("hubi.parquet")),
        ]);

        setLoadingMsg("Lasketaan sakkoja paikoittain...");
        const db = await getDuckDB();
        const conn = await db.connect();

        // Only fines whose location the city marks as real (todellinen_sijainti = 'Kyllä').
        await conn.query(`
          CREATE OR REPLACE TABLE real_violations AS
          SELECT * FROM violations WHERE todellinen_sijainti = 'Kyllä'
        `);

        // Category = what a visitor without a resident permit can do there.
        // `luokka_nimi` such as "Maksullinen ilman asukas-/yritystunnusta..." mentions
        // "asukas" but means paid parking, so resident zones are a separate flag.
        const slotResult = await conn.query(`
          SELECT
            ST_AsGeoJSON(s.geom) as geometry,
            {
              'id': s.id,
              'luokka_nimi': s.luokka_nimi,
              'tyyppi': s.tyyppi,
              'paikat_ala': s.paikat_ala,
              'kesto': s.kesto,
              'voimassaolo': s.voimassaolo,
              'lisatieto': s.lisatieto,
              'asukaspysakointitunnus': s.asukaspysakointitunnus,
              'resident_zone': COALESCE(s.asukaspysakointitunnus, '') <> '',
              'category': CASE
                WHEN s.tyyppi = 'Pysäköintikielto' THEN 'restricted'
                WHEN COALESCE(s.tyyppi, '') NOT IN ('', '0', '8', '9') THEN 'special'
                WHEN s.luokka_nimi ILIKE 'Maksullinen%' OR s.luokka_nimi ILIKE 'Kertamaksu%' THEN 'paid'
                WHEN s.luokka_nimi ILIKE '%ilmainen%' THEN 'free'
                ELSE 'other'
              END
            } as properties,
            (SELECT count(*) FROM real_violations v WHERE ST_Intersects(ST_Buffer(s.geom, 0.0002), v.geom)) as fine_count,
            (SELECT v.virheen_paasyy_ja_paaluokka FROM real_violations v WHERE ST_Intersects(ST_Buffer(s.geom, 0.0002), v.geom) GROUP BY v.virheen_paasyy_ja_paaluokka ORDER BY count(*) DESC LIMIT 1) as top_violation_reason
          FROM slots s
        `);

        const slotRows = slotResult.toArray() as unknown as Row[];
        setRiskData(
          safeGeoJSON({
            type: "FeatureCollection",
            features: slotRows.map((row) => ({
              type: "Feature",
              geometry: JSON.parse(String(row.geometry)),
              properties: {
                ...(row.properties as Record<string, unknown>),
                fine_count: Number(row.fine_count),
                top_violation_reason: row.top_violation_reason,
                // Deterministic 1-10 scale from the fines counted above.
                risk_score: Math.min(10, Math.ceil(1 + Number(row.fine_count) * 0.5)),
              },
            })),
          }),
        );

        setLoadingMsg("Merkitään sakkoja kartalle...");
        // One point per location with its fine count (no arbitrary LIMIT).
        const violationResult = await conn.query(`
          SELECT ST_AsGeoJSON(geom) as geometry, { 'fines': count(*) } as properties
          FROM real_violations
          GROUP BY 1
        `);
        setViolationData(rowsToCollection(violationResult.toArray() as unknown as Row[]));

        setLoadingMsg("Luetaan pysäköintimerkkejä...");
        // "New" is computed now, not frozen at ingest time.
        const signResult = await conn.query(`
          SELECT
            ST_AsGeoJSON(geom) as geometry,
            {
              'id': id,
              'tyyppi': tyyppi,
              'muokkauspv': muokkauspv,
              'is_new': mod_ts IS NOT NULL AND mod_ts >= now()::TIMESTAMP - INTERVAL ${NEW_SIGN_DAYS} DAY,
              'kilpi_txt1': kilpi_txt1,
              'kilpi_txt2': kilpi_txt2,
              'kilpi_txt3': kilpi_txt3,
              'kilpi_txt4': kilpi_txt4,
              'kilpi_txt5': kilpi_txt5,
              'arvo': arvo
            } as properties
          FROM signs
          WHERE (mod_ts IS NOT NULL AND mod_ts >= now()::TIMESTAMP - INTERVAL ${NEW_SIGN_DAYS} DAY) OR tyyppi IN (
            'C37', 'C38', 'C39', 'C40', 'C44.1', 'C44.2',
            'E2', 'E3.1', 'E3.2', 'E3.3', 'E3.4', 'E3.5',
            'E24', 'E26', 'E28', 'C32', 'C34',
            'H12.1', 'H12.2', 'H17.1', 'H17.2', 'H17.3', 'H18', 'H19', 'H20', 'H21', 'H24', 'H25'
          )
        `);
        setSignData(rowsToCollection(signResult.toArray() as unknown as Row[]));

        setLoadingMsg("Haetaan liityntäpysäköintiä...");
        const liipiResult = await conn.query(`
          SELECT ST_AsGeoJSON(geom) as geometry, struct_pack(COLUMNS(* EXCLUDE geom)) as properties
          FROM liipi
        `);
        const liipiPolygons = rowsToCollection(liipiResult.toArray() as unknown as Row[]);
        // Fintraffic facilities are polygons; a circle layer needs one point each.
        const liipiPoints: Feature[] = [];
        for (const f of liipiPolygons.features) {
          const center = getCentroid(f.geometry);
          if (!center) continue;
          const props = (f.properties ?? {}) as Record<string, unknown>;
          const name = parseJsonObject(props.name);
          liipiPoints.push({
            type: "Feature",
            geometry: { type: "Point", coordinates: center },
            properties: {
              ...props,
              name_fi: String(name?.fi ?? name?.sv ?? name?.en ?? ""),
            },
          });
        }
        setLiipiData({ type: "FeatureCollection", features: liipiPoints });

        setLoadingMsg("Yhdistetään pysäköintitietoon...");
        const hubiResult = await conn.query(`
          SELECT ST_AsGeoJSON(geom) as geometry, struct_pack(COLUMNS(* EXCLUDE geom)) as properties
          FROM hubi
        `);
        setHubiData(rowsToCollection(hubiResult.toArray() as unknown as Row[]));

        const factsResult = await conn.query(`
          SELECT
            (SELECT count(*) FROM real_violations) as fine_count,
            (SELECT string_agg(DISTINCT CAST(vuosi AS VARCHAR), '–' ORDER BY CAST(vuosi AS VARCHAR)) FROM real_violations) as fine_years,
            (SELECT CAST(max(paivitetty_tietopalveluun) AS VARCHAR) FROM slots) as slots_updated,
            (SELECT strftime(max(mod_ts), '%Y-%m-%d') FROM signs) as signs_updated
        `);
        const facts = (factsResult.toArray() as unknown as Row[])[0] ?? {};
        setDataFacts({
          fineCount: Number(facts.fine_count ?? 0),
          fineYears: String(facts.fine_years ?? ""),
          slotsUpdated: facts.slots_updated ? String(facts.slots_updated) : null,
          signsUpdated: facts.signs_updated ? String(facts.signs_updated) : null,
        });

        await conn.close();
        setDbReady(true);
      } catch (e) {
        console.error("Data Engine Failure:", e);
        setLoadFailed(true);
        setLoadingMsg("Kartta-aineisto ei latautunut. Päivitä sivu ja yritä uudelleen.");
      }
    };
    initData();
  }, []);

  return {
    dbReady,
    loadFailed,
    loadingMsg,
    riskData,
    violationData,
    signData,
    roadworkData,
    reservationData,
    liipiData,
    hubiData,
    dataFacts,
    roadworkStatus,
    reservationStatus,
    activeFilter,
    setActiveFilter,
    showNewTraps,
    setShowNewTraps,
    showViolations,
    setShowViolations,
    showRoadworks,
    setShowRoadworks,
    showReservations,
    setShowReservations,
    showSigns,
    setShowSigns,
  };
}

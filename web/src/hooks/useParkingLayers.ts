import { useState, useEffect } from "react";
import type { FeatureCollection } from "geojson";
import { getDuckDB, loadParquet } from "../lib/duckdb";
import { safeGeoJSON } from "../lib/mapThemes";
import { extractRentInfo } from "../lib/helsinkiCaseParser";

export function useParkingLayers() {
  const [dbReady, setDbReady] = useState(false);
  const [riskData, setRiskData] = useState<FeatureCollection | null>(null);
  const [violationData, setViolationData] = useState<FeatureCollection | null>(null);
  const [signData, setSignData] = useState<FeatureCollection | null>(null);
  const [roadworkData, setRoadworkData] = useState<FeatureCollection | null>(null);
  const [reservationData, setReservationData] = useState<FeatureCollection | null>(null);
  const [liipiData, setLiipiData] = useState<FeatureCollection | null>(null);
  const [hubiData, setHubiData] = useState<FeatureCollection | null>(null);
  const [loadingMsg, setLoadingMsg] = useState("Initializing Helsinki Parking Safety Map...");

  // Layer visibility toggles
  const [activeFilter, setActiveFilter] = useState("all");
  const [showNewTraps, setShowNewTraps] = useState(true);
  const [showViolations, setShowViolations] = useState(true);
  const [showRoadworks, setShowRoadworks] = useState(true);
  const [showReservations, setShowReservations] = useState(true);
  const [showSigns, setShowSigns] = useState(true);

  // Live on-demand decision rent fetching & parsing states
  const [liveRentMap, setLiveRentMap] = useState<Record<string, { annual: string | null; monthly: string | null } | null>>({});
  const [loadingRentMap, setLoadingRentMap] = useState<Record<string, boolean>>({});

  const handleFetchLiveRent = async (caseCode: string) => {
    if (loadingRentMap[caseCode] || liveRentMap[caseCode]) return;
    
    setLoadingRentMap((prev) => ({ ...prev, [caseCode]: true }));
    
    try {
      const targetUrl = "https://paatokset.hel.fi/fi/asia/" + caseCode;
      const proxyUrl = "https://api.allorigins.win/raw?url=" + encodeURIComponent(targetUrl);
      
      const resp = await fetch(proxyUrl);
      if (!resp.ok) throw new Error("Network response was not ok");
      
      const htmlText = await resp.text();
      const parser = new DOMParser();
      const doc = parser.parseFromString(htmlText, "text/html");
      const pageText = doc.body.textContent || "";
      
      const extracted = extractRentInfo(pageText);
      setLiveRentMap((prev) => ({ ...prev, [caseCode]: extracted }));
    } catch (err) {
      console.error("Error fetching live decision details:", err);
      setLiveRentMap((prev) => ({ ...prev, [caseCode]: null }));
    } finally {
      setLoadingRentMap((prev) => ({ ...prev, [caseCode]: false }));
    }
  };

  useEffect(() => {
    const initData = async () => {
      try {
        setLoadingMsg("Loading local parking spots...");

        const baseUrl = import.meta.env.BASE_URL.endsWith("/")
          ? import.meta.env.BASE_URL
          : import.meta.env.BASE_URL + "/";
        
        const slotsUrl = new URL(baseUrl + "data/slots.parquet", window.location.origin).href;
        const violationsUrl = new URL(baseUrl + "data/violations.parquet", window.location.origin).href;
        const signsUrl = new URL(baseUrl + "data/signs.parquet", window.location.origin).href;
        const roadworksUrl = new URL(baseUrl + "data/roadworks.parquet", window.location.origin).href;
        const liipiUrl = new URL(baseUrl + "data/liipi.parquet", window.location.origin).href;
        const hubiUrl = new URL(baseUrl + "data/hubi.parquet", window.location.origin).href;

        await Promise.all([
          loadParquet("slots", slotsUrl),
          loadParquet("violations", violationsUrl),
          loadParquet("signs", signsUrl),
          loadParquet("roadworks", roadworksUrl),
          loadParquet("liipi", liipiUrl),
          loadParquet("hubi", hubiUrl),
        ]);

        setLoadingMsg("Calculating parking risk areas...");
        const db = await getDuckDB();
        const conn = await db.connect();

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
              'asukaspysakointitunnus': s.asukaspysakointitunnus,
              'category': CASE 
                WHEN s.luokka_nimi ILIKE '%asukas%' THEN 'residential'
                WHEN s.luokka_nimi ILIKE '%maksullinen%' THEN 'paid'
                WHEN s.luokka_nimi ILIKE '%ilmainen%' THEN 'free'
                WHEN s.tyyppi IS NOT NULL AND s.tyyppi != '' AND s.tyyppi != '0' AND s.tyyppi != '9' THEN 'special'
                ELSE 'other'
              END
            } as properties,
            (SELECT count(*) FROM violations v WHERE ST_Intersects(ST_Buffer(s.geom, 0.0002), v.geom)) as fine_count,
            (SELECT v.virheen_paasyy_ja_paaluokka FROM violations v WHERE ST_Intersects(ST_Buffer(s.geom, 0.0002), v.geom) GROUP BY v.virheen_paasyy_ja_paaluokka ORDER BY count(*) DESC LIMIT 1) as top_violation_reason
          FROM slots s
        `);

        const slotFeatures = (slotResult.toArray() as unknown as any[]).map((row) => ({
          type: "Feature" as const,
          geometry: JSON.parse(row.geometry),
          properties: {
            ...row.properties,
            fine_count: Number(row.fine_count),
            top_violation_reason: row.top_violation_reason,
            risk_score: Math.min(
              10,
              Math.ceil(1 + Number(row.fine_count) * 0.5),
            ),
          },
        }));
 
        setRiskData(safeGeoJSON({ type: "FeatureCollection" as const, features: slotFeatures }));

        setLoadingMsg("Mapping fine locations city-wide...");
        const violationResult = await conn.query(`
          SELECT ST_AsGeoJSON(geom) as geometry
          FROM violations
          LIMIT 50000
        `);
        const violationFeatures = (violationResult.toArray() as unknown as any[]).map((row) => ({
          type: "Feature" as const,
          geometry: JSON.parse(row.geometry),
          properties: {},
        }));
        setViolationData(safeGeoJSON({ type: "FeatureCollection" as const, features: violationFeatures }));

        setLoadingMsg("Indexing street parking signs...");
        const signResult = await conn.query(`
          SELECT 
            ST_AsGeoJSON(geom) as geometry,
            {
              'id': id,
              'tyyppi': tyyppi,
              'muokkauspv': muokkauspv,
              'is_new': is_new,
              'kilpi_txt1': kilpi_txt1,
              'kilpi_txt2': kilpi_txt2,
              'kilpi_txt3': kilpi_txt3,
              'kilpi_txt4': kilpi_txt4,
              'kilpi_txt5': kilpi_txt5,
              'arvo': arvo
            } as properties
          FROM signs
          WHERE is_new = true OR tyyppi IN (
            'C37', 'C38', 'C39', 'C40', 'C44.1', 'C44.2', 
            'E2', 'E3.1', 'E3.2', 'E3.3', 'E3.4', 'E3.5',
            'E24', 'E26', 'E28', 'C32', 'C34',
            'H12.1', 'H12.2', 'H17.1', 'H17.2', 'H17.3', 'H18', 'H19', 'H20', 'H21', 'H24', 'H25'
          )
        `);

        const signFeatures = (signResult.toArray() as unknown as any[]).map((row) => ({
          type: "Feature" as const,
          geometry: JSON.parse(row.geometry),
          properties: row.properties,
        }));

        setSignData(safeGeoJSON({ type: "FeatureCollection" as const, features: signFeatures }));

        setLoadingMsg("Scanning for active construction & reservations...");
        const HEL_WFS = "https://kartta.hel.fi/ws/geoserver/avoindata/wfs";
        const wfsParams = (typeName: string, filter: string) =>
          `${HEL_WFS}?service=WFS&version=2.0.0&request=GetFeature&typeName=${typeName}&outputFormat=application/json&srsName=EPSG:4326&cql_filter=${encodeURIComponent(filter)}&count=2000`;

        const [worksResp, rentsResp] = await Promise.allSettled([
          fetch(wfsParams("avoindata:Winkki_works", "licence_status='ACTIVE'")),
          fetch(wfsParams("avoindata:Winkki_rents_audiences", "licence_status='ACTIVE'")),
        ]);

        if (worksResp.status === "fulfilled" && worksResp.value.ok) {
          const worksData = await worksResp.value.json();
          setRoadworkData(safeGeoJSON(worksData as FeatureCollection));
        } else {
          const roadworksResult = await conn.query(`
            SELECT ST_AsGeoJSON(geom) as geometry, struct_pack(COLUMNS(* EXCLUDE geom)) as properties FROM roadworks
          `);
          setRoadworkData(safeGeoJSON({
            type: "FeatureCollection" as const,
            features: (roadworksResult.toArray() as unknown as any[]).map((row) => ({
              type: "Feature" as const, geometry: JSON.parse(row.geometry), properties: row.properties,
            })),
          }));
        }

        if (rentsResp.status === "fulfilled" && rentsResp.value.ok) {
          const rentsData = await rentsResp.value.json();
          setReservationData(safeGeoJSON(rentsData as FeatureCollection));
        }
 
        setLoadingMsg("Loading Park & Ride connections...");
        const liipiResult = await conn.query(`
          SELECT 
            ST_AsGeoJSON(geom) as geometry, 
            struct_pack(COLUMNS(* EXCLUDE geom)) as properties 
          FROM liipi
        `);
        const liipiGeoJSON = {
          type: "FeatureCollection" as const,
          features: (liipiResult.toArray() as unknown as any[]).map((row) => ({
            type: "Feature" as const,
            geometry: JSON.parse(row.geometry),
            properties: row.properties,
          })),
        };
        setLiipiData(safeGeoJSON(liipiGeoJSON));

        setLoadingMsg("Connecting to public parking database...");
        const hubiResult = await conn.query(`
          SELECT 
            ST_AsGeoJSON(geom) as geometry, 
            struct_pack(COLUMNS(* EXCLUDE geom)) as properties 
          FROM hubi
        `);
        const hubiGeoJSON = {
          type: "FeatureCollection" as const,
          features: (hubiResult.toArray() as unknown as any[]).map((row) => ({
            type: "Feature" as const,
            geometry: JSON.parse(row.geometry),
            properties: row.properties,
          })),
        };
        setHubiData(safeGeoJSON(hubiGeoJSON));
        
        await conn.close();
        setDbReady(true);
      } catch (e) {
        console.error("Data Engine Failure:", e);
        setLoadingMsg("Failed to initialize. Check console.");
      }
    };
    initData();
  }, []);

  return {
    dbReady,
    loadingMsg,
    riskData,
    violationData,
    signData,
    roadworkData,
    reservationData,
    liipiData,
    hubiData,
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
    liveRentMap,
    loadingRentMap,
    handleFetchLiveRent,
  };
}

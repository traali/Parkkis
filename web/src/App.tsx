import { useCallback, useEffect, useRef, useState } from "react";
import Map, {
  GeolocateControl,
  Layer,
  NavigationControl,
  Popup,
  Source,
} from "react-map-gl/maplibre";
import "maplibre-gl/dist/maplibre-gl.css";
import * as turf from "@turf/turf";
import {
  Filter,
  Info,
  Map as MapIcon,
  Navigation,
  Search,
  Shield,
  Sliders,
  X,
} from "lucide-react";
import { getDuckDB, loadParquet } from "./lib/duckdb";

const INITIAL_VIEW_STATE = {
  longitude: 24.941,
  latitude: 60.169,
  zoom: 13,
  pitch: 45,
};

const CATEGORIES = [
  { id: "all", label: "All Slots", color: "bg-nc-neon-teal" },
  { id: "residential", label: "Residential", color: "bg-nc-gold" },
  { id: "paid", label: "Paid", color: "bg-blue-500" },
  { id: "free", label: "Free", color: "bg-green-500" },
  { id: "special", label: "Special (EV/Inva)", color: "bg-purple-500" },
];

export default function App() {
  const [dbReady, setDbReady] = useState(false);
  const [riskData, setRiskData] = useState<any>(null);
  const [signData, setSignData] = useState<any>(null);
  const [roadworkData, setRoadworkData] = useState<any>(null);
  const [liipiData, setLiipiData] = useState<any>(null);
  const [loadingMsg, setLoadingMsg] = useState(
    "Initializing Analytical Engine...",
  );
  const [hoverInfo, setHoverInfo] = useState<any>(null);
  const [activeFilter, setActiveFilter] = useState("all");
  const [showNewTraps, setShowNewTraps] = useState(true);
  const [showRoadworks, setShowRoadworks] = useState(true);
  const [showSigns, setShowSigns] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [selectedAddress, setSelectedAddress] = useState<any>(null);

  const geoControlRef = useRef<any>(null);
  const mapRef = useRef<any>(null);
  const [pulseOpacity, setPulseOpacity] = useState(0.8);

  // Debounced Search Logic
  useEffect(() => {
    if (searchQuery.length < 3) {
      setSearchResults([]);
      return;
    }

    const delayDebounceFn = setTimeout(async () => {
      try {
        const response = await fetch(
          `https://api.hel.fi/servicemap/v2/search/?type=address&page_size=5&q=${encodeURIComponent(searchQuery)}&language=fi`,
        );
        const data = await response.json();
        setSearchResults(data.results || []);
      } catch (err) {
        console.error("Search failed:", err);
      }
    }, 300);

    return () => clearTimeout(delayDebounceFn);
  }, [searchQuery]);

  const onSelectAddress = (result: any) => {
    const [lng, lat] = result.location.coordinates;
    setSelectedAddress({
      longitude: lng,
      latitude: lat,
      name: result.name.fi || result.name.sv,
    });
    setSearchQuery("");
    setSearchResults([]);

    if (mapRef.current) {
      mapRef.current.flyTo({
        center: [lng, lat],
        zoom: 17,
        pitch: 60,
        duration: 2000,
      });
    }
  };

  // Pulse animation for new traps
  useEffect(() => {
    const interval = setInterval(() => {
      setPulseOpacity((prev) => (prev === 0.8 ? 0.2 : 0.8));
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const initData = async () => {
      console.log("🏗️ ParkkiS Build Info:", {
        version: "2.4.1",
        buildTime: new Date().toISOString(),
        environment: import.meta.env.MODE,
        base: import.meta.env.BASE_URL,
      });

      try {
        setLoadingMsg("Loading High-Performance Spatial Assets...");

        const slotsUrl = new URL("data/slots.parquet", window.location.href)
          .href;
        const violationsUrl = new URL(
          "data/violations.parquet",
          window.location.href,
        ).href;
        const signsUrl = new URL("data/signs.parquet", window.location.href)
          .href;
        const roadworksUrl = new URL(
          "data/roadworks.parquet",
          window.location.href,
        ).href;
        const liipiUrl = new URL("data/liipi.parquet", window.location.href)
          .href;

        await Promise.all([
          loadParquet("slots", slotsUrl),
          loadParquet("violations", violationsUrl),
          loadParquet("signs", signsUrl),
          loadParquet("roadworks", roadworksUrl),
          loadParquet("liipi", liipiUrl),
        ]);

        setLoadingMsg("Calculating Live Risk Matrix...");
        const db = await getDuckDB();
        const conn = await db.connect();

        const slotResult = await conn.query(`
          SELECT 
            ST_AsGeoJSON(s.geom) as geometry, 
            to_json({
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
            }) as properties,
            (SELECT count(*) FROM violations v WHERE ST_Intersects(ST_Buffer(s.geom, 0.0002), v.geom)) as fine_count,
            (SELECT v.virheen_paasyy_ja_paaluokka FROM violations v WHERE ST_Intersects(ST_Buffer(s.geom, 0.0002), v.geom) GROUP BY v.virheen_paasyy_ja_paaluokka ORDER BY count(*) DESC LIMIT 1) as top_violation_reason
          FROM slots s
        `);

        const slotFeatures = slotResult.toArray().map((row: any) => ({
          type: "Feature",
          geometry: JSON.parse(row.geometry),
          properties: {
            ...JSON.parse(row.properties),
            fine_count: Number(row.fine_count),
            top_violation_reason: row.top_violation_reason,
            risk_score: Math.min(
              10,
              Math.ceil(1 + Number(row.fine_count) * 0.5),
            ),
          },
        }));

        setRiskData({ type: "FeatureCollection", features: slotFeatures });

        setLoadingMsg("Indexing Temporal Signage...");
        const signResult = await conn.query(`
          SELECT 
            ST_AsGeoJSON(geom) as geometry,
            to_json({
              'id': id,
              'tyyppi': tyyppi,
              'muokkauspv': muokkauspv,
              'is_new': is_new,
              'kilpi_txt1': kilpi_txt1
            }) as properties
          FROM signs
          WHERE is_new = true OR tyyppi IN ('C37', 'C38', 'C39')
        `);

        const signFeatures = signResult.toArray().map((row: any) => ({
          type: "Feature",
          geometry: JSON.parse(row.geometry),
          properties: JSON.parse(row.properties),
        }));

        setSignData({ type: "FeatureCollection", features: signFeatures });

        // 4. Load Roadworks
        setLoadingMsg("Scanning for street disruptions...");
        const roadworksResult = await conn.query(
          `SELECT CAST(ST_AsGeoJSON(geom) AS JSON) as geometry, * EXCLUDE geom FROM roadworks`,
        );
        const roadworksGeoJSON = {
          type: "FeatureCollection",
          features: roadworksResult.toArray().map((row: any) => {
            const props = { ...row };
            delete props.geometry;
            return {
              type: "Feature",
              geometry: JSON.parse(row.geometry),
              properties: props,
            };
          }),
        };
        setRoadworkData(roadworksGeoJSON);

        // 5. Load LiiPi (Park & Ride)
        setLoadingMsg("Connecting to Transit Hubs...");
        const liipi = await conn.query(
          `SELECT CAST(ST_AsGeoJSON(geom) AS JSON) as geometry, * EXCLUDE geom FROM liipi`,
        );
        const liipiGeoJSON = {
          type: "FeatureCollection",
          features: liipi.toArray().map((row: any) => {
            const props = { ...row };
            delete props.geometry;
            return {
              type: "Feature",
              geometry: JSON.parse(row.geometry),
              properties: props,
            };
          }),
        };
        setLiipiData(liipiGeoJSON);

        setDbReady(true);
        await conn.close();
      } catch (e) {
        console.error("Data Engine Failure:", e);
        setLoadingMsg("Failed to initialize. Check console.");
      }
    };
    initData();
  }, []);

  const onMouseMove = useCallback((event: any) => {
    const { features } = event;
    const hoveredFeature = features?.[0];

    if (hoveredFeature) {
      // Find if we have roadwork in the stack
      const roadwork = features.find(
        (f: any) => f.layer.id === "roadwork-fill",
      );

      setHoverInfo({
        longitude: event.lngLat.lng,
        latitude: event.lngLat.lat,
        properties: hoveredFeature.properties,
        isRoadworkConflict:
          !!roadwork && hoveredFeature.layer.id !== "roadwork-fill",
      });
    } else {
      setHoverInfo(null);
    }
  }, []);

  const onMapLoad = useCallback(() => {
    if (geoControlRef.current) {
      geoControlRef.current.trigger();
    }
  }, []);

  const mapFilter =
    activeFilter === "all"
      ? ["has", "category"]
      : ["==", ["get", "category"], activeFilter];

  const calculateDistance = () => {
    if (!selectedAddress || !hoverInfo) return null;
    const from = turf.point([
      selectedAddress.longitude,
      selectedAddress.latitude,
    ]);
    const to = turf.point([hoverInfo.longitude, hoverInfo.latitude]);
    const d = turf.distance(from, to, { units: "kilometers" });
    return (d * 1000).toFixed(0); // Meters
  };

  const walkTime = (meters: string) => {
    return Math.ceil(parseInt(meters, 10) / 80); // ~5km/h = 80m/min
  };

  const distance = calculateDistance();

  return (
    <div className="relative w-full h-screen bg-nc-deep">
      {/* Nova HUD */}
      <div className="nv-hud top-0 left-0 w-full flex flex-col gap-4 pointer-events-none">
        <div className="flex justify-between items-start w-full">
          <div className="flex flex-col gap-4 w-full max-w-md pointer-events-auto">
            {/* Search Bar */}
            <div className="nv-glass rounded-3xl p-1 flex items-center shadow-2xl border border-white/20">
              <div className="pl-4 pr-2">
                <Search className="w-5 h-5 text-nc-neon-teal" />
              </div>
              <input
                type="text"
                placeholder="Search address (e.g. Mannerheimintie 1)"
                className="bg-transparent border-none text-white text-sm w-full py-3 focus:outline-none placeholder:text-white/20"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery("")}
                  className="p-2 hover:bg-white/5 rounded-full mr-1"
                >
                  <X className="w-4 h-4 text-white/40" />
                </button>
              )}
            </div>

            {/* Search Results */}
            {searchResults.length > 0 && (
              <div className="nv-glass rounded-2xl overflow-hidden border border-white/10 shadow-2xl animate-in fade-in slide-in-from-top-4 duration-300">
                {searchResults.map((result: any) => (
                  <button
                    key={result.id}
                    onClick={() => onSelectAddress(result)}
                    className="w-full text-left px-4 py-3 hover:bg-nc-neon-teal/10 transition-colors border-b border-white/5 last:border-0 group flex items-center gap-3"
                  >
                    <Navigation className="w-4 h-4 text-white/20 group-hover:text-nc-neon-teal transition-colors" />
                    <div>
                      <div className="text-sm font-bold text-white">
                        {result.name.fi || result.name.sv}
                      </div>
                      <div className="text-[10px] text-white/40 uppercase tracking-wider">
                        Helsinki Region
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}

            <div className="nv-glass rounded-3xl p-4 flex items-center gap-4">
              <div className="bg-nc-neon-teal/20 p-2 rounded-2xl">
                <Shield className="text-nc-neon-teal w-6 h-6" />
              </div>
              <div>
                <h1 className="text-nv-text-lg font-bold tracking-tighter text-white">
                  PARKKIS
                </h1>
                <p className="text-nv-text-xs text-white/50 uppercase tracking-widest">
                  Capital Region Risk Engine
                </p>
              </div>
            </div>
          </div>

          {!dbReady && (
            <div className="nv-glass rounded-3xl px-6 py-3 flex items-center gap-3 animate-pulse">
              <div className="w-2 h-2 rounded-full bg-nc-neon-teal shadow-[0_0_10px_#00f2ff]" />
              <span className="text-nv-text-sm font-medium text-white">
                {loadingMsg}
              </span>
            </div>
          )}
        </div>

        {dbReady && (
          <div className="flex flex-wrap gap-2">
            <div className="nv-glass rounded-3xl p-2 flex items-center gap-2 pointer-events-auto overflow-x-auto no-scrollbar max-w-fit">
              <div className="px-3 py-2 border-r border-white/10 mr-1">
                <Filter className="w-4 h-4 text-white/40" />
              </div>
              {CATEGORIES.map((cat) => (
                <button
                  key={cat.id}
                  onClick={() => setActiveFilter(cat.id)}
                  className={`px-4 py-2 rounded-2xl text-nv-text-xs font-bold transition-all whitespace-nowrap ${
                    activeFilter === cat.id
                      ? "bg-nc-neon-teal text-nc-deep shadow-[0_0_15px_rgba(0,242,255,0.4)]"
                      : "text-white/40 hover:bg-white/5"
                  }`}
                >
                  {cat.label}
                </button>
              ))}
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => setShowNewTraps(!showNewTraps)}
                className={`nv-glass rounded-3xl px-6 py-2 text-nv-text-xs font-bold transition-all pointer-events-auto flex items-center gap-2 border ${
                  showNewTraps
                    ? "border-nc-neon-teal text-nc-neon-teal bg-nc-neon-teal/10 shadow-[0_0_15px_rgba(0,242,255,0.2)]"
                    : "border-white/10 text-white/40 hover:bg-white/5"
                }`}
              >
                <div
                  className={`w-2 h-2 rounded-full ${showNewTraps ? "bg-nc-neon-teal animate-pulse" : "bg-white/20"}`}
                />
                NEW TRAPS
              </button>

              <button
                onClick={() => setShowSigns(!showSigns)}
                className={`nv-glass rounded-3xl px-6 py-2 text-nv-text-xs font-bold transition-all pointer-events-auto flex items-center gap-2 border ${
                  showSigns
                    ? "border-white text-white bg-white/10 shadow-[0_0_15px_rgba(255,255,255,0.1)]"
                    : "border-white/10 text-white/40 hover:bg-white/5"
                }`}
              >
                <div
                  className={`w-2 h-2 rounded-full ${showSigns ? "bg-white animate-pulse" : "bg-white/20"}`}
                />
                SIGNS
              </button>

              <button
                onClick={() => setShowRoadworks(!showRoadworks)}
                className={`nv-glass rounded-3xl px-6 py-2 text-nv-text-xs font-bold transition-all pointer-events-auto flex items-center gap-2 border ${
                  showRoadworks
                    ? "border-nc-gold text-nc-gold bg-nc-gold/10 shadow-[0_0_15px_rgba(255,207,75,0.2)]"
                    : "border-white/10 text-white/40 hover:bg-white/5"
                }`}
              >
                <div
                  className={`w-2 h-2 rounded-full ${showRoadworks ? "bg-nc-gold animate-pulse" : "bg-white/20"}`}
                />
                ROADWORKS
              </button>
            </div>
          </div>
        )}
      </div>

      <Map
        ref={mapRef}
        initialViewState={INITIAL_VIEW_STATE}
        style={{ width: "100%", height: "100%" }}
        mapStyle="https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json"
        interactiveLayerIds={[
          "parking-lines",
          "sign-points",
          "roadwork-fill",
          "liipi-points",
        ]}
        onMouseMove={onMouseMove}
        onMouseLeave={() => setHoverInfo(null)}
        onLoad={onMapLoad}
      >
        <NavigationControl position="bottom-right" />
        <GeolocateControl
          ref={geoControlRef}
          position="bottom-right"
          trackUserLocation={true}
          showAccuracyCircle={false}
        />

        {riskData && (
          <Source id="risk-data" type="geojson" data={riskData}>
            <Layer
              id="parking-lines"
              type="line"
              filter={mapFilter as any}
              paint={{
                "line-color": [
                  "match",
                  ["get", "category"],
                  "paid",
                  "#3b82f6",
                  "residential",
                  "#ffb800",
                  "free",
                  "#22c55e",
                  "special",
                  "#a855f7",
                  "#888888",
                ],
                "line-width": [
                  "interpolate",
                  ["linear"],
                  ["zoom"],
                  10,
                  2,
                  18,
                  8,
                ],
                "line-opacity": 0.8,
              }}
            />
            <Layer
              id="parking-glow"
              type="line"
              filter={mapFilter as any}
              paint={{
                "line-color": [
                  "interpolate",
                  ["linear"],
                  ["get", "risk_score"],
                  1,
                  "#00f2ff",
                  5,
                  "#ffcf4b",
                  10,
                  "#ff3e3e",
                ],
                "line-width": [
                  "interpolate",
                  ["linear"],
                  ["zoom"],
                  10,
                  4,
                  18,
                  15,
                ],
                "line-blur": 5,
                "line-opacity": 0.5,
              }}
            />
          </Source>
        )}

        {signData && (
          <Source id="sign-data" type="geojson" data={signData}>
            <Layer
              id="sign-points"
              type="circle"
              minzoom={13}
              layout={{ visibility: showSigns ? "visible" : "none" }}
              paint={{
                "circle-radius": [
                  "interpolate",
                  ["linear"],
                  ["zoom"],
                  12,
                  2,
                  18,
                  8,
                ],
                "circle-color": [
                  "match",
                  ["get", "tyyppi"],
                  ["C37", "C38", "C39", "C44.1", "C44.2"],
                  "#ff3e3e",
                  ["E2", "E3.1", "E3.2", "E3.3", "E3.4", "E3.5"],
                  "#3b82f6",
                  ["E24", "E26", "E28"],
                  "#ffcf4b",
                  "#ffffff",
                ],
                "circle-stroke-width": 1.5,
                "circle-stroke-color": "#0a0f14",
                "circle-opacity": [
                  "interpolate",
                  ["linear"],
                  ["zoom"],
                  13,
                  0.4,
                  15,
                  0.9,
                ],
              }}
            />
            <Layer
              id="sign-pulse"
              type="circle"
              minzoom={14}
              filter={["==", ["get", "is_new"], true]}
              layout={{ visibility: showNewTraps ? "visible" : "none" }}
              paint={{
                "circle-radius": [
                  "interpolate",
                  ["linear"],
                  ["zoom"],
                  12,
                  8,
                  18,
                  25,
                ],
                "circle-color": "#00f2ff",
                "circle-opacity": pulseOpacity,
                "circle-blur": 1,
              }}
            />
          </Source>
        )}

        {roadworkData && (
          <Source id="roadwork-data" type="geojson" data={roadworkData}>
            <Layer
              id="roadwork-fill"
              type="fill"
              layout={{ visibility: showRoadworks ? "visible" : "none" }}
              paint={{
                "fill-color": "#ffcf4b",
                "fill-opacity": 0.3,
              }}
            />
            <Layer
              id="roadwork-outline"
              type="line"
              layout={{ visibility: showRoadworks ? "visible" : "none" }}
              paint={{
                "line-color": "#ffcf4b",
                "line-width": 2,
                "line-dasharray": [2, 1],
              }}
            />
          </Source>
        )}

        {hoverInfo && (
          <Popup
            longitude={hoverInfo.longitude}
            latitude={hoverInfo.latitude}
            closeButton={false}
            maxWidth="320px"
          >
            <div className="p-3 bg-[#0a0f14] text-white rounded-lg border border-[#00f2ff]/20 shadow-xl min-w-[240px]">
              <div className="flex justify-between items-start mb-2 border-b border-white/10 pb-2">
                <h3 className="font-bold text-white leading-tight">
                  {hoverInfo.properties.tyyppi || "Parking Area"}
                </h3>
                {hoverInfo.properties.is_new && (
                  <span className="bg-[#00f2ff] text-[#05080a] font-black px-2 py-0.5 rounded text-[10px] ml-2 animate-pulse">
                    NEW RULE
                  </span>
                )}
                {hoverInfo.properties.asukaspysakointitunnus && (
                  <span className="bg-nc-purple text-white font-black px-2 py-0.5 rounded text-xs ml-2 shrink-0 shadow-[0_0_10px_rgba(168,85,247,0.5)]">
                    Zone {hoverInfo.properties.asukaspysakointitunnus}
                  </span>
                )}
              </div>

              {/* Synthetic Confidence Score */}
              <div className="flex items-center justify-between mb-4 bg-white/5 rounded-xl p-3 border border-white/10">
                <div className="flex flex-col">
                  <span className="text-[10px] text-white/40 uppercase font-black tracking-wider">
                    Confidence Score
                  </span>
                  <span
                    className={`text-xl font-black ${
                      hoverInfo.isRoadworkConflict ||
                      hoverInfo.properties.risk_score > 7
                        ? "text-nc-danger"
                        : hoverInfo.properties.risk_score > 3
                          ? "text-nc-gold"
                          : "text-nc-neon-teal"
                    }`}
                  >
                    {hoverInfo.isRoadworkConflict
                      ? "0"
                      : Math.max(
                          0,
                          10 - (hoverInfo.properties.risk_score || 0),
                        )}
                    /10
                  </span>
                </div>
                <div className="text-right">
                  <span className="text-[10px] text-white/40 uppercase font-black block">
                    Status
                  </span>
                  <span
                    className={`text-[10px] font-black uppercase ${
                      hoverInfo.isRoadworkConflict
                        ? "text-nc-danger"
                        : hoverInfo.properties.risk_score > 7
                          ? "text-nc-danger"
                          : hoverInfo.properties.risk_score > 3
                            ? "text-nc-gold"
                            : "text-nc-neon-teal"
                    }`}
                  >
                    {hoverInfo.isRoadworkConflict
                      ? "Restricted"
                      : hoverInfo.properties.risk_score > 7
                        ? "High Risk"
                        : hoverInfo.properties.risk_score > 3
                          ? "Caution"
                          : "Safe to Park"}
                  </span>
                </div>
              </div>

              {hoverInfo.isRoadworkConflict && (
                <div className="bg-nc-danger/20 border border-nc-danger/50 rounded p-2 mb-3 animate-pulse">
                  <span className="block text-xs text-nc-danger font-black uppercase mb-1">
                    ⚠️ ROADWORK CONFLICT
                  </span>
                  <p className="text-[10px] text-white/80 leading-tight">
                    This spot is currently restricted due to active street
                    works.
                  </p>
                </div>
              )}

              {/* Roadwork Specific Info */}
              {hoverInfo.properties.licence_identifier ? (
                <div className="space-y-2">
                  <p className="text-sm text-nc-gold font-bold uppercase tracking-wider">
                    Street Work Permit
                  </p>
                  <p className="text-xs text-white/70">
                    Type: {hoverInfo.properties.licence_type}
                  </p>
                  <p className="text-xs text-white/70">
                    Validity: {hoverInfo.properties.event_startdate_txt} -{" "}
                    {hoverInfo.properties.event_endtdate_txt || "Open"}
                  </p>
                  {hoverInfo.properties.event_description && (
                    <div className="bg-nc-gold/10 border border-nc-gold/30 rounded p-2 text-xs text-nc-gold italic">
                      "{hoverInfo.properties.event_description}"
                    </div>
                  )}
                  <div className="text-[10px] text-white/40 mt-2">
                    ID: {hoverInfo.properties.licence_identifier}
                  </div>
                </div>
              ) : hoverInfo.properties.id?.toString().startsWith("175") ? (
                <div className="space-y-2">
                  <p className="text-sm text-nc-neon-teal font-bold uppercase tracking-wider">
                    Traffic Sign Data
                  </p>
                  <p className="text-xs text-white/70">
                    Modified: {hoverInfo.properties.muokkauspv}
                  </p>
                  {hoverInfo.properties.kilpi_txt1 && (
                    <div className="bg-nc-gold/10 border border-nc-gold/30 rounded p-2 text-xs text-nc-gold italic">
                      "{hoverInfo.properties.kilpi_txt1}"
                    </div>
                  )}
                </div>
              ) : (
                <>
                  <p className="text-sm text-white/70 mb-3 leading-tight">
                    {hoverInfo.properties.luokka_nimi || "No restriction data"}
                  </p>

                  {hoverInfo.properties.asukaspysakointitunnus && (
                    <div className="bg-nc-purple/10 border border-nc-purple/30 rounded p-2 mb-3">
                      <p className="text-[10px] text-nc-purple font-bold uppercase mb-1">
                        Resident Privilege
                      </p>
                      <p className="text-[10px] text-white/80 leading-tight">
                        Requires permit for Zone{" "}
                        {hoverInfo.properties.asukaspysakointitunnus}. Others
                        must follow time rules below.
                      </p>
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-2 mt-2">
                    <div className="bg-white/5 rounded p-2">
                      <span className="block text-xs text-white/50 uppercase">
                        Time Rules
                      </span>
                      <span className="font-bold text-white text-sm">
                        {hoverInfo.properties.voimassaolo || "-"}
                        {hoverInfo.properties.kesto
                          ? ` (${hoverInfo.properties.kesto})`
                          : ""}
                      </span>
                    </div>
                    <div className="bg-white/5 rounded p-2">
                      <span className="block text-xs text-white/50 uppercase">
                        Capacity
                      </span>
                      <span className="font-bold text-white text-sm">
                        {hoverInfo.properties.paikat_ala || "?"} slots
                      </span>
                    </div>
                  </div>

                  {hoverInfo.properties.risk_score >= 3 &&
                    hoverInfo.properties.top_violation_reason && (
                      <div className="bg-red-500/10 border border-red-500/30 rounded p-2 mt-2">
                        <span className="block text-xs text-red-400 uppercase mb-1 font-bold">
                          ⚠️ Top Danger (Risk {hoverInfo.properties.risk_score}
                          /10)
                        </span>
                        <span className="text-xs text-white/80 leading-tight block">
                          {hoverInfo.properties.top_violation_reason.replace(
                            /^\d+\s+/,
                            "",
                          )}
                        </span>
                      </div>
                    )}
                </>
              )}

              {distance && (
                <div className="mt-4 pt-4 border-t border-white/10 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Navigation className="w-4 h-4 text-nc-neon-teal" />
                    <div>
                      <div className="text-[10px] text-white/40 uppercase font-black">
                        Destination Synergy
                      </div>
                      <div className="text-xs text-white font-bold truncate max-w-[120px]">
                        {selectedAddress?.name}
                      </div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm text-nc-neon-teal font-black">
                      {distance}m
                    </div>
                    <div className="text-[10px] text-white/40 uppercase">
                      ~{walkTime(distance)} min walk
                    </div>
                  </div>
                </div>
              )}
            </div>
          </Popup>
        )}
        {liipiData && (
          <Source id="liipi-hubs" type="geojson" data={liipiData}>
            <Layer
              id="liipi-points"
              type="symbol"
              layout={{
                "icon-image": "rocket-15", // Temporary icon until we add a proper SVG
                "icon-size": 1.5,
                "text-field": ["get", "name"],
                "text-font": ["Open Sans Semibold"],
                "text-offset": [0, 1.2],
                "text-anchor": "top",
                "text-size": 10,
              }}
              paint={{
                "text-color": "#00f2ff",
                "text-halo-color": "rgba(5, 8, 10, 0.8)",
                "text-halo-width": 2,
              }}
            />
          </Source>
        )}
      </Map>

      {/* Bento Stats Footer */}
      <div className="absolute bottom-8 left-1/2 -translate-x-1/2 w-full max-w-4xl px-6 grid grid-cols-3 gap-4 pointer-events-none">
        <div className="nv-bento-card pointer-events-auto">
          <div className="flex items-center gap-3 mb-2">
            <MapIcon className="w-4 h-4 text-nc-neon-teal" />
            <span className="text-nv-text-xs font-bold text-white/40 uppercase">
              Coverage
            </span>
          </div>
          <p className="text-nv-text-xl font-bold">Regional Scope</p>
          <p className="text-nv-text-xs text-white/30">
            Helsinki • Espoo • Vantaa
          </p>
        </div>

        <div className="nv-bento-card pointer-events-auto">
          <div className="flex items-center gap-3 mb-2">
            <Info className="w-4 h-4 text-nc-gold" />
            <span className="text-nv-text-xs font-bold text-white/40 uppercase">
              Intelligence
            </span>
          </div>
          <p className="text-nv-text-xl font-bold">165.7k</p>
          <p className="text-nv-text-xs text-white/30">
            Violation Records Join
          </p>
        </div>

        <div className="nv-bento-card pointer-events-auto border-nc-neon-teal/20">
          <div className="flex items-center gap-3 mb-2">
            <Sliders className="w-4 h-4 text-nc-neon-teal" />
            <span className="text-nv-text-xs font-bold text-white/40 uppercase">
              Engine
            </span>
          </div>
          <p className="text-nv-text-xl font-bold">DuckDB</p>
          <p className="text-nv-text-xs text-white/30">Wasm Vector Engine</p>
        </div>
      </div>
    </div>
  );
}

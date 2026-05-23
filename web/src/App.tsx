import { useCallback, useEffect, useRef, useState } from "react";
import ReactMap, {
  GeolocateControl,
  Layer,
  NavigationControl,
  Popup,
  Source,
  type MapLayerMouseEvent,
  type MapRef,
} from "react-map-gl/maplibre";
import "maplibre-gl/dist/maplibre-gl.css";
import type maplibregl from "maplibre-gl";
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
  Moon,
  Sun,
  TreePine,
} from "lucide-react";
import { getDuckDB, loadParquet } from "./lib/duckdb";
import type { FeatureCollection } from "geojson";

interface Address {
  longitude: number;
  latitude: number;
  name: string;
}

interface SearchResult {
  id: number;
  name: { fi: string; sv: string };
  location: {
    coordinates: [number, number];
  };
}

interface HoverInfo {
  longitude: number;
  latitude: number;
  properties: Record<string, string | number | boolean | null>;
  isRoadworkConflict: boolean;
  stackedSigns?: Record<string, string | number | boolean | null>[];
}





const INITIAL_VIEW_STATE = {
  longitude: 24.941,
  latitude: 60.169,
  zoom: 13,
  pitch: 45,
};

const CATEGORIES = [
  { id: "all", label: "All Slots" },
  { id: "residential", label: "Residential" },
  { id: "paid", label: "Paid" },
  { id: "free", label: "Free" },
  { id: "special", label: "Special (EV/Inva)" },
];

type ThemeType = "dark" | "light" | "forest";

const THEME_CONFIGS = {
  dark: {
    mapStyle: "https://tiles.openfreemap.org/styles/dark",
    colors: {
      paid: "#3b82f6",
      residential: "#ffb800",
      free: "#22c55e",
      special: "#a855f7",
      other: "#888888",
      glowLow: "#00f2ff",
      glowMid: "#ffcf4b",
      glowHigh: "#ff3e3e",
    }
  },
  light: {
    mapStyle: "https://tiles.openfreemap.org/styles/positron",
    colors: {
      paid: "#1d4ed8",
      residential: "#d97706",
      free: "#16a34a",
      special: "#7c3aed",
      other: "#4b5563",
      glowLow: "#0891b2",
      glowMid: "#d97706",
      glowHigh: "#dc2626",
    }
  },
  forest: {
    mapStyle: "https://tiles.openfreemap.org/styles/dark",
    colors: {
      paid: "#10b981",
      residential: "#f59e0b",
      free: "#34d399",
      special: "#8b5cf6",
      other: "#4b5563",
      glowLow: "#10b981",
      glowMid: "#f59e0b",
      glowHigh: "#ef4444",
    }
  }
};

// Safe serialization helper for MapLibre/DuckDB
const safeGeoJSON = (data: unknown) => {
  return JSON.parse(
    JSON.stringify(data, (_, v) => (typeof v === "bigint" ? Number(v) : v)),
  );
};

export default function App() {
  const [dbReady, setDbReady] = useState(false);
  const [riskData, setRiskData] = useState<FeatureCollection | null>(null);
  const [signData, setSignData] = useState<FeatureCollection | null>(null);
  const [roadworkData, setRoadworkData] = useState<FeatureCollection | null>(null);
  const [liipiData, setLiipiData] = useState<FeatureCollection | null>(null);
  const [hubiData, setHubiData] = useState<FeatureCollection | null>(null);
  const [loadingMsg, setLoadingMsg] = useState(
    "Initializing Helsinki Parking Safety Map...",
  );
  const [hoverInfo, setHoverInfo] = useState<HoverInfo | null>(null);
  const [activeFilter, setActiveFilter] = useState("all");
  const [showNewTraps, setShowNewTraps] = useState(true);
  const [showRoadworks, setShowRoadworks] = useState(true);
  const [showSigns, setShowSigns] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [selectedAddress, setSelectedAddress] = useState<Address | null>(null);
  const [theme, setTheme] = useState<ThemeType>("dark");
  const [isFooterCollapsed, setIsFooterCollapsed] = useState(false);

  // Apply theme class to document root
  useEffect(() => {
    const root = window.document.documentElement;
    root.classList.remove("theme-light", "theme-forest");
    if (theme === "light") {
      root.classList.add("theme-light");
    } else if (theme === "forest") {
      root.classList.add("theme-forest");
    }
  }, [theme]);

  // English-friendly parking category labels
  const getCategoryLabel = (category: string, luokka: string) => {
    if (category === "residential") return "Resident Permit Parking (Asukaspysäköinti)";
    if (category === "paid") return "Paid Parking (Maksullinen)";
    if (category === "free") return "Free Parking (Ilmainen)";
    if (category === "special") return "Special Parking (EV/Disabled)";
    return luokka || "Standard Parking";
  };

  // Visual highlights, emojis, and styling classes for each traffic sign type (vayla.fi official classifications)
  const getSignVisuals = (type: string) => {
    const t = String(type).trim().toUpperCase();
    
    // Prohibitory and Restrictive Signs (C-sarja)
    if (/^C37/.test(t)) {
      return { emoji: "🛑", colorClass: "border-l-4 border-nc-neon-red bg-nc-neon-red/10", textClass: "text-nc-neon-red" }; // Stop prohibited (severe)
    }
    if (/^(C38|C39|C40|C44)/.test(t)) {
      return { emoji: "🚫", colorClass: "border-l-4 border-nc-neon-red bg-nc-neon-red/10", textClass: "text-nc-neon-red" }; // Parking prohibited
    }
    if (/^C/.test(t)) {
      return { emoji: "🚫", colorClass: "border-l-4 border-nc-neon-red bg-nc-neon-red/10", textClass: "text-nc-neon-red" }; // Other prohibitions
    }
    
    // Regulatory Signs (E-sarja)
    if (/^(E2|E3)/.test(t)) {
      return { emoji: "🅿️", colorClass: "border-l-4 border-nc-neon-teal bg-nc-neon-teal/10", textClass: "text-nc-neon-teal" }; // Parking Place
    }
    if (/^E4/.test(t)) {
      return { emoji: "🚕", colorClass: "border-l-4 border-nc-gold bg-nc-gold/10", textClass: "text-nc-gold" }; // Taxi stand
    }
    
    // Additional Panels (H-sarja - Lisäkilvet)
    if (/^H12\.7/.test(t)) {
      return { emoji: "♿", colorClass: "border-l-4 border-nc-purple bg-nc-purple/10", textClass: "text-nc-purple" }; // Disabled parking
    }
    if (/^H12\.9/.test(t)) {
      return { emoji: "🔌", colorClass: "border-l-4 border-nc-neon-teal bg-nc-neon-teal/10", textClass: "text-nc-neon-teal" }; // EV charging
    }
    if (/^H12/.test(t)) {
      return { emoji: "🚗", colorClass: "border-l-4 border-nc-text/30 bg-nc-text/5", textClass: "text-nc-text" }; // Specific vehicle restriction
    }
    if (/^H(17|18)/.test(t)) {
      return { emoji: "↔️", colorClass: "border-l-4 border-nc-text/30 bg-nc-text/5", textClass: "text-nc-text" }; // Directional arrows
    }
    if (/^H19/.test(t)) {
      return { emoji: "🕒", colorClass: "border-l-4 border-nc-neon-teal bg-nc-neon-teal/10", textClass: "text-nc-neon-teal" }; // Time limit / hours
    }
    if (/^H24/.test(t)) {
      return { emoji: "🎫", colorClass: "border-l-4 border-nc-purple bg-nc-purple/10", textClass: "text-nc-purple" }; // Resident permit privilege
    }
    if (/^H25/.test(t)) {
      return { emoji: "🛠️", colorClass: "border-l-4 border-nc-gold bg-nc-gold/10", textClass: "text-nc-gold" }; // Maintenance traffic allowed
    }
    
    return { emoji: "ℹ️", colorClass: "border-l-4 border-nc-text/30 bg-nc-text/5", textClass: "text-nc-text" }; // Default panel info
  };

  const geoControlRef = useRef<maplibregl.GeolocateControl>(null);
  const mapRef = useRef<MapRef>(null);
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

  const getSignLabel = (type: string) => {
    const labels: Record<string, string> = {
      C37: "No Stopping",
      C38: "No Parking",
      C39: "No Parking Zone Starts",
      C40: "No Parking Zone Ends",
      C32: "Speed Limit",
      C34: "Speed Limit Zone",
      E2: "Parking Place",
      E3: "Parking Place",
      "E3.1": "Parking Place (Time Limit)",
      "E4.1": "Taxi Stand",
      H19: "Time Limit",
      H24: "Except with Resident Permit",
      H25: "For Maintenance Only",
    };
    return labels[type] || type;
  };

  const onSelectAddress = (result: SearchResult) => {
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
        version: "2.6.0",
        buildTime: new Date().toISOString(),
        environment: import.meta.env.MODE,
        base: import.meta.env.BASE_URL,
      });

      try {
        setLoadingMsg("Loading local parking spots...");

        const baseUrl = import.meta.env.BASE_URL.endsWith("/")
          ? import.meta.env.BASE_URL
          : `${import.meta.env.BASE_URL}/`;
        
        const slotsUrl = new URL(`${baseUrl}data/slots.parquet`, window.location.origin).href;
        const violationsUrl = new URL(`${baseUrl}data/violations.parquet`, window.location.origin).href;
        const signsUrl = new URL(`${baseUrl}data/signs.parquet`, window.location.origin).href;
        const roadworksUrl = new URL(`${baseUrl}data/roadworks.parquet`, window.location.origin).href;
        const liipiUrl = new URL(`${baseUrl}data/liipi.parquet`, window.location.origin).href;
        const hubiUrl = new URL(`${baseUrl}data/hubi.parquet`, window.location.origin).href;

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
              'kilpi_txt5': kilpi_txt5
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

        // 4. Load Roadworks
        setLoadingMsg("Scanning for active street construction...");
        const roadworksResult = await conn.query(`
          SELECT 
            ST_AsGeoJSON(geom) as geometry, 
            struct_pack(COLUMNS(* EXCLUDE geom)) as properties 
          FROM roadworks
        `);
        const roadworksGeoJSON = {
          type: "FeatureCollection" as const,
          features: (roadworksResult.toArray() as unknown as any[]).map((row) => ({
            type: "Feature" as const,
            geometry: JSON.parse(row.geometry),
            properties: row.properties,
          })),
        };
        setRoadworkData(safeGeoJSON(roadworksGeoJSON));
 
        // 5. Load LiiPi (Park & Ride)
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

        // 6. Load Parkkihubi
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
        
        // 7. Cleanup
        await conn.close();
        setDbReady(true);
      } catch (e) {
        console.error("Data Engine Failure:", e);
        setLoadingMsg("Failed to initialize. Check console.");
      }
    };
    initData();
  }, []);

  const onMouseMove = useCallback((event: MapLayerMouseEvent) => {
    const { features } = event;
    const hoveredFeature = features?.[0];

    if (hoveredFeature) {
      // Aggregate all signs at this location
      const signs = features
        .filter((f) => f.layer.id === "sign-points")
        .map((f) => f.properties);

      // Find if we have roadwork in the stack
      const roadwork = features.find(
        (f) => f.layer.id === "roadwork-fill",
      );

      setHoverInfo({
        longitude: event.lngLat.lng,
        latitude: event.lngLat.lat,
        properties: hoveredFeature.properties,
        isRoadworkConflict:
          !!roadwork && hoveredFeature.layer.id !== "roadwork-fill",
        stackedSigns: signs.length > 0 ? signs : undefined,
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

  const mapFilter: import("maplibre-gl").FilterSpecification =
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
    <div className="relative w-full h-screen bg-nc-deep text-nc-text">
      {/* Floating Theme Selector (Top-Right) */}
      <div className="absolute top-6 right-6 z-50 pointer-events-auto flex items-center gap-2">
        <div className="nv-glass rounded-full p-1.5 flex items-center gap-1 shadow-2xl">
          {[
            { id: "dark", label: "Night Captain", icon: Moon, activeColor: "text-nc-neon-teal" },
            { id: "light", label: "Day Patrol", icon: Sun, activeColor: "text-nc-gold" },
            { id: "forest", label: "Nordic Forest", icon: TreePine, activeColor: "text-emerald-400" },
          ].map((themeOpt) => {
            const Icon = themeOpt.icon;
            const isActive = theme === themeOpt.id;
            return (
              <button
                type="button"
                key={themeOpt.id}
                onClick={() => setTheme(themeOpt.id as ThemeType)}
                className={`p-2 rounded-full transition-all duration-300 flex items-center justify-center relative group ${
                  isActive
                    ? "bg-nc-text/15 shadow-inner scale-110"
                    : "hover:bg-nc-text/5 text-nc-text-dim hover:text-nc-text"
                }`}
                title={themeOpt.label}
              >
                <Icon className={`w-4 h-4 ${isActive ? themeOpt.activeColor : "text-current"}`} />
                <span className="absolute right-full mr-2 bg-nc-void border border-nc-border text-nc-text text-[10px] font-bold px-2 py-1 rounded-md opacity-0 pointer-events-none group-hover:opacity-100 transition-opacity duration-200 whitespace-nowrap shadow-lg">
                  {themeOpt.label}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Nova HUD */}
      <div className="nv-hud top-0 left-0 w-full flex flex-col gap-4 pointer-events-none">
        <div className="flex justify-between items-start w-full">
          <div className="flex flex-col gap-4 w-full max-w-md pointer-events-auto">
            {/* Search Bar */}
            <div className="nv-glass rounded-3xl p-1 flex items-center shadow-2xl border border-nc-border">
              <div className="pl-4 pr-2">
                <Search className="w-5 h-5 text-nc-neon-teal" />
              </div>
              <input
                type="text"
                placeholder="Search address (e.g. Mannerheimintie 1)"
                className="bg-transparent border-none text-nc-text text-sm w-full py-3 focus:outline-none placeholder:text-nc-text-dim"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery("")}
                  className="p-2 hover:bg-nc-text/5 rounded-full mr-1"
                >
                  <X className="w-4 h-4 text-nc-text-dim" />
                </button>
              )}
            </div>

            {/* Search Results */}
            {searchResults.length > 0 && (
              <div className="nv-glass rounded-2xl overflow-hidden border border-nc-border shadow-2xl animate-in fade-in slide-in-from-top-4 duration-300">
                {searchResults.map((result: SearchResult) => (
                  <button
                    type="button"
                    key={result.id}
                    onClick={() => onSelectAddress(result)}
                    className="w-full text-left px-4 py-3 hover:bg-nc-neon-teal/10 transition-colors border-b border-nc-border/40 last:border-0 group flex items-center gap-3"
                  >
                    <Navigation className="w-4 h-4 text-nc-text-dim group-hover:text-nc-neon-teal transition-colors" />
                    <div>
                      <div className="text-sm font-bold text-nc-text">
                        {result.name.fi || result.name.sv}
                      </div>
                      <div className="text-[10px] text-nc-text-dim uppercase tracking-wider">
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
                <h1 className="text-nv-text-lg font-bold tracking-tighter text-nc-text">
                  PARKKIS
                </h1>
                <p className="text-nv-text-xs text-nc-text-muted uppercase tracking-widest">
                  Helsinki Parking Safety Map
                </p>
              </div>
            </div>
          </div>

          {!dbReady && (
            <div className="nv-glass rounded-3xl px-6 py-3 flex items-center gap-3 animate-pulse">
              <div className="w-2 h-2 rounded-full bg-nc-neon-teal shadow-[0_0_10px_#00f2ff]" />
              <span className="text-nv-text-sm font-medium text-nc-text">
                {loadingMsg}
              </span>
            </div>
          )}
        </div>

        {dbReady && (
          <div className="flex flex-wrap gap-2">
            <div className="nv-glass rounded-3xl p-2 flex items-center gap-2 pointer-events-auto overflow-x-auto no-scrollbar max-w-fit">
              <div className="px-3 py-2 border-r border-nc-border mr-1">
                <Filter className="w-4 h-4 text-nc-text-dim" />
              </div>
              {CATEGORIES.map((cat) => (
                <button
                  type="button"
                  key={cat.id}
                  onClick={() => setActiveFilter(cat.id)}
                  className={`px-4 py-2 rounded-2xl text-nv-text-xs font-bold transition-all whitespace-nowrap ${
                    activeFilter === cat.id
                      ? "bg-nc-neon-teal text-nc-deep shadow-[0_0_15px_rgba(0,242,255,0.4)]"
                      : "text-nc-text-dim hover:bg-nc-text/5"
                  }`}
                >
                  {cat.label}
                </button>
              ))}
            </div>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setShowNewTraps(!showNewTraps)}
                className={`nv-glass rounded-3xl px-6 py-2 text-nv-text-xs font-bold transition-all pointer-events-auto flex items-center gap-2 border ${
                  showNewTraps
                    ? "border-nc-neon-teal text-nc-neon-teal bg-nc-neon-teal/10 shadow-[0_0_15px_rgba(0,242,255,0.2)]"
                    : "border-nc-border text-nc-text-dim hover:bg-nc-text/5"
                }`}
              >
                <div
                  className={`w-2 h-2 rounded-full ${showNewTraps ? "bg-nc-neon-teal animate-pulse" : "bg-nc-text/20"}`}
                />
                TICKET HOTSPOTS
              </button>

              <button
                type="button"
                onClick={() => setShowSigns(!showSigns)}
                className={`nv-glass rounded-3xl px-6 py-2 text-nv-text-xs font-bold transition-all pointer-events-auto flex items-center gap-2 border ${
                  showSigns
                    ? "border-nc-text text-nc-text bg-nc-text/10 shadow-[0_0_15px_rgba(255,255,255,0.1)]"
                    : "border-nc-border text-nc-text-dim hover:bg-nc-text/5"
                }`}
              >
                <div
                  className={`w-2 h-2 rounded-full ${showSigns ? "bg-nc-text animate-pulse" : "bg-nc-text/20"}`}
                />
                PARKING SIGNS
              </button>

              <button
                type="button"
                onClick={() => setShowRoadworks(!showRoadworks)}
                className={`nv-glass rounded-3xl px-6 py-2 text-nv-text-xs font-bold transition-all pointer-events-auto flex items-center gap-2 border ${
                  showRoadworks
                    ? "border-nc-gold text-nc-gold bg-nc-gold/10 shadow-[0_0_15px_rgba(255,207,75,0.2)]"
                    : "border-nc-border text-nc-text-dim hover:bg-nc-text/5"
                }`}
              >
                <div
                  className={`w-2 h-2 rounded-full ${showRoadworks ? "bg-nc-gold animate-pulse" : "bg-nc-text/20"}`}
                />
                CONSTRUCTION
              </button>
            </div>
          </div>
        )}
      </div>
      <ReactMap
        ref={mapRef}
        initialViewState={INITIAL_VIEW_STATE}
        style={{ width: "100%", height: "100%" }}
        mapStyle={THEME_CONFIGS[theme].mapStyle}
        interactiveLayerIds={[
          "parking-lines",
          "hubi-lines",
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
              filter={mapFilter}
              paint={{
                "line-color": [
                  "match",
                  ["get", "category"],
                  "paid",
                  THEME_CONFIGS[theme].colors.paid,
                  "residential",
                  THEME_CONFIGS[theme].colors.residential,
                  "free",
                  THEME_CONFIGS[theme].colors.free,
                  "special",
                  THEME_CONFIGS[theme].colors.special,
                  THEME_CONFIGS[theme].colors.other,
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
              filter={mapFilter}
              paint={{
                "line-color": [
                  "interpolate",
                  ["linear"],
                  ["get", "risk_score"],
                  1,
                  THEME_CONFIGS[theme].colors.glowLow,
                  5,
                  THEME_CONFIGS[theme].colors.glowMid,
                  10,
                  THEME_CONFIGS[theme].colors.glowHigh,
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

        {hubiData && (
          <Source id="hubi-data" type="geojson" data={hubiData}>
            <Layer
              id="hubi-lines"
              type="line"
              paint={{
                "line-color": THEME_CONFIGS[theme].colors.glowLow,
                "line-width": [
                  "interpolate",
                  ["linear"],
                  ["zoom"],
                  10,
                  2,
                  18,
                  6,
                ],
                "line-opacity": 0.8,
                "line-dasharray": [2, 2],
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
                  THEME_CONFIGS[theme].colors.glowHigh,
                  ["E2", "E3.1", "E3.2", "E3.3", "E3.4", "E3.5"],
                  THEME_CONFIGS[theme].colors.paid,
                  ["E24", "E26", "E28"],
                  THEME_CONFIGS[theme].colors.glowMid,
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
                "circle-color": THEME_CONFIGS[theme].colors.glowLow,
                "circle-opacity": pulseOpacity,
                "circle-blur": 1,
              }}
            />
            <Layer
              id="sign-labels"
              type="symbol"
              minzoom={15}
              layout={{
                "text-field": [
                  "match",
                  ["get", "tyyppi"],
                  "C37",
                  "🛑", // No stopping
                  ["C38", "C39", "C40", "C44.1", "C44.2"],
                  "🚫", // No parking
                  ["E2", "E3.1", "E3.2", "E3.3", "E3.4", "E3.5"],
                  "🅿️", // Parking Place
                  "E4.1",
                  "🚕", // Taxi
                  "H12.7",
                  "♿", // Disabled parking
                  "H12.9",
                  "🔌", // EV charging
                  "H24",
                  "🎫", // Resident Permit
                  "H25",
                  "🛠️", // Maintenance Only
                  "H19",
                  "🕒", // Time limit
                  "ℹ️" // Info default
                ],
                "text-size": 13,
                "text-offset": [0, -1.2],
                "text-anchor": "bottom",
                "visibility": showSigns ? "visible" : "none"
              }}
              paint={{
                "text-halo-color": "rgba(5, 8, 10, 0.95)",
                "text-halo-width": 2,
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
            className="nv-popup"
          >
            <div className="p-3 bg-nc-void text-nc-text rounded-lg border border-nc-border shadow-xl min-w-[240px]">
              <div className="flex justify-between items-start mb-2 border-b border-nc-border pb-2">
                <h3 className="font-bold text-nc-text leading-tight">
                  {hoverInfo.properties.tyyppi || "Parking Area"}
                </h3>
                {hoverInfo.properties.is_new && (
                  <span className="bg-nc-neon-teal text-nc-deep font-black px-2 py-0.5 rounded text-[10px] ml-2 animate-pulse">
                    NEW RULE
                  </span>
                )}
                {hoverInfo.properties.asukaspysakointitunnus && (
                  <span className="bg-nc-purple text-nc-text font-black px-2 py-0.5 rounded text-xs ml-2 shrink-0 shadow-[0_0_10px_rgba(168,85,247,0.5)]">
                    Zone {hoverInfo.properties.asukaspysakointitunnus}
                  </span>
                )}
              </div>

              {/* Parking Risk & Violation count */}
              <div className="flex items-center justify-between mb-4 bg-nc-text/5 rounded-xl p-3 border border-nc-border">
                <div className="flex flex-col">
                  <span className="text-[10px] text-nc-text-dim uppercase font-black tracking-wider">
                    Parking Risk
                  </span>
                  <span
                    className={`text-xl font-black ${
                      hoverInfo.isRoadworkConflict ||
                      Number(hoverInfo.properties.risk_score ?? 0) > 7
                        ? "text-nc-danger"
                        : Number(hoverInfo.properties.risk_score ?? 0) > 3
                          ? "text-nc-gold"
                          : "text-nc-neon-teal"
                    }`}
                  >
                    {hoverInfo.isRoadworkConflict
                      ? "Restricted"
                      : Number(hoverInfo.properties.risk_score ?? 0) > 7
                        ? "High Risk"
                        : Number(hoverInfo.properties.risk_score ?? 0) > 3
                          ? "Moderate Risk"
                          : "Low Risk"}
                  </span>
                </div>
                <div className="text-right">
                  <span className="text-[10px] text-nc-text-dim uppercase font-black block">
                    Tickets Mapped
                  </span>
                  <span className="text-sm font-bold text-nc-text">
                    {hoverInfo.properties.fine_count !== undefined
                      ? `${hoverInfo.properties.fine_count} fines`
                      : "0 fines"}
                  </span>
                </div>
              </div>

              {hoverInfo.isRoadworkConflict && (
                <div className="bg-nc-danger/20 border border-nc-danger/50 rounded p-2 mb-3 animate-pulse">
                  <span className="block text-xs text-nc-danger font-black uppercase mb-1">
                    ⚠️ ROADWORK CONFLICT
                  </span>
                  <p className="text-[10px] text-nc-text-muted leading-tight">
                    This spot is currently restricted due to active street
                    works.
                  </p>
                </div>
              )}

              {/* Traffic Sign Data (Visual vertical representation of a physical sign pole in real-world order) */}
              {hoverInfo.stackedSigns ? (
                <div className="space-y-3">
                  <p className="text-xs text-nc-neon-teal font-black uppercase tracking-wider border-b border-nc-neon-teal/20 pb-1.5 flex items-center gap-1.5">
                    <Shield className="w-3.5 h-3.5" />
                    Sign Pole Stack ({hoverInfo.stackedSigns.length} Signs)
                  </p>
                  
                  {/* Vertical metal pole visualization line */}
                  <div className="relative pl-4 space-y-3 before:content-[''] before:absolute before:left-[5px] before:top-2 before:bottom-2 before:w-[2px] before:bg-nc-text-dim/30">
                    {[...hoverInfo.stackedSigns]
                      .sort((a, b) => {
                        const typeA = String(a.tyyppi || "").toUpperCase();
                        const typeB = String(b.tyyppi || "").toUpperCase();
                        
                        // All official additional panels in Finland belong to the H series.
                        // Any sign not starting with H is a main primary sign (A, B, C, D, E, F, G series).
                        const isMainA = !typeA.startsWith("H");
                        const isMainB = !typeB.startsWith("H");
                        
                        if (isMainA && !isMainB) return -1; // Main sign A goes above additional panel B
                        if (!isMainA && isMainB) return 1;  // Main sign B goes above additional panel A
                        
                        return typeA.localeCompare(typeB); // Alphabetical ordering for identical hierarchy levels
                      })
                      .map((sign) => {
                        const visuals = getSignVisuals(String(sign.tyyppi));
                        return (
                          <div 
                            key={String(sign.id)} 
                            className={`relative space-y-1.5 p-2.5 rounded-lg border border-nc-border/40 hover:border-nc-border transition-all duration-200 shadow-md ${visuals.colorClass}`}
                          >
                            {/* Pole connection bullet indicator */}
                          <div className={`absolute left-[-16px] top-4 w-2 h-2 rounded-full border border-nc-void ${
                            visuals.textClass === "text-nc-neon-red" ? "bg-nc-neon-red" :
                            visuals.textClass === "text-nc-neon-teal" ? "bg-nc-neon-teal" : "bg-nc-gold"
                          }`} />
                          
                          <div className="flex justify-between items-center gap-1">
                            <div className="flex items-center gap-1.5 shrink-0">
                              <span className="text-sm select-none">{visuals.emoji}</span>
                              <span className={`text-[11px] font-black uppercase tracking-wider ${visuals.textClass}`}>
                                {sign.tyyppi}
                              </span>
                            </div>
                            <span className="text-[10px] text-nc-text font-black uppercase text-right leading-none truncate max-w-[120px]">
                              {getSignLabel(String(sign.tyyppi))}
                            </span>
                          </div>

                          {/* Subtexts / Additional plates */}
                          <div className="flex flex-col gap-1">
                            {[1, 2, 3, 4, 5].map((n) => {
                              const txt = sign[`kilpi_txt${n}`];
                              return txt ? (
                                <div
                                  key={n}
                                  className="text-[9px] bg-nc-text/5 border border-nc-border/30 rounded px-2 py-0.5 text-nc-text-muted font-medium italic leading-tight"
                                >
                                  "{txt}"
                                </div>
                              ) : null;
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : hoverInfo.properties.licence_identifier ? (
                <div className="space-y-2">
                  <p className="text-sm text-nc-gold font-bold uppercase tracking-wider">
                    Street Work Permit
                  </p>
                  <p className="text-xs text-nc-text-muted">
                    Type: {hoverInfo.properties.licence_type}
                  </p>
                  <p className="text-xs text-nc-text-muted">
                    Validity: {hoverInfo.properties.event_startdate_txt} -{" "}
                    {hoverInfo.properties.event_endtdate_txt || "Open"}
                  </p>
                  {hoverInfo.properties.event_description && (
                    <div className="bg-nc-gold/10 border border-nc-gold/30 rounded p-2 text-xs text-nc-gold italic">
                      "{hoverInfo.properties.event_description}"
                    </div>
                  )}
                  <div className="text-[10px] text-nc-text-dim mt-2">
                    ID: {hoverInfo.properties.licence_identifier}
                  </div>
                </div>
              ) : (
                <>
                  <p className="text-sm text-nc-text-muted mb-3 leading-tight font-bold">
                    {getCategoryLabel(String(hoverInfo.properties.category || ""), String(hoverInfo.properties.luokka_nimi || ""))}
                  </p>

                  {hoverInfo.properties.asukaspysakointitunnus && (
                    <div className="bg-nc-purple/10 border border-nc-purple/30 rounded p-2 mb-3">
                      <p className="text-[10px] text-nc-purple font-bold uppercase mb-1">
                        Resident Privilege
                      </p>
                      <p className="text-[10px] text-nc-text-muted leading-tight">
                        Requires permit for Zone{" "}
                        {hoverInfo.properties.asukaspysakointitunnus}. Others
                        must follow time rules below.
                      </p>
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-2 mt-2">
                    <div className="bg-nc-text/5 rounded p-2">
                      <span className="block text-xs text-nc-text-dim uppercase">
                        Time Rules
                      </span>
                      <span className="font-bold text-nc-text text-sm">
                        {hoverInfo.properties.voimassaolo || "-"}
                        {hoverInfo.properties.kesto
                          ? ` (${hoverInfo.properties.kesto})`
                          : ""}
                      </span>
                    </div>
                    <div className="bg-nc-text/5 rounded p-2">
                      <span className="block text-xs text-nc-text-dim uppercase">
                        Capacity
                      </span>
                      <span className="font-bold text-nc-text text-sm">
                        {hoverInfo.properties.paikat_ala || "?"} slots
                      </span>
                    </div>
                  </div>

                  {Number(hoverInfo.properties.risk_score ?? 0) >= 3 &&
                    hoverInfo.properties.top_violation_reason && (
                      <div className="bg-nc-danger/10 border border-nc-danger/30 rounded p-2 mt-2">
                        <span className="block text-xs text-nc-danger uppercase mb-1 font-bold">
                          ⚠️ Top Violation Cause
                        </span>
                        <span className="text-xs text-nc-text-muted leading-tight block">
                          {String(hoverInfo.properties.top_violation_reason || "")
                            .replace(/^\d+\s+/, "")}
                        </span>
                      </div>
                    )}
                </>
              )}

              {distance && (
                <div className="mt-4 pt-4 border-t border-nc-border flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Navigation className="w-4 h-4 text-nc-neon-teal" />
                    <div>
                      <div className="text-[10px] text-nc-text-dim uppercase font-black">
                        Target Destination
                      </div>
                      <div className="text-xs text-nc-text font-bold truncate max-w-[120px]">
                        {selectedAddress?.name}
                      </div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm text-nc-neon-teal font-black">
                      {distance}m
                    </div>
                    <div className="text-[10px] text-nc-text-dim uppercase">
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
              id="liipi-glow"
              type="circle"
              paint={{
                "circle-radius": 15,
                "circle-color": THEME_CONFIGS[theme].colors.glowLow,
                "circle-opacity": 0.2,
                "circle-blur": 1,
              }}
            />
            <Layer
              id="liipi-points"
              type="circle"
              paint={{
                "circle-radius": 6,
                "circle-color": THEME_CONFIGS[theme].colors.glowLow,
                "circle-stroke-width": 2,
                "circle-stroke-color": "#ffffff",
              }}
            />
            <Layer
              id="liipi-labels"
              type="symbol"
              layout={{
                "text-field": ["coalesce", ["get", "fi", ["get", "name"]], ["get", "name"]],
                "text-font": ["Noto Sans Bold"],
                "text-variable-anchor": ["top", "bottom", "left", "right"],
                "text-radial-offset": 0.8,
                "text-justify": "auto",
                "text-size": 10,
              }}
              paint={{
                "text-color": THEME_CONFIGS[theme].colors.glowLow,
                "text-halo-color": "rgba(5, 8, 10, 0.8)",
                "text-halo-width": 2,
              }}
            />
          </Source>
        )}
      </ReactMap>

      {/* Bento Stats Footer */}
      <div className="absolute bottom-6 left-1/2 -translate-x-1/2 w-full max-w-4xl px-6 flex flex-col gap-2 pointer-events-none transition-all duration-300">
        {/* Toggle Expand / Collapse Button */}
        <div className="flex justify-end w-full pointer-events-auto pr-2">
          <button
            type="button"
            onClick={() => setIsFooterCollapsed(!isFooterCollapsed)}
            className="nv-glass rounded-full px-4 py-1.5 text-[11px] font-bold text-nc-text hover:bg-nc-text/10 flex items-center gap-1.5 shadow-lg pointer-events-auto"
          >
            {isFooterCollapsed ? (
              <>
                <Info className="w-3.5 h-3.5 text-nc-neon-teal" />
                <span>Show Safety Guide & Info</span>
              </>
            ) : (
              <>
                <X className="w-3.5 h-3.5 text-nc-neon-red" />
                <span>Hide Info Panel</span>
              </>
            )}
          </button>
        </div>

        {!isFooterCollapsed && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pointer-events-none animate-in fade-in slide-in-from-bottom-4 duration-300">
            <div className="nv-bento-card pointer-events-auto">
              <div className="flex items-center gap-3 mb-2">
                <MapIcon className="w-4 h-4 text-nc-neon-teal" />
                <span className="text-nv-text-xs font-black text-nc-text-dim uppercase tracking-wider">
                  How to Use
                </span>
              </div>
              <p className="text-[14px] font-bold text-nc-text">Tap to Inspect</p>
              <p className="text-nv-text-xs text-nc-text-muted mt-1 leading-normal">
                Click or hover on any parking line, sign pole, or highlight to check if it's safe to park.
              </p>
            </div>

            <div className="nv-bento-card pointer-events-auto">
              <div className="flex items-center gap-3 mb-2">
                <Shield className="w-4 h-4 text-nc-gold" />
                <span className="text-nv-text-xs font-black text-nc-text-dim uppercase tracking-wider">
                  Mapped Fines
                </span>
              </div>
              <p className="text-[14px] font-bold text-nc-text">165.7k Tickets Mapped</p>
              <p className="text-nv-text-xs text-nc-text-muted mt-1 leading-normal">
                We analyze fine density around parking spots so you can instantly recognize high-risk zones.
              </p>
            </div>

            <div className="nv-bento-card pointer-events-auto border-nc-neon-teal/20">
              <div className="flex items-center gap-3 mb-2">
                <Sliders className="w-4 h-4 text-nc-neon-teal" />
                <span className="text-nv-text-xs font-black text-nc-text-dim uppercase tracking-wider">
                  Live Guidance
                </span>
              </div>
              <p className="text-[14px] font-bold text-nc-text">Signs Override Map</p>
              <p className="text-nv-text-xs text-nc-text-muted mt-1 leading-normal">
                Signage and construction change frequently. Always confirm safety against physical street signs!
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

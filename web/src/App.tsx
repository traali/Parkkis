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
  Calendar,
  MapPin,
  Database,
  ExternalLink,
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
  layerId?: string;
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
    mapStyle: "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json",
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
    mapStyle: "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json",
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
    mapStyle: "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json",
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

// Safe JSON parser utility
const parseJsonSafe = (str: unknown) => {
  if (!str) return null;
  try {
    return JSON.parse(String(str));
  } catch {
    return null;
  }
};

// Typo-tolerant case identifier parser for HEL-case diary codes
const parseHelCaseTypo = (text: string) => {
  if (!text) return null;
  
  // Look for HEL, optional spaces/dashes, 4-digit year, spaces/dashes, 5-6 digit number
  // Example: HEL 2023- -005659
  const typoRegex = /HEL[\s-]*(\d{4})[\s-_]*[\s-_]*(\d{5,6})/i;
  const match = text.match(typoRegex);
  if (match) {
    const year = match[1];
    const num = match[2];
    const normalized = `HEL ${year}-${num}`;
    
    // Check if the original matches the strict standard "HEL \d{4}-\d{6}" format
    const originalMatch = match[0];
    const isStandard = /^HEL\s\d{4}-\d{6}$/.test(originalMatch);
    
    return {
      original: originalMatch,
      normalized: normalized,
      hasTypo: !isStandard,
      caseCode: `hel-${year}-${num}`
    };
  }
  return null;
};

// Financial rent extractor (matches annual "vuosivuokra" or monthly "kuukausivuokra" text + amounts)
const extractRentInfo = (text: string) => {
  if (!text) return null;
  
  let annualRent: string | null = null;
  let monthlyRent: string | null = null;
  
  // Helper to strip any trailing punctuation or trailing spacing from the captured digits
  const cleanAmount = (val: string) => {
    return val.trim().replace(/[.,\s]+$/, "");
  };
  
  const currencyGroup = "(?:euroa|euron|euro|\\be\\b|€)";
  const currencyGroupWithEur = "(?:€|euroa|euron|euro|\\be\\b|\\beur\\b)";
  
  // 1. Annual Rent (vuosivuokra) - prioritized by explicitness
  const annualPatterns = [
    // [summa] euroa vuodessa/vuosittain/vuodelta
    new RegExp(`(\\d+[\\d\\s,.]*)\\s*${currencyGroup}\\s*(?:n\\s*)?(?:vuodessa|vuosittain|vuodelta)`, "i"),
    // [summa] euron vuosivuokraa
    new RegExp(`(\\d+[\\d\\s,.]*)\\s*${currencyGroup}\\s*(?:n\\s*)?(?:vuosivuokra[a-z]*)`, "i"),
    // vuosivuokra on [summa] euroa
    new RegExp(`(?:vuosivuokra[a-z]*)\\s*(?:on\\s*)?(\\d+[\\d\\s,.]*)\\s*${currencyGroup}`, "i"),
    // [summa] € / v (or vuosi)
    new RegExp(`(\\d+[\\d\\s,.]*)\\s*${currencyGroupWithEur}\\s*\\/\\s*(?:v|vuosi)`, "i")
  ];
  
  for (const pattern of annualPatterns) {
    const match = text.match(pattern);
    if (match) {
      annualRent = cleanAmount(match[1]);
      break;
    }
  }
  
  // 2. Monthly Rent (kuukausivuokra) - prioritized by explicitness
  const monthlyPatterns = [
    // [summa] euroa kuukaudessa/kuukausittain/kuukaudelta
    new RegExp(`(\\d+[\\d\\s,.]*)\\s*${currencyGroup}\\s*(?:n\\s*)?(?:kuukaudessa|kuukausittain|kuukaudelta)`, "i"),
    // [summa] euron kuukausivuokraa
    new RegExp(`(\\d+[\\d\\s,.]*)\\s*${currencyGroup}\\s*(?:n\\s*)?(?:kuukausivuokra[a-z]*)`, "i"),
    // kuukausivuokra on [summa] euroa
    new RegExp(`(?:kuukausivuokra[a-z]*)\\s*(?:on\\s*)?(\\d+[\\d\\s,.]*)\\s*${currencyGroup}`, "i"),
    // [summa] € / kk
    new RegExp(`(\\d+[\\d\\s,.]*)\\s*${currencyGroupWithEur}\\s*\\/\\s*kk`, "i")
  ];
  
  for (const pattern of monthlyPatterns) {
    const match = text.match(pattern);
    if (match) {
      monthlyRent = cleanAmount(match[1]);
      break;
    }
  }
  
  // 3. General Rent (vuokra) fallback
  if (!annualRent && !monthlyRent) {
    const generalPatterns = [
      new RegExp(`(\\d+[\\d\\s,.]*)\\s*${currencyGroup}\\s*(?:n\\s*)?(?:vuokra[a-z]*)`, "i"),
      new RegExp(`(?:vuokra[a-z]*)\\s*(?:on\\s*)?(\\d+[\\d\\s,.]*)\\s*${currencyGroup}`, "i")
    ];
    for (const pattern of generalPatterns) {
      const match = text.match(pattern);
      if (match) {
        monthlyRent = cleanAmount(match[1]); // Default general to monthly
        break;
      }
    }
  }
  
  if (annualRent || monthlyRent) {
    return {
      annual: annualRent,
      monthly: monthlyRent
    };
  }
  return null;
};

// Auto hyperlink parser for descriptions (handles URLs, HEL-cases, and Sopimus/Plot contract codes)
const renderTextWithLinks = (text: string) => {
  if (!text) return "";
  const urlRegex = /(https?:\/\/[^\s]+|www\.[^\s]+)/gi;
  const helRegex = /HEL[\s-]*\d{4}[\s-_]*[\s-_]*\d{5,6}/i;
  const sopimusRegex = /\b091-\d+-\d+-\d+(?:-\d+)?\b/i;
  const combinedRegex = /(https?:\/\/[^\s]+|www\.[^\s]+|HEL[\s-]*\d{4}[\s-_]*[\s-_]*\d{5,6}|\b091-\d+-\d+-\d+(?:-\d+)?\b)/gi;
  const parts = text.split(combinedRegex);
  
  let keyCount = 0;
  return parts.map((part) => {
    keyCount += 1;
    if (part.match(urlRegex)) {
      const href = part.startsWith("http") ? part : `https://${part}`;
      return (
        <a
          key={keyCount}
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="text-nc-neon-teal hover:text-white underline font-bold cursor-pointer break-all"
          onClick={(e) => e.stopPropagation()}
        >
          {part}
        </a>
      );
    }
    if (part.match(helRegex)) {
      const caseDetails = parseHelCaseTypo(part);
      if (caseDetails) {
        const href = `https://paatokset.hel.fi/fi/asia/${caseDetails.caseCode}`;
        return (
          <a
            key={keyCount}
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-nc-neon-teal hover:text-white underline font-bold cursor-pointer break-all"
            onClick={(e) => e.stopPropagation()}
            title={caseDetails.hasTypo ? `Original typo: ${caseDetails.original}` : undefined}
          >
            {caseDetails.normalized}
            {caseDetails.hasTypo && <span className="ml-1 text-[9px] text-nc-gold opacity-90 font-black tracking-wide">(⚠️ typo corrected)</span>}
          </a>
        );
      }
    }
    if (part.match(sopimusRegex)) {
      const match = part.match(/\b091-\d+-\d+-\d+(?:-\d+)?\b/i);
      const contractId = match ? match[0] : part;
      const href = `https://paatokset.hel.fi/fi/haku?search_api_fulltext=${encodeURIComponent(contractId)}`;
      return (
        <a
          key={keyCount}
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="text-orange-400 hover:text-white underline font-bold cursor-pointer break-all"
          onClick={(e) => e.stopPropagation()}
          title={`Search Helsinki Decisions for contract/plot ${contractId}`}
        >
          {part}
        </a>
      );
    }
    return part;
  });
};
// Centroid calculator for polygons and multipolygons
const getCentroid = (geometry: any): [number, number] | null => {
  if (!geometry) return null;
  try {
    if (geometry.type === "Point") {
      return geometry.coordinates as [number, number];
    }
    if (geometry.type === "Polygon") {
      const coords = geometry.coordinates[0];
      let sumLng = 0;
      let sumLat = 0;
      for (const c of coords) {
        sumLng += c[0];
        sumLat += c[1];
      }
      return [sumLng / coords.length, sumLat / coords.length];
    }
    if (geometry.type === "MultiPolygon") {
      const coords = geometry.coordinates[0][0];
      let sumLng = 0;
      let sumLat = 0;
      for (const c of coords) {
        sumLng += c[0];
        sumLat += c[1];
      }
      return [sumLng / coords.length, sumLat / coords.length];
    }
  } catch {
    return null;
  }
  return null;
};

export default function App() {
  const [dbReady, setDbReady] = useState(false);
  const [riskData, setRiskData] = useState<FeatureCollection | null>(null);
  const [violationData, setViolationData] = useState<FeatureCollection | null>(null);
  const [signData, setSignData] = useState<FeatureCollection | null>(null);
  const [roadworkData, setRoadworkData] = useState<FeatureCollection | null>(null);
  const [reservationData, setReservationData] = useState<FeatureCollection | null>(null);
  const [liipiData, setLiipiData] = useState<FeatureCollection | null>(null);
  const [hubiData, setHubiData] = useState<FeatureCollection | null>(null);
  const [loadingMsg, setLoadingMsg] = useState(
    "Initializing Helsinki Parking Safety Map...",
  );
  const [hoverInfo, setHoverInfo] = useState<HoverInfo | null>(null);
  const [activeFilter, setActiveFilter] = useState("all");
  const [showNewTraps, setShowNewTraps] = useState(true);
  const [showViolations, setShowViolations] = useState(true);
  const [showRoadworks, setShowRoadworks] = useState(true);
  const [showReservations, setShowReservations] = useState(true);
  const [showSigns, setShowSigns] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [selectedAddress, setSelectedAddress] = useState<Address | null>(null);
  const [theme, setTheme] = useState<ThemeType>("dark");
  const [isFooterCollapsed, setIsFooterCollapsed] = useState(false);
  const [showResList, setShowResList] = useState(false);
  const [resSearchQuery, setResSearchQuery] = useState("");
  const [resCategory, setResCategory] = useState("all");
  const [resSortBy, setResSortBy] = useState("start");
  const [showMetadataModal, setShowMetadataModal] = useState(false);
  const [activeMetaTab, setActiveMetaTab] = useState("siirrot");
  
  // Live on-demand decision rent fetching & parsing states
  const [liveRentMap, setLiveRentMap] = useState<Record<string, { annual: string | null; monthly: string | null } | null>>({});
  const [loadingRentMap, setLoadingRentMap] = useState<Record<string, boolean>>({});
  const [errorRentMap, setErrorRentMap] = useState<Record<string, string | null>>({});

  const handleFetchLiveRent = async (caseCode: string) => {
    if (loadingRentMap[caseCode] || liveRentMap[caseCode]) return;
    
    setLoadingRentMap(prev => ({ ...prev, [caseCode]: true }));
    setErrorRentMap(prev => ({ ...prev, [caseCode]: null }));
    
    try {
      const targetUrl = `https://paatokset.hel.fi/fi/asia/${caseCode}`;
      const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(targetUrl)}`;
      
      const resp = await fetch(proxyUrl);
      if (!resp.ok) throw new Error("Network response was not ok");
      
      const htmlText = await resp.text();
      
      // Parse HTML content to plain text using DOMParser
      const parser = new DOMParser();
      const doc = parser.parseFromString(htmlText, "text/html");
      const pageText = doc.body.textContent || "";
      
      // Extract rent pricing details from the official decision text
      const extracted = extractRentInfo(pageText);
      if (extracted) {
        setLiveRentMap(prev => ({ ...prev, [caseCode]: extracted }));
      } else {
        setLiveRentMap(prev => ({ ...prev, [caseCode]: null })); // Mark as fetched with no values
        setErrorRentMap(prev => ({ ...prev, [caseCode]: "No rent amounts found in decision document." }));
      }
    } catch (err) {
      console.error("Error fetching live decision details:", err);
      setErrorRentMap(prev => ({ ...prev, [caseCode]: "Failed to load document from Helsinki Decisions." }));
    } finally {
      setLoadingRentMap(prev => ({ ...prev, [caseCode]: false }));
    }
  };

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

        // 3b. Load violations as standalone point layer (city-wide coverage)
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

        // 4. Load Roadworks + Reservations live from WFS (always fresh, datasets are small)
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
          // Fallback to parquet if live fetch fails
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
        (f) => f.layer.id === "roadwork-fill" || f.layer.id === "reservation-fill",
      );

      setHoverInfo({
        longitude: event.lngLat.lng,
        latitude: event.lngLat.lat,
        properties: hoveredFeature.properties,
        isRoadworkConflict:
          !!roadwork && hoveredFeature.layer.id !== "roadwork-fill",
        stackedSigns: signs.length > 0 ? signs : undefined,
        layerId: hoveredFeature.layer.id,
      });
    } else {
      setHoverInfo(null);
    }
  }, []);

  useEffect(() => {
    try {
      const searchParams = new URLSearchParams(window.location.search);
      const latParam = searchParams.get("lat");
      const lonParam = searchParams.get("lon") || searchParams.get("lng");
      const themeParam = searchParams.get("theme");

      if (themeParam && (themeParam === "dark" || themeParam === "light" || themeParam === "forest")) {
        setTheme(themeParam as ThemeType);
      }

      if (latParam && lonParam) {
        const lat = parseFloat(latParam);
        const lon = parseFloat(lonParam);
        if (!isNaN(lat) && !isNaN(lon)) {
          const rawVenue = window.location.pathname.replace(/^\/venue\//, "").replace(/\+/g, " ");
          const venueName = rawVenue ? decodeURIComponent(rawVenue) : "Ottelukenttä";
          setSelectedAddress({
            latitude: lat,
            longitude: lon,
            name: venueName,
          });
        }
      }
    } catch (err) {
      console.warn("URL params parsing error in Parkkis:", err);
    }
  }, []);

  const onMapLoad = useCallback(() => {
    try {
      const searchParams = new URLSearchParams(window.location.search);
      const latParam = searchParams.get("lat");
      const lonParam = searchParams.get("lon") || searchParams.get("lng");
      if (latParam && lonParam && mapRef.current) {
        const lat = parseFloat(latParam);
        const lon = parseFloat(lonParam);
        if (!isNaN(lat) && !isNaN(lon)) {
          mapRef.current.flyTo({
            center: [lon, lat],
            zoom: 16,
            pitch: 50,
            duration: 1500,
          });
          return;
        }
      }
    } catch (err) {
      console.warn("Error centering map on venue params:", err);
    }

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

  // Dynamic filtered and sorted reservations list
  const getFilteredReservations = () => {
    if (!reservationData?.features) return [];
    
    return reservationData.features
      .filter((feat) => {
        const props = feat.properties || {};
        const subject = String(props.rental_subject || "").toLowerCase();
        
        // Category Filter
        if (resCategory === "paid" && !subject.includes("pysäköinti") && !subject.includes("pysakoiti")) return false;
        if (resCategory === "lisapihat" && !subject.includes("lisäpiha") && !subject.includes("lisapiha")) return false;
        if (resCategory === "other" && (subject.includes("pysäköinti") || subject.includes("pysakoiti") || subject.includes("lisäpiha") || subject.includes("lisapiha"))) return false;
        
        // Search Filter
        if (resSearchQuery) {
          const query = resSearchQuery.toLowerCase();
          const desc = String(props.event_description || "").toLowerCase();
          const loc = String(props.location_description || "").toLowerCase();
          const comp = String(props.licence_applicant_company || "").toLowerCase();
          const identifier = String(props.licence_identifier || "").toLowerCase();
          const type = String(props.licence_type || "").toLowerCase();
          
          if (
            !desc.includes(query) &&
            !loc.includes(query) &&
            !comp.includes(query) &&
            !identifier.includes(query) &&
            !type.includes(query)
          ) {
            return false;
          }
        }
        
        return true;
      })
      .sort((a, b) => {
        const propsA = a.properties || {};
        const propsB = b.properties || {};
        
        if (resSortBy === "name") {
          const nameA = String(propsA.rental_subject || "");
          const nameB = String(propsB.rental_subject || "");
          return nameA.localeCompare(nameB);
        }
        
        if (resSortBy === "end") {
          const endA = String(propsA.event_enddate || propsA.licence_enddate || "9999-12-31");
          const endB = String(propsB.event_enddate || propsB.licence_enddate || "9999-12-31");
          return endA.localeCompare(endB);
        }
        
        // Default "start" (newest first)
        const startA = String(propsA.event_startdate || propsA.licence_startdate || "1970-01-01");
        const startB = String(propsB.event_startdate || propsB.licence_startdate || "1970-01-01");
        return startB.localeCompare(startA); // Descending for newest first
      });
  };

  const handleReservationClick = (feat: any) => {
    const center = getCentroid(feat.geometry);
    if (center && mapRef.current) {
      mapRef.current.flyTo({
        center: center,
        zoom: 17,
        pitch: 45,
        duration: 1500
      });
      
      setHoverInfo({
        longitude: center[0],
        latitude: center[1],
        properties: feat.properties,
        isRoadworkConflict: false,
        layerId: "reservation-fill",
      });
    }
  };

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
                onClick={() => setShowViolations(!showViolations)}
                className={`nv-glass rounded-3xl px-6 py-2 text-nv-text-xs font-bold transition-all pointer-events-auto flex items-center gap-2 border ${
                  showViolations
                    ? "border-nc-danger text-nc-danger bg-nc-danger/10 shadow-[0_0_15px_rgba(239,68,68,0.2)]"
                    : "border-nc-border text-nc-text-dim hover:bg-nc-text/5"
                }`}
              >
                <div
                  className={`w-2 h-2 rounded-full ${showViolations ? "bg-nc-danger animate-pulse" : "bg-nc-text/20"}`}
                />
                FINE LOCATIONS
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

              <button
                type="button"
                onClick={() => setShowReservations(!showReservations)}
                className={`nv-glass rounded-3xl px-6 py-2 text-nv-text-xs font-bold transition-all pointer-events-auto flex items-center gap-2 border ${
                  showReservations
                    ? "border-orange-400 text-orange-400 bg-orange-400/10 shadow-[0_0_15px_rgba(251,146,60,0.2)]"
                    : "border-nc-border text-nc-text-dim hover:bg-nc-text/5"
                }`}
              >
                <div
                  className={`w-2 h-2 rounded-full ${showReservations ? "bg-orange-400 animate-pulse" : "bg-nc-text/20"}`}
                />
                RESERVATIONS
              </button>

              <button
                type="button"
                onClick={() => setShowResList(!showResList)}
                className={`nv-glass rounded-3xl px-6 py-2 text-nv-text-xs font-bold transition-all pointer-events-auto flex items-center gap-2 border ${
                  showResList
                    ? "border-orange-400 text-orange-400 bg-orange-400/20 shadow-[0_0_15px_rgba(251,146,60,0.3)] font-black"
                    : "border-nc-border text-nc-text-dim hover:bg-nc-text/5"
                }`}
              >
                <div
                  className={`w-2 h-2 rounded-full ${showResList ? "bg-orange-400 animate-pulse" : "bg-nc-text/20"}`}
                />
                📋 LIST VIEW
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
          "reservation-fill",
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

        {violationData && (
          <Source id="violation-heat" type="geojson" data={violationData}>
            <Layer
              id="violation-points"
              type="circle"
              layout={{ visibility: showViolations ? "visible" : "none" }}
              paint={{
                "circle-radius": [
                  "interpolate", ["linear"], ["zoom"],
                  11, 2.5,
                  14, 6,
                  17, 12,
                ],
                "circle-color": THEME_CONFIGS[theme].colors.glowHigh,
                "circle-opacity": [
                  "interpolate", ["linear"], ["zoom"],
                  11, 0.25,
                  14, 0.35,
                  17, 0.5,
                ],
                "circle-blur": 1.2,
              }}
            />
          </Source>
        )}


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
                "fill-opacity": 0.35,
              }}
            />
            <Layer
              id="roadwork-outline"
              type="line"
              layout={{ visibility: showRoadworks ? "visible" : "none" }}
              paint={{
                "line-color": "#ffcf4b",
                "line-width": 2.5,
                "line-dasharray": [3, 1],
              }}
            />
            <Layer
              id="roadwork-label"
              type="symbol"
              minzoom={14}
              layout={{
                visibility: showRoadworks ? "visible" : "none",
                "text-field": "🚧",
                "text-size": 16,
                "symbol-placement": "point",
              }}
              paint={{
                "text-halo-color": "rgba(5,8,10,0.9)",
                "text-halo-width": 2,
              }}
            />
          </Source>
        )}

        {reservationData && (
          <Source id="reservation-data" type="geojson" data={reservationData}>
            <Layer
              id="reservation-fill"
              type="fill"
              layout={{ visibility: showReservations ? "visible" : "none" }}
              paint={{
                "fill-color": [
                  "match",
                  ["get", "rental_subject"],
                  "Pysäköinti", "#f97316",
                  ["Lisäpihat", "Lisäalue"], "#fb923c",
                  "#f97316",
                ],
                "fill-opacity": 0.25,
              }}
            />
            <Layer
              id="reservation-outline"
              type="line"
              layout={{ visibility: showReservations ? "visible" : "none" }}
              paint={{
                "line-color": "#f97316",
                "line-width": 1.5,
                "line-dasharray": [4, 2],
              }}
            />
            <Layer
              id="reservation-label"
              type="symbol"
              minzoom={14}
              layout={{
                visibility: showReservations ? "visible" : "none",
                "text-field": [
                  "match",
                  ["get", "rental_subject"],
                  "Pysäköinti", "🅿️",
                  "🔶",
                ],
                "text-size": 14,
                "symbol-placement": "point",
              }}
              paint={{
                "text-halo-color": "rgba(5,8,10,0.9)",
                "text-halo-width": 2,
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
              {hoverInfo.layerId === "liipi-points" ? (
                <>
                  <div className="flex justify-between items-start mb-2 border-b border-nc-border pb-2">
                    <h3 className="font-bold text-nc-neon-teal leading-tight flex items-center gap-1.5">
                      🚲 Park & Ride
                    </h3>
                    <span className="bg-nc-neon-teal/20 text-nc-neon-teal font-black px-2 py-0.5 rounded text-[10px] uppercase">
                      {String(hoverInfo.properties.status || "").replace("_", " ")}
                    </span>
                  </div>
                  <div className="space-y-2 mt-2">
                    <p className="text-sm font-bold text-nc-text leading-snug">
                      {(() => {
                        const nameObj = parseJsonSafe(hoverInfo.properties.name);
                        return nameObj?.fi || nameObj?.en || nameObj?.sv || String(hoverInfo.properties.name || "");
                      })()}
                    </p>
                    <div className="bg-nc-text/5 border border-nc-border/40 rounded-xl p-3 space-y-1.5">
                      <span className="block text-[9px] text-nc-text-dim uppercase font-black tracking-wider">
                        Commuter Capacity
                      </span>
                      {(() => {
                        const capObj = parseJsonSafe(hoverInfo.properties.builtCapacity);
                        return capObj ? (
                          Object.entries(capObj).map(([key, val]) => (
                            <div key={key} className="flex items-center justify-between text-xs">
                              <span className="text-nc-text-muted capitalize font-medium">
                                {key === "CAR" ? "🚗 Car Spaces" : key === "BICYCLE" ? "🚲 Bicycle Spaces" : `🔌 ${key}`}
                              </span>
                              <span className="font-bold text-nc-text">{String(val)} slots</span>
                            </div>
                          ))
                        ) : (
                          <span className="text-xs text-nc-text-muted italic">Capacity not specified</span>
                        );
                      })()}
                    </div>
                  </div>
                </>
              ) : hoverInfo.layerId === "hubi-lines" ? (
                <>
                  <div className="flex justify-between items-start mb-2 border-b border-nc-border pb-2">
                    <h3 className="font-bold text-nc-neon-teal leading-tight flex items-center gap-1.5">
                      🏢 Public Facility
                    </h3>
                    <span className="bg-nc-neon-teal/20 text-nc-neon-teal font-black px-2 py-0.5 rounded text-[10px] uppercase">
                      Parkkihubi
                    </span>
                  </div>
                  <div className="space-y-2 mt-2">
                    <p className="text-[10px] text-nc-text-dim uppercase font-black">Facility ID</p>
                    <p className="text-xs font-mono text-nc-text leading-tight truncate">{String(hoverInfo.properties.id || "")}</p>
                    <div className="bg-nc-text/5 border border-nc-border/40 rounded-xl p-3 flex justify-between items-center">
                      <div>
                        <span className="block text-[9px] text-nc-text-dim uppercase font-black tracking-wider">
                          Estimated Capacity
                        </span>
                        <span className="text-xs font-medium text-nc-text-muted">Public Hub</span>
                      </div>
                      <span className="text-sm font-black text-nc-text">
                        {hoverInfo.properties.capacity_estimate ? `${hoverInfo.properties.capacity_estimate} slots` : "Open space"}
                      </span>
                    </div>
                  </div>
                </>
              ) : (
                <>
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
                            <span 
                              className="text-[10px] text-nc-text font-black uppercase text-right leading-none truncate max-w-[160px]"
                              title={`${getSignLabel(String(sign.tyyppi))}${sign.arvo ? ` (${sign.arvo} km/h)` : ""}`}
                            >
                              {getSignLabel(String(sign.tyyppi))}
                              {sign.arvo ? ` (${sign.arvo} km/h)` : ""}
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
                                  {txt}
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
                  {/* Roadworks popup */}
                  {hoverInfo.properties.rental_subject ? (
                    <>
                      <p className="text-sm text-orange-400 font-bold uppercase tracking-wider flex items-center gap-1.5">
                        🔶 Temporary Reservation
                      </p>
                      <div className="bg-orange-400/10 border border-orange-400/30 rounded p-2">
                        <p className="text-xs text-orange-300 font-bold mb-1">{hoverInfo.properties.rental_subject}</p>
                        {hoverInfo.properties.licence_description && hoverInfo.properties.licence_description !== "N/A" && (
                          <p className="text-[10px] text-nc-text-muted italic">{renderTextWithLinks(String(hoverInfo.properties.licence_description))}</p>
                        )}
                      </div>
                    </>
                  ) : (
                    <p className="text-sm text-nc-gold font-bold uppercase tracking-wider flex items-center gap-1.5">
                      🚧 Street Work
                    </p>
                  )}
                  <div className="grid grid-cols-2 gap-1.5">
                    <div className="bg-nc-text/5 rounded p-2">
                      <span className="block text-[9px] text-nc-text-dim uppercase font-bold">From</span>
                      <span className="text-[11px] font-bold text-nc-text">{hoverInfo.properties.event_startdate_txt || hoverInfo.properties.lic_startdate_txt || "?"}</span>
                    </div>
                    <div className="bg-nc-text/5 rounded p-2">
                      <span className="block text-[9px] text-nc-text-dim uppercase font-bold">Until</span>
                      <span className="text-[11px] font-bold text-nc-text">{hoverInfo.properties.event_endtdate_txt || hoverInfo.properties.lic_enddate_txt || "Open"}</span>
                    </div>
                  </div>
                  {hoverInfo.properties.event_description && (
                    <div className="bg-nc-gold/10 border border-nc-gold/30 rounded p-2 text-xs text-nc-gold">
                      {renderTextWithLinks(String(hoverInfo.properties.event_description))}
                    </div>
                  )}
                  {hoverInfo.properties.location_description && (
                    <p className="text-[10px] text-nc-text-muted italic">{hoverInfo.properties.location_description}</p>
                  )}
                  <div className="text-[9px] text-nc-text-dim">
                    Permit: {hoverInfo.properties.licence_identifier}
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
        {/* Toggle Expand / Collapse Buttons */}
        <div className="flex justify-end w-full pointer-events-auto pr-2 gap-2">
          <button
            type="button"
            onClick={() => setShowMetadataModal(true)}
            className="nv-glass rounded-full px-4 py-1.5 text-[11px] font-bold text-nc-text hover:bg-nc-text/10 flex items-center gap-1.5 shadow-lg pointer-events-auto cursor-pointer"
          >
            <Database className="w-3.5 h-3.5 text-nc-neon-teal" />
            <span>🌐 Paikkatieto & Metadata</span>
          </button>
          
          <button
            type="button"
            onClick={() => setIsFooterCollapsed(!isFooterCollapsed)}
            className="nv-glass rounded-full px-4 py-1.5 text-[11px] font-bold text-nc-text hover:bg-nc-text/10 flex items-center gap-1.5 shadow-lg pointer-events-auto cursor-pointer"
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

      {/* Dynamic Reservations List Panel (Slides out from the right) */}
      <div
        className={`fixed right-6 top-24 bottom-32 w-96 z-55 transition-all duration-500 transform flex flex-col pointer-events-auto ${
          showResList ? "translate-x-0 opacity-100 scale-100" : "translate-x-full opacity-0 scale-95 pointer-events-none"
        }`}
      >
        <div className="nv-glass border border-nc-border rounded-3xl p-4 flex flex-col h-full overflow-hidden shadow-2xl relative">
          {/* Header */}
          <div className="flex justify-between items-center pb-3 border-b border-nc-border">
            <div>
              <h2 className="text-nv-text-sm font-black text-nc-text flex items-center gap-1.5 uppercase">
                📋 Reservations List
              </h2>
              <span className="text-[10px] text-nc-text-muted uppercase font-bold tracking-wider">
                {getFilteredReservations().length} Active Reservations Mapped
              </span>
            </div>
            <button
              type="button"
              onClick={() => setShowResList(false)}
              className="p-1.5 hover:bg-nc-text/10 rounded-full border border-nc-border transition-colors group"
            >
              <X className="w-4 h-4 text-nc-text-muted group-hover:text-nc-neon-red transition-colors" />
            </button>
          </div>

          {/* Filtering & Sorting Controls */}
          <div className="space-y-3 py-3 border-b border-nc-border shrink-0">
            {/* Search Input */}
            <div className="relative flex items-center">
              <Search className="w-4 h-4 absolute left-3 text-nc-neon-teal" />
              <input
                type="text"
                placeholder="Search description, applicant, ID..."
                className="w-full pl-9 pr-8 py-2 bg-nc-void/60 border border-nc-border/60 rounded-2xl text-xs text-nc-text placeholder:text-nc-text-dim focus:outline-none focus:border-nc-neon-teal transition-colors"
                value={resSearchQuery}
                onChange={(e) => setResSearchQuery(e.target.value)}
              />
              {resSearchQuery && (
                <button
                  type="button"
                  onClick={() => setResSearchQuery("")}
                  className="absolute right-3 p-0.5 hover:bg-nc-text/10 rounded-full"
                >
                  <X className="w-3.5 h-3.5 text-nc-text-dim" />
                </button>
              )}
            </div>

            {/* Category Tabs */}
            <div className="flex gap-1 overflow-x-auto no-scrollbar pb-1">
              {[
                { id: "all", label: "All" },
                { id: "paid", label: "🅿️ Parking" },
                { id: "lisapihat", label: "🔶 Yards" },
                { id: "other", label: "Other" },
              ].map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setResCategory(tab.id)}
                  className={`px-3 py-1.5 rounded-xl text-[10px] font-black uppercase transition-all whitespace-nowrap border ${
                    resCategory === tab.id
                      ? "border-orange-400 text-orange-400 bg-orange-400/10 shadow-[0_0_10px_rgba(251,146,60,0.1)]"
                      : "border-nc-border/40 text-nc-text-dim hover:bg-nc-text/5"
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* Sorting controls */}
            <div className="flex items-center justify-between text-[10px] uppercase font-bold text-nc-text-dim">
              <span>Sort by</span>
              <div className="flex gap-1.5">
                {[
                  { id: "start", label: "Newest" },
                  { id: "end", label: "Expiring" },
                  { id: "name", label: "Subject" },
                ].map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setResSortBy(opt.id)}
                    className={`px-2 py-1 rounded transition-colors ${
                      resSortBy === opt.id
                        ? "text-nc-neon-teal bg-nc-neon-teal/10"
                        : "text-nc-text-muted hover:text-white"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Scrollable list container */}
          <div className="flex-1 overflow-y-auto no-scrollbar py-2 space-y-2.5 min-h-0">
            {getFilteredReservations().length > 0 ? (
              getFilteredReservations().map((feat: any, idx) => {
                const props = feat.properties || {};
                const start = props.event_startdate_txt || props.lic_startdate_txt || "?";
                const end = props.event_endtdate_txt || props.lic_enddate_txt || "Open";
                const subject = props.rental_subject || "Temporary Reservation";
                const desc = props.event_description || props.licence_description || "";
                const applicant = props.licence_applicant_company && props.licence_applicant_company !== "N/A" ? props.licence_applicant_company : null;
                const loc = props.location_description && props.location_description !== "N/A" ? props.location_description : null;
                const isParking = String(subject).toLowerCase().includes("pysäköinti") || String(subject).toLowerCase().includes("pysakoiti");
                
                // Typo-tolerant Helsinki case identifier parser (e.g. HEL 2023- -005659)
                const allText = `${subject} ${desc} ${props.licence_identifier || ""}`;
                const caseDetails = parseHelCaseTypo(allText);
                
                // Extract financial rent info from the text description
                const localRent = extractRentInfo(desc);
                
                // Determine what rent info to show: either local (pre-parsed) or live (fetched on demand)
                const liveRent = caseDetails ? liveRentMap[caseDetails.caseCode] : null;
                const rentInfo = localRent || liveRent;
                
                const isLoadingRent = caseDetails ? !!loadingRentMap[caseDetails.caseCode] : false;
                const rentError = caseDetails ? errorRentMap[caseDetails.caseCode] : null;
                const hasFetchedLive = caseDetails ? (caseDetails.caseCode in liveRentMap) : false;
                
                return (
                  // biome-ignore lint/a11y/useKeyWithClickEvents: nested links inside div make this layout semantic
                  // biome-ignore lint/a11y/noStaticElementInteractions: div card container is used for styling layout
                  <div
                    key={props.licence_identifier || idx}
                    onClick={() => handleReservationClick(feat)}
                    className="p-3 bg-nc-void/40 border border-nc-border/40 hover:border-orange-400/50 hover:bg-nc-void/70 rounded-2xl cursor-pointer transition-all duration-200 shadow-md group space-y-2 relative overflow-hidden"
                  >
                    {/* Background visual indicator border */}
                    <div className={`absolute left-0 top-0 bottom-0 w-[3px] ${isParking ? "bg-orange-400" : "bg-orange-300/60"}`} />
                    
                    {/* Subject & Status */}
                    <div className="flex justify-between items-start gap-1 pl-1">
                      <h4 className="text-xs font-black text-nc-text group-hover:text-orange-400 transition-colors uppercase leading-tight">
                        {isParking ? "🅿️" : "🔶"} {subject}
                      </h4>
                      <span className="bg-orange-400/20 text-orange-400 border border-orange-400/30 font-black px-1.5 py-0.5 rounded text-[8px] uppercase tracking-wider shrink-0">
                        Active
                      </span>
                    </div>

                    {/* Description (processed with clickable hyperlink parser) */}
                    {desc && (
                      <p className="text-[11px] text-nc-text-muted leading-snug pl-1">
                        {renderTextWithLinks(desc)}
                      </p>
                    )}

                    {/* Official Decision Link Badge & Live Fetcher */}
                    {caseDetails && (
                      <div className="pl-1 pt-0.5 flex flex-wrap items-center gap-2">
                        <a
                          href={`https://paatokset.hel.fi/fi/asia/${caseDetails.caseCode}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 border rounded-xl text-[9px] font-black uppercase tracking-wider transition-all ${
                            caseDetails.hasTypo
                              ? "bg-nc-gold/10 hover:bg-nc-gold/20 border-nc-gold/40 text-nc-gold"
                              : "bg-nc-neon-teal/10 hover:bg-nc-neon-teal/20 border-nc-neon-teal/30 text-nc-neon-teal hover:border-nc-neon-teal/50"
                          }`}
                          onClick={(e) => e.stopPropagation()}
                          title={caseDetails.hasTypo ? `Corrected from typo: ${caseDetails.original}` : undefined}
                        >
                          📜 {caseDetails.hasTypo ? `⚠️ Corrected: ${caseDetails.normalized}` : `Decision: ${caseDetails.normalized}`}
                        </a>
                        
                        {!rentInfo && !(caseDetails.caseCode in liveRentMap) && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleFetchLiveRent(caseDetails.caseCode);
                            }}
                            disabled={isLoadingRent}
                            className="inline-flex items-center gap-1 px-2.5 py-0.5 bg-nc-neon-teal/10 hover:bg-nc-neon-teal/20 border border-nc-neon-teal/30 hover:border-nc-neon-teal/50 rounded-xl text-[9px] font-black text-nc-neon-teal uppercase tracking-wider transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            {isLoadingRent ? "⏳ Fetching..." : "🔍 Extract Rent"}
                          </button>
                        )}
                      </div>
                    )}

                    {/* Financial Rent Info Pills */}
                    {rentInfo && (
                      <div className="flex flex-wrap gap-2 pl-1 pt-0.5">
                        {rentInfo.annual && (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 bg-emerald-500/10 border border-emerald-500/30 rounded-xl text-[9px] font-black text-emerald-400 uppercase tracking-wider">
                            💰 Annual Rent: {rentInfo.annual} € {hasFetchedLive && !localRent && <span className="text-[8px] text-nc-neon-teal font-medium ml-1">(📡 Live)</span>}
                          </span>
                        )}
                        {rentInfo.monthly && (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 bg-emerald-500/10 border border-emerald-500/30 rounded-xl text-[9px] font-black text-emerald-400 uppercase tracking-wider">
                            💰 Monthly Rent: {rentInfo.monthly} € {hasFetchedLive && !localRent && <span className="text-[8px] text-nc-neon-teal font-medium ml-1">(📡 Live)</span>}
                          </span>
                        )}
                      </div>
                    )}

                    {/* Rent Fetch Feedback Messages */}
                    {rentError && !localRent && (
                      <p className="text-[9px] text-nc-text-muted pl-1 italic font-medium">
                        ℹ️ {rentError}
                      </p>
                    )}

                    {/* Applicant Company */}
                    {applicant && (
                      <p className="text-[10px] text-nc-text-dim font-bold uppercase pl-1 truncate">
                        🏢 {applicant}
                      </p>
                    )}

                    {/* Meta data row: dates & location */}
                    <div className="pt-2 border-t border-nc-border/30 flex flex-wrap gap-x-3 gap-y-1.5 text-[9px] text-nc-text-dim font-medium pl-1">
                      <div className="flex items-center gap-1">
                        <Calendar className="w-3.5 h-3.5 text-orange-400/70" />
                        <span>{start} - {end}</span>
                      </div>
                      {loc && (
                        <div className="flex items-center gap-1 max-w-[150px] truncate">
                          <MapPin className="w-3.5 h-3.5 text-orange-400/70" />
                          <span title={loc}>{loc}</span>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="flex flex-col items-center justify-center py-12 text-center space-y-2">
                <p className="text-xs font-bold text-nc-text-muted">No reservations found</p>
                <p className="text-[10px] text-nc-text-dim max-w-[200px]">
                  Try refining your search term or switching the category filter.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
      {/* Dynamic Metadata Catalogue Modal */}
      {showMetadataModal && (
        <div className="fixed inset-0 z-60 flex items-center justify-center p-4">
          <button
            type="button"
            aria-label="Sulje metatiedot"
            className="fixed inset-0 bg-nc-void/80 backdrop-blur-md animate-in fade-in duration-300 w-full h-full cursor-default border-none"
            onClick={() => setShowMetadataModal(false)}
          />
          <div 
            role="dialog"
            aria-modal="true"
            className="nv-glass border border-nc-border/60 rounded-3xl w-full max-w-3xl max-h-[85vh] flex flex-col overflow-hidden shadow-2xl relative animate-in zoom-in-95 duration-300 z-10"
          >
            {/* Modal Header */}
            <div className="flex justify-between items-center px-6 py-4 border-b border-nc-border/40 shrink-0">
              <div className="flex items-center gap-2.5">
                <Database className="w-5 h-5 text-nc-neon-teal" />
                <div className="text-left">
                  <h2 className="text-sm md:text-base font-black text-nc-text uppercase tracking-wider leading-none mb-1">
                    Paikkatieto & Metadata Catalogue
                  </h2>
                  <p className="text-[9px] text-nc-text-muted font-bold uppercase tracking-wide">
                    Official Spatial Dataset Registry (Paikkatietohakemisto)
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowMetadataModal(false)}
                className="p-1.5 hover:bg-nc-text/10 rounded-full border border-nc-border transition-colors group cursor-pointer"
              >
                <X className="w-4 h-4 text-nc-text-muted group-hover:text-nc-neon-red transition-colors" />
              </button>
            </div>

            {/* Tab Bar */}
            <div className="flex border-b border-nc-border/30 px-6 shrink-0 bg-nc-text/5">
              {[
                { id: "siirrot", label: "Ajoneuvojen siirtokehotukset", desc: "Towing Warnings" },
                { id: "winkki", label: "Maanvuokraukset & Työt (WFS)", desc: "WFS Base Layers" }
              ].map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveMetaTab(tab.id)}
                  className={`py-3 px-4 border-b-2 text-left transition-all cursor-pointer flex flex-col justify-center ${
                    activeMetaTab === tab.id
                      ? "border-nc-neon-teal text-white bg-nc-neon-teal/5"
                      : "border-transparent text-nc-text-muted hover:text-white"
                  }`}
                >
                  <span className="text-xs font-black uppercase tracking-wider">{tab.label}</span>
                  <span className="text-[9px] text-nc-text-dim/80 font-bold uppercase tracking-widest">{tab.desc}</span>
                </button>
              ))}
            </div>

            {/* Modal Content */}
            <div className="flex-1 overflow-y-auto no-scrollbar p-6 space-y-6 text-sm leading-relaxed text-nc-text text-left">
              {activeMetaTab === "siirrot" ? (
                <div className="space-y-6">
                  {/* Headline Info */}
                  <div className="p-4 bg-nc-neon-teal/5 border border-nc-neon-teal/20 rounded-2xl space-y-2 text-left">
                    <div className="flex justify-between items-start flex-wrap gap-2">
                      <h3 className="text-sm font-black text-nc-neon-teal uppercase">
                        📋 Ajoneuvojen siirtokehotukset (Vehicle removal requests)
                      </h3>
                      <a 
                        href="https://paikkatietohakemisto.fi" 
                        target="_blank" 
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-[9px] font-black text-nc-neon-teal uppercase tracking-wider border border-nc-neon-teal/40 hover:border-nc-neon-teal px-2 py-0.5 rounded-lg hover:bg-nc-neon-teal/10 transition-all cursor-pointer"
                      >
                        Avaa Hakemistoon <ExternalLink className="w-3 h-3" />
                      </a>
                    </div>
                    <p className="text-xs text-nc-text-muted leading-relaxed">
                      Aineisto sisältää ajankohtaiset siirtokehotukset Helsingin alueella. Siirtokehotukset tulee tarkistaa liikennemerkeistä ja kadulla olevat merkit ovat velvoittavia.
                    </p>
                  </div>

                  {/* Metadata Table */}
                  <div className="border border-nc-border/40 rounded-2xl overflow-hidden shadow-md">
                    <table className="w-full text-left text-xs border-collapse">
                      <thead>
                        <tr className="bg-nc-text/5 border-b border-nc-border/40">
                          <th className="p-3 font-black uppercase text-nc-text-dim text-[10px] w-1/3">Metadatatieto (Field)</th>
                          <th className="p-3 font-black uppercase text-nc-text-dim text-[10px]">Aineiston tiedot (Registry Value)</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-nc-border/20">
                        {[
                          { field: "Nimi suomeksi", value: "Ajoneuvojen siirtokehotukset", highlight: true },
                          { field: "Nimi ruotsiksi", value: "Flyttningsuppmaningar för fordon" },
                          { field: "Nimi englanniksi", value: "Vehicle removal requests" },
                          { field: "Kuvaus", value: "Aineisto sisältää ajankohtaiset siirtokehotukset Helsingin alueella. Siirtokehotukset tulee tarkistaa liikennemerkeistä ja kadulla olevat merkit ovat velvoittavia." },
                          { field: "Käyttötarkoitus", value: "Ajoneuvojen siirrot, katualuevaraukset ja kunnossapitotyöt" },
                          { field: "Alueellinen kattavuus", value: "Helsingin alue" },
                          { field: "Koordinaatisto", value: "ETRS-GK25 (EPSG:3879)" },
                          { field: "Tallennusmuoto", value: "PostGIS-tietokanta" },
                          { field: "Ylläpitävä organisaatio", value: "Helsingin kaupunki, Kaupunkiympäristön toimiala, Palvelut ja luvat, Pysäköinninvalvonta ja pysäköintipalvelut" },
                          { field: "Ylläpitotiheys", value: "Aineistoa ylläpidetään ja päivitetään uusien siirtokehotusten osalta päivittäin" },
                          { field: "Tietolähde", value: "Pystytyspöytäkirjat (Mobilenote)" },
                          { field: "Tiedonkeruumenetelmä", value: "Mobiili- ja selainpohjainen sovellus siirtokehotusliikennemerkkien pystytyspöytäkirjojen dokumentointiin" },
                          { field: "Yhteyshenkilö 1", value: "Anne-Marie Kaksonen (Helsingin kaupunki, Kaupunkiympäristön toimiala, Palvelut ja luvat, Pysäköinninvalvonta ja pysäköintipalvelut)" },
                          { field: "Avainsanat", value: "Siirtokehotukset, ajoneuvojen siirrot, pystytyspöytäkirjat", badge: true },
                        ].map((row) => (
                          <tr key={row.field} className="hover:bg-nc-text/5 transition-colors">
                            <td className="p-3 font-bold text-nc-text-muted">{row.field}</td>
                            <td className="p-3 text-nc-text leading-relaxed">
                              {row.badge ? (
                                <div className="flex flex-wrap gap-1.5">
                                  {row.value.split(", ").map((kw) => (
                                    <span key={kw} className="px-2 py-0.5 bg-nc-neon-teal/10 border border-nc-neon-teal/20 text-nc-neon-teal text-[9px] uppercase font-bold rounded-lg tracking-wider">
                                      {kw}
                                    </span>
                                  ))}
                                </div>
                              ) : row.highlight ? (
                                <span className="font-extrabold text-nc-neon-teal">{row.value}</span>
                              ) : (
                                row.value
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : (
                <div className="space-y-6">
                  {/* WFS Intro */}
                  <div className="p-4 bg-orange-400/5 border border-orange-400/20 rounded-2xl space-y-2 text-left">
                    <h3 className="text-sm font-black text-orange-400 uppercase">
                      🔶 Maanvuokraukset & Katuvaraukset (Helsinki WFS Interface)
                    </h3>
                    <p className="text-xs text-nc-text-muted leading-relaxed">
                      Application processes real-time geographical datasets from the City of Helsinki's public WFS endpoints (avoindata.hel.fi) to map active temporary land leases, street construction works, and parking restrictions.
                    </p>
                  </div>

                  {/* WFS Layers */}
                  <div className="border border-nc-border/40 rounded-2xl overflow-hidden shadow-md">
                    <table className="w-full text-left text-xs border-collapse">
                      <thead>
                        <tr className="bg-nc-text/5 border-b border-nc-border/40">
                          <th className="p-3 font-black uppercase text-nc-text-dim text-[10px] w-1/3">WFS Layer Name</th>
                          <th className="p-3 font-black uppercase text-nc-text-dim text-[10px]">Dataset Purpose & Details</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-nc-border/20">
                        {[
                          { layer: "avoindata:Winkki_rents_audiences", desc: "Real-time active temporary land leases, outdoor terrace permits, container spaces, padel courts, and green yards." },
                          { layer: "avoindata:Winkki_works", desc: "Active street construction zones, pipe works, road maintenance, and temporary closures." },
                          { layer: "avoindata:Pysakointipaikat", desc: "Helsinki municipal public parking space geometries, zone divisions, and time rules." },
                          { layer: "avoindata:Pysakointivirheet", desc: "Historical municipal parking ticket density (165k mapped tickets) parsed to evaluate parking risk index." }
                        ].map((row) => (
                          <tr key={row.layer} className="hover:bg-nc-text/5 transition-colors">
                            <td className="p-3 font-mono font-bold text-nc-neon-teal">{row.layer}</td>
                            <td className="p-3 text-nc-text leading-relaxed">{row.desc}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
            
            {/* Modal Footer */}
            <div className="p-4 bg-nc-text/5 border-t border-nc-border/30 flex justify-between items-center shrink-0">
              <span className="text-[9px] text-nc-text-dim uppercase font-bold tracking-wider">
                Sivun ylläpito: Helsingin kaupunki / Paikkatietopalvelutiimi
              </span>
              <button
                type="button"
                onClick={() => setShowMetadataModal(false)}
                className="px-4 py-1.5 bg-nc-neon-teal/10 hover:bg-nc-neon-teal/20 border border-nc-neon-teal/40 hover:border-nc-neon-teal text-nc-neon-teal text-xs font-black uppercase tracking-wider rounded-xl transition-all cursor-pointer"
              >
                Sulje
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

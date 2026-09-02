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
  Database,
} from "lucide-react";
import { useParkingLayers } from "./hooks/useParkingLayers";
import {
  THEME_CONFIGS,
  CATEGORIES,
  getCentroid,
  type ThemeType,
} from "./lib/mapThemes";
import { MetadataCatalogueModal } from "./components/MetadataCatalogueModal";
import { ReservationsDrawer } from "./components/ReservationsDrawer";
import { ParkingPopup, type HoverInfo } from "./components/ParkingPopup";

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

const INITIAL_VIEW_STATE = {
  longitude: 24.941,
  latitude: 60.169,
  zoom: 13,
  pitch: 45,
};

export default function App() {
  const {
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
  } = useParkingLayers();

  const [hoverInfo, setHoverInfo] = useState<HoverInfo | null>(null);
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

  useEffect(() => {
    if (typeof window !== "undefined") {
      window.__APP_BUILD_INFO__ = {
        version: typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "1.0.0",
        commit: typeof __COMMIT_HASH__ !== "undefined" ? __COMMIT_HASH__ : "dev",
        buildTime: typeof __BUILD_TIME__ !== "undefined" ? __BUILD_TIME__ : new Date().toISOString()
      };
    }
  }, []);

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
        if (!response.ok) throw new Error(`Servicemap HTTP ${response.status}`);
        const data = await response.json();
        setSearchResults(data.results || []);
      } catch (err) {
        console.error("Search failed:", err);
      }
    }, 300);

    return () => clearTimeout(delayDebounceFn);
  }, [searchQuery]);

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
            <ParkingPopup
              hoverInfo={hoverInfo}
              selectedAddress={selectedAddress}
              distance={distance}
              walkTime={walkTime}
            />
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
        {/* Toggle Expand / Collapse Buttons & Version Badge */}
        <div className="flex items-center justify-between w-full pointer-events-auto pr-2 gap-2 flex-wrap">
          <div
            data-testid="app-version-badge"
            className="nv-glass rounded-full px-3 py-1 text-[10px] font-mono text-nc-text-muted flex items-center gap-1.5 shadow-lg pointer-events-auto border border-nc-border/40"
          >
            <span className="font-bold text-nc-neon-teal">ParkkiS</span>
            <span>•</span>
            <span>v{typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "1.0.0"}</span>
            <span>(git:{typeof __COMMIT_HASH__ !== "undefined" ? __COMMIT_HASH__ : "dev"})</span>
          </div>

          <div className="flex items-center gap-2">
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

      {/* Dynamic Reservations List Panel */}
      <ReservationsDrawer
        isOpen={showResList}
        onClose={() => setShowResList(false)}
        reservations={getFilteredReservations()}
        searchQuery={resSearchQuery}
        onSearchChange={setResSearchQuery}
        category={resCategory}
        onCategoryChange={setResCategory}
        sortBy={resSortBy}
        onSortByChange={setResSortBy}
        onSelectReservation={handleReservationClick}
        liveRentMap={liveRentMap}
        loadingRentMap={loadingRentMap}
        onFetchLiveRent={handleFetchLiveRent}
      />

      {/* Dynamic Metadata Catalogue Modal */}
      <MetadataCatalogueModal
        isOpen={showMetadataModal}
        onClose={() => setShowMetadataModal(false)}
      />
    </div>
  );
}

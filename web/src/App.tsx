import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  MapLayerMouseEvent,
  MapRef,
} from "react-map-gl/maplibre";
import "maplibre-gl/dist/maplibre-gl.css";
import type * as maplibregl from "maplibre-gl";
import { ParkingMapView, type Address } from "./components/ParkingMapView";
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
import { useRegionalParking } from "./hooks/useRegionalParking";
import { coverageNoteText, venueCoverage } from "./lib/coverage";
import { usePlough } from "./hooks/usePlough";
import { useCityLayers } from "./hooks/useCityLayers";
import { CityLayerToggles, VenueInfo } from "./components/CityPanel";
import { busyDay, helsinkiDate, matchDateFrom, matchTarget, pickForecast, zonesAt, type CityLayerId } from "./lib/cityLayers";
import { AGE_COLORS, AGE_LABELS, EMPTY_TEXT, HEL_PRIORITY_LABEL, ERROR_TEXT, STATE_ROADS_NOTE, bboxAround, venueBanner, type Bbox } from "./lib/plough";
import {
  CATEGORIES,
  getCentroid,
  type ThemeType,
} from "./lib/mapThemes";
import { MetadataCatalogueModal } from "./components/MetadataCatalogueModal";
import { ReservationsDrawer } from "./components/ReservationsDrawer";
import type { HoverInfo } from "./components/ParkingPopup";



interface SearchResult {
  id?: number;
  name: { fi: string; sv: string };
  municipality?: { name?: { fi?: string; sv?: string } };
  location: {
    coordinates: [number, number];
  };
}

/** Finland, generously. Anything outside is a broken link, not a venue. */
const FINLAND_BOUNDS = { minLat: 59.3, maxLat: 70.2, minLon: 19.0, maxLon: 31.7 };
/** No mapped Helsinki parking space this close to the venue → say so. */
const COVERAGE_RADIUS_M = 600;
/** Must match interactiveLayerIds in ParkingMapView. */
const TAP_LAYERS = ["city-events-fill", "city-leases-fill", "city-leases-points", "city-coach-points", "city-cycling-lines", "city-access-lines", "city-zones-fill", "parking-lines", "hubi-lines", "sign-points", "roadwork-fill", "reservation-fill", "liipi-points", "espoo-points", "osm-points", "plough-lines", "hel-winter-lines"];

/**
 * Reads Pelipäivä's deep link: /venue/<encoded name>?lat=..&lon=..&embed=true&theme=night-captain
 * (also accepts ?lng= and ?venue=<name>).
 */
function readVenueFromUrl(): Address | null {
  try {
    const params = new URLSearchParams(window.location.search);
    const lat = Number.parseFloat(params.get("lat") ?? "");
    const lon = Number.parseFloat(params.get("lon") ?? params.get("lng") ?? "");
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    if (
      lat < FINLAND_BOUNDS.minLat || lat > FINLAND_BOUNDS.maxLat ||
      lon < FINLAND_BOUNDS.minLon || lon > FINLAND_BOUNDS.maxLon
    ) {
      console.warn("Parkkis: venue coordinates outside Finland, ignored", lat, lon);
      return null;
    }
    const match = window.location.pathname.match(/^\/venue\/(.+?)\/?$/);
    let name = "";
    if (match) {
      try {
        name = decodeURIComponent(match[1].replace(/\+/g, " "));
      } catch {
        name = match[1];
      }
    }
    if (!name) name = params.get("venue") ?? "";
    return { latitude: lat, longitude: lon, name: name.trim() || "Kohde" };
  } catch (err) {
    console.warn("URL params parsing error in Parkkis:", err);
    return null;
  }
}

function readThemeFromUrl(): ThemeType {
  const t = new URLSearchParams(window.location.search).get("theme");
  if (t === "light" || t === "forest") return t;
  return "dark"; // "dark" and Pelipäivä's "night-captain" are the same theme
}

function metersBetween(
  a: { longitude: number; latitude: number },
  b: { longitude: number; latitude: number },
) {
  const rad = Math.PI / 180;
  const dLat = (b.latitude - a.latitude) * rad;
  const dLon = (b.longitude - a.longitude) * rad;
  const lat1 = a.latitude * rad;
  const lat2 = b.latitude * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.min(1, Math.sqrt(h)));
}

const INITIAL_VIEW_STATE = {
  longitude: 24.941,
  latitude: 60.169,
  zoom: 13,
  pitch: 45,
};

export default function App() {
  const [venueFromLink] = useState<Address | null>(() => readVenueFromUrl());
  const {
    venueTiles,
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
  } = useParkingLayers(venueFromLink);

  const [hoverInfo, setHoverInfo] = useState<HoverInfo | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [selectedAddress, setSelectedAddress] = useState<Address | null>(venueFromLink);
  const [theme, setTheme] = useState<ThemeType>(() => readThemeFromUrl());
  const [isFooterCollapsed, setIsFooterCollapsed] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(max-width: 700px)").matches
  );
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
    if (searchQuery.length < 3) return;

    const delayDebounceFn = setTimeout(async () => {
      try {
        const response = await fetch(
          `https://api.hel.fi/servicemap/v2/search/?type=address&page_size=5&q=${encodeURIComponent(searchQuery)}&language=fi`,
        );
        if (!response.ok) throw new Error(`Servicemap HTTP ${response.status}`);
        const data = await response.json();
        setSearchResults(Array.isArray(data.results) ? data.results : []);
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
    let features = event.features;
    // A finger is not a mouse pointer: on a tap, look ±14 px around the touch point.
    if (event.type === "click" && !features?.length && mapRef.current) {
      const { x, y } = event.point;
      const map = mapRef.current.getMap();
      const layers = TAP_LAYERS.filter((id) => map.getLayer(id));
      features = map.queryRenderedFeatures(
        [
          [x - 14, y - 14],
          [x + 14, y + 14],
        ],
        { layers },
      ) as typeof event.features;
    }
    const hoveredFeature = features?.[0];

    if (hoveredFeature) {
      // Aggregate all signs at this location
      const signs = (features ?? [])
        .filter((f) => f.layer.id === "sign-points")
        .map((f) => f.properties);

      // Find if we have roadwork in the stack
      const roadwork = (features ?? []).find(
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

  // Keep the venue pin in the part of the map the overlays do not cover.
  const userMovedMap = useRef(false);
  const visiblePadding = useCallback(() => {
    const top = document.querySelector("[data-testid=top-hud]")?.getBoundingClientRect().bottom ?? 0;
    const bottomEl = document.querySelector("[data-testid=bottom-hud]")?.getBoundingClientRect();
    const h = window.innerHeight;
    const bottom = bottomEl ? Math.max(0, h - bottomEl.top) : 0;
    // Never squeeze the visible map below a third of the screen.
    const room = h - top - bottom;
    return room < h / 3 ? { top: h / 3, bottom: 0, left: 0, right: 0 } : { top, bottom, left: 0, right: 0 };
  }, []);
  const centerVenue = useCallback(
    (duration: number) => {
      if (!venueFromLink || !mapRef.current || userMovedMap.current) return;
      mapRef.current.flyTo({
        center: [venueFromLink.longitude, venueFromLink.latitude],
        zoom: 16,
        pitch: 50,
        padding: visiblePadding(),
        duration,
      });
    },
    [venueFromLink, visiblePadding],
  );

  const onMapLoad = useCallback(() => {
    performance.mark("parkkis:map-load");
    if (venueFromLink && mapRef.current) {
      mapRef.current.getMap().on("dragstart", () => {
        userMovedMap.current = true;
      });
      centerVenue(1500);
      return;
    }
    if (geoControlRef.current) {
      geoControlRef.current.trigger();
    }
  }, [venueFromLink, centerVenue]);


  const calculateDistance = () => {
    if (!selectedAddress || !hoverInfo) return null;
    return metersBetween(selectedAddress, hoverInfo).toFixed(0);
  };


  const distance = calculateDistance();

  // Espoo parking areas and OSM parking load after the Helsinki layers.
  const { espooData, osmData, regionalStatus } = useRegionalParking(dbReady);

  // Until the full Espoo/OSM snapshot is in, the venue tiles hold the same rows nearby.
  // Winter maintenance (Digitraffic): fetched only when the toggle is on or a venue's fast path is done.
  const [showPlough, setShowPlough] = useState(false);
  const { ploughData, ploughStatus, ploughFailed, loadPlough, helPriority, helStatus, loadHel } = usePlough();
  const ploughBbox = useCallback((): Bbox => {
    const b = mapRef.current?.getBounds();
    const v = venueFromLink ? bboxAround(venueFromLink.latitude, venueFromLink.longitude, 2500) : null;
    // Keep requests to the capital region so a zoomed-out map does not pull all of Finland.
    let box: Bbox = b
      ? { minLon: Math.max(b.getWest(), 24.3), minLat: Math.max(b.getSouth(), 60.0), maxLon: Math.min(b.getEast(), 25.5), maxLat: Math.min(b.getNorth(), 60.5) }
      : (v ?? { minLon: 24.45, minLat: 60.08, maxLon: 25.3, maxLat: 60.42 });
    if (box.minLon >= box.maxLon || box.minLat >= box.maxLat) box = v ?? { minLon: 24.45, minLat: 60.08, maxLon: 25.3, maxLat: 60.42 };
    if (v) box = { minLon: Math.min(box.minLon, v.minLon), minLat: Math.min(box.minLat, v.minLat), maxLon: Math.max(box.maxLon, v.maxLon), maxLat: Math.max(box.maxLat, v.maxLat) };
    return box;
  }, [venueFromLink]);
  const venueFastDone = !!venueTiles || dbReady;
  useEffect(() => {
    if (venueFromLink && venueFastDone && ploughStatus === "idle") {
      const t = setTimeout(() => loadPlough(ploughBbox()), 500);
      return () => clearTimeout(t);
    }
  }, [venueFromLink, venueFastDone, ploughStatus, loadPlough, ploughBbox]);
  const togglePlough = useCallback(() => {
    if (!showPlough) {
      loadPlough(ploughBbox());
      loadHel();
    }
    setShowPlough(!showPlough);
  }, [showPlough, loadPlough, ploughBbox, loadHel]);
  const ploughBanner = useMemo(
    () => (venueFromLink && ploughData ? venueBanner(ploughData, venueFromLink.latitude, venueFromLink.longitude) : null),
    [venueFromLink, ploughData],
  );

  // Optional city layers + venue info (events, zones, contractor, FMI forecast). All lazy.
  const match = useMemo(() => matchDateFrom(window.location.search, new Date()), []);
  const matchAt = useMemo(() => matchTarget(window.location.search, new Date()), []);
  const { layers: cityLayers, load: loadCity, contractors, loadContractors, forecast, loadForecast } = useCityLayers(match.date);
  const [cityShown, setCityShown] = useState<Set<CityLayerId>>(new Set());
  const [showCityPanel, setShowCityPanel] = useState(false);
  const toggleCity = useCallback((id: CityLayerId) => {
    setCityShown((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else { next.add(id); loadCity(id, ploughBbox()); }
      return next;
    });
  }, [loadCity, ploughBbox]);
  const venueInHelsinki = !!venueFromLink && venueFromLink.longitude > 24.78 && venueFromLink.longitude < 25.27 && venueFromLink.latitude > 60.10 && venueFromLink.latitude < 60.30;
  useEffect(() => {
    if (!venueFromLink || !venueFastDone) return;
    const t = setTimeout(() => {
      loadForecast(venueFromLink.latitude, venueFromLink.longitude);
      if (venueInHelsinki) {
        loadCity("events", ploughBbox());
        loadCity("zones", ploughBbox());
        loadContractors(venueFromLink.latitude, venueFromLink.longitude, helsinkiDate(new Date()));
      }
    }, 800);
    return () => clearTimeout(t);
  }, [venueFromLink, venueFastDone, venueInHelsinki, loadForecast, loadCity, loadContractors, ploughBbox]);
  const busy = useMemo(
    () => (venueFromLink ? busyDay(cityLayers.events.data, venueFromLink.latitude, venueFromLink.longitude) : []),
    [venueFromLink, cityLayers.events.data],
  );
  const venueZones = useMemo(
    () => (venueFromLink ? zonesAt(cityLayers.zones.data, venueFromLink.latitude, venueFromLink.longitude) : []),
    [venueFromLink, cityLayers.zones.data],
  );
  const matchForecast = useMemo(() => pickForecast(forecast.hours, matchAt.at), [forecast.hours, matchAt]);

  const espooShown = espooData ?? venueTiles?.espoo ?? null;
  const osmShown = osmData ?? venueTiles?.osm ?? null;

  // Which real data covers the deep-linked venue? (null = still loading)
  const coverage = useMemo(() => {
    if (!venueFromLink || !riskData) return null;
    if (regionalStatus === "loading" && !venueTiles) return null;
    return venueCoverage(venueFromLink, COVERAGE_RADIUS_M, {
      helsinki: riskData,
      espoo: espooShown,
      osm: osmShown,
    }, regionalStatus === "error" && !venueTiles);
  }, [venueFromLink, riskData, espooShown, osmShown, regionalStatus, venueTiles]);
  const venueOutsideData = coverage !== null && !coverage.helsinki;

  // The coverage note changes the overlay height; re-center once it appears.
  useEffect(() => {
    if (coverage) requestAnimationFrame(() => centerVenue(600));
  }, [coverage, centerVenue]);

  const visibleSearchResults = searchQuery.length >= 3 ? searchResults : [];

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
        
        if (resSortBy === "id") {
          return String(propsA.licence_identifier || "").localeCompare(String(propsB.licence_identifier || ""));
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
            { id: "dark", label: "Yöteema", icon: Moon, activeColor: "text-nc-neon-teal" },
            { id: "light", label: "Päiväteema", icon: Sun, activeColor: "text-nc-gold" },
            { id: "forest", label: "Metsäteema", icon: TreePine, activeColor: "text-emerald-400" },
          ].map((themeOpt) => {
            const Icon = themeOpt.icon;
            const isActive = theme === themeOpt.id;
            return (
              <button
                type="button"
                key={themeOpt.id}
                onClick={() => setTheme(themeOpt.id as ThemeType)}
                className={`p-2 min-w-[44px] min-h-[44px] rounded-full transition-all duration-300 flex items-center justify-center relative group ${
                  isActive
                    ? "bg-nc-text/15 shadow-inner scale-110"
                    : "hover:bg-nc-text/5 text-nc-text-dim hover:text-nc-text"
                }`}
                title={themeOpt.label}
                aria-label={themeOpt.label}
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
      <div data-testid="top-hud" className="nv-hud top-0 left-0 w-full flex flex-col gap-4 pointer-events-none">
        <div className="flex flex-col gap-2 w-full pr-16 sm:pr-0 sm:flex-row sm:justify-between sm:items-start">
          <div className="flex flex-col gap-4 w-full max-w-md pointer-events-auto">
            {/* Search Bar */}
            <div className="nv-glass rounded-3xl p-1 flex items-center shadow-2xl border border-nc-border">
              <div className="pl-4 pr-2">
                <Search className="w-5 h-5 text-nc-neon-teal" />
              </div>
              <input
                type="text"
                placeholder="Hae osoite, esim. Mannerheimintie 1"
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
            {visibleSearchResults.length > 0 && (
              <div className="nv-glass rounded-2xl overflow-hidden border border-nc-border shadow-2xl animate-in fade-in slide-in-from-top-4 duration-300">
                {visibleSearchResults.map((result: SearchResult) => (
                  <button
                    type="button"
                    key={`${result.name.fi}-${result.location.coordinates.join(",")}`}
                    onClick={() => onSelectAddress(result)}
                    className="w-full text-left px-4 py-3 hover:bg-nc-neon-teal/10 transition-colors border-b border-nc-border/40 last:border-0 group flex items-center gap-3"
                  >
                    <Navigation className="w-4 h-4 text-nc-text-dim group-hover:text-nc-neon-teal transition-colors" />
                    <div>
                      <div className="text-sm font-bold text-nc-text">
                        {result.name.fi || result.name.sv}
                      </div>
                      <div className="text-[10px] text-nc-text-dim uppercase tracking-wider">
                        {result.municipality?.name?.fi || result.municipality?.name?.sv || ""}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {venueFromLink && venueOutsideData && (
            <div
              data-testid="venue-coverage-note"
              className="nv-glass rounded-3xl px-5 py-3 text-nv-text-xs text-nc-text max-w-md pointer-events-auto border border-nc-gold/40"
            >
              <b className="text-nc-gold">{venueFromLink.name}:</b> {coverageNoteText(coverage)}
            </div>
          )}

          {
            <div
              data-testid="plough-panel"
              className="nv-glass rounded-3xl px-4 py-2 text-nv-text-xs text-nc-text max-w-md pointer-events-auto border border-sky-400/40 flex flex-col gap-1"
            >
              <div className="flex items-center gap-2 flex-wrap">
                <button
                  type="button"
                  data-testid="plough-toggle"
                  aria-pressed={showPlough}
                  onClick={togglePlough}
                  className={`min-h-[44px] px-4 rounded-2xl font-bold border ${showPlough ? "border-sky-400 text-sky-300 bg-sky-400/15" : "border-nc-border text-nc-text-dim"}`}
                >
                  ❄️ {showPlough ? "Piilota auraus" : "Aurattu / hiekoitettu viime tunteina"}
                </button>
                {showPlough && ploughStatus === "ready" && (
                  <span className="flex items-center gap-2 text-[10px]">
                    {(Object.keys(AGE_LABELS) as (keyof typeof AGE_LABELS)[]).map((k) => (
                      <span key={k} className="flex items-center gap-1">
                        <span className="inline-block w-4 h-1.5 rounded" style={{ background: AGE_COLORS[k] }} />
                        {AGE_LABELS[k]}
                      </span>
                    ))}
                  </span>
                )}
              </div>
              {(venueFromLink || showPlough) && (<>
              <div data-testid="plough-status" role="status">
                {ploughFailed.length === 1 && ploughStatus !== "loading" && (
                  <span className="block text-nc-danger">
                    {ploughFailed[0] === "espoo" ? "Espoon katutietojen lataus epäonnistui." : "Valtion teiden tietojen lataus epäonnistui."}{" "}
                  </span>
                )}
                {ploughStatus === "loading" && "Ladataan auraustietoja…"}
                {ploughStatus === "error" && <span className="text-nc-danger font-bold">{ERROR_TEXT}. Yritä myöhemmin uudelleen.</span>}
                {ploughStatus === "empty" && EMPTY_TEXT}
                {ploughStatus === "ready" &&
                  (ploughBanner ? (
                    <b data-testid="plough-banner" className="text-sky-300">{ploughBanner.text}</b>
                  ) : venueFromLink ? (
                    "Ei auraus-, hiekoitus- tai harjausajoja 2 km säteellä viime tunteina."
                  ) : (
                    `${ploughData?.features.length ?? 0} kunnossapitoajoa näkyvällä alueella (valtion tiet 12 h, Espoon kadut 48 h).`
                  ))}
              </div>
              </>)}
              {showPlough && (
                <div data-testid="hel-priority-status" className="text-[10px] flex items-center gap-1">
                  <span className="inline-block w-4 border-t-2 border-dashed border-emerald-300" />
                  Helsinki: {HEL_PRIORITY_LABEL}
                  {helStatus === "loading" ? " – ladataan…" : helStatus === "error" ? " – lataus epäonnistui" : helStatus === "ready" ? ` – ${helPriority?.features.length ?? 0} reittiä` : ""}
                </div>
              )}
              <div className="text-[10px] text-nc-text-dim">{STATE_ROADS_NOTE}</div>
            </div>
          }
          <div
            data-testid="city-panel"
            className="nv-glass rounded-3xl px-4 py-2 text-nv-text-xs text-nc-text max-w-md pointer-events-auto border border-pink-400/30 flex flex-col gap-1"
          >
            <button
              type="button"
              data-testid="city-panel-toggle"
              aria-expanded={showCityPanel}
              onClick={() => setShowCityPanel((v) => !v)}
              className="min-h-[44px] px-4 rounded-2xl font-bold border border-nc-border text-left"
            >
              🗺️ {showCityPanel ? "Piilota lisätiedot" : venueFromLink ? "Kohteen lisätiedot ja karttatasot" : "Lisää karttatasoja"}
              {venueFromLink && busy.length > 0 && !showCityPanel && <span className="text-pink-300"> · ⚠️ vilkas päivä</span>}
            </button>
            {showCityPanel && venueFromLink && (
              <VenueInfo
                name={venueFromLink.name}
                date={match.date}
                dateFromLink={match.fromLink}
                inHelsinki={venueInHelsinki}
                events={busy}
                eventsStatus={cityLayers.events.status}
                zones={venueZones}
                zonesStatus={cityLayers.zones.status}
                contractors={contractors.list}
                contractorStatus={contractors.status}
                forecast={matchForecast}
                forecastStatus={forecast.status}
                forecastFor={matchAt.label}
              />
            )}
            {showCityPanel && (
              <CityLayerToggles layers={cityLayers} shown={cityShown} onToggle={toggleCity} date={match.date} dateFromLink={match.fromLink} />
            )}
          </div>
          {!dbReady && (
            <div
              data-testid="loading-status"
              className={`nv-glass rounded-3xl px-6 py-3 flex items-center gap-3 ${loadFailed ? "border border-nc-danger/50" : "animate-pulse"}`}
            >
              <div className={`w-2 h-2 rounded-full ${loadFailed ? "bg-nc-danger" : "bg-nc-neon-teal shadow-[0_0_10px_#00f2ff]"}`} />
              <span className="text-nv-text-sm font-medium text-nc-text">
                {venueTiles && !loadFailed ? "Lähialueen pysäköinti näkyy. Ladataan koko kaupungin aineistoa..." : loadingMsg}
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
                  className={`px-4 py-2 min-h-[44px] rounded-2xl text-nv-text-xs font-bold transition-all whitespace-nowrap ${
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
                className={`nv-glass rounded-3xl min-h-[44px] px-6 py-2 text-nv-text-xs font-bold transition-all pointer-events-auto flex items-center gap-2 border ${
                  showNewTraps
                    ? "border-nc-neon-teal text-nc-neon-teal bg-nc-neon-teal/10 shadow-[0_0_15px_rgba(0,242,255,0.2)]"
                    : "border-nc-border text-nc-text-dim hover:bg-nc-text/5"
                }`}
              >
                <div
                  className={`w-2 h-2 rounded-full ${showNewTraps ? "bg-nc-neon-teal animate-pulse" : "bg-nc-text/20"}`}
                />
                UUDET MERKIT
              </button>

              <button
                type="button"
                onClick={() => setShowViolations(!showViolations)}
                className={`nv-glass rounded-3xl min-h-[44px] px-6 py-2 text-nv-text-xs font-bold transition-all pointer-events-auto flex items-center gap-2 border ${
                  showViolations
                    ? "border-nc-danger text-nc-danger bg-nc-danger/10 shadow-[0_0_15px_rgba(239,68,68,0.2)]"
                    : "border-nc-border text-nc-text-dim hover:bg-nc-text/5"
                }`}
              >
                <div
                  className={`w-2 h-2 rounded-full ${showViolations ? "bg-nc-danger animate-pulse" : "bg-nc-text/20"}`}
                />
                SAKOT 2023
              </button>

              <button
                type="button"
                onClick={() => setShowSigns(!showSigns)}
                className={`nv-glass rounded-3xl min-h-[44px] px-6 py-2 text-nv-text-xs font-bold transition-all pointer-events-auto flex items-center gap-2 border ${
                  showSigns
                    ? "border-nc-text text-nc-text bg-nc-text/10 shadow-[0_0_15px_rgba(255,255,255,0.1)]"
                    : "border-nc-border text-nc-text-dim hover:bg-nc-text/5"
                }`}
              >
                <div
                  className={`w-2 h-2 rounded-full ${showSigns ? "bg-nc-text animate-pulse" : "bg-nc-text/20"}`}
                />
                LIIKENNEMERKIT
              </button>

              <button
                type="button"
                onClick={() => setShowRoadworks(!showRoadworks)}
                className={`nv-glass rounded-3xl min-h-[44px] px-6 py-2 text-nv-text-xs font-bold transition-all pointer-events-auto flex items-center gap-2 border ${
                  showRoadworks
                    ? "border-nc-gold text-nc-gold bg-nc-gold/10 shadow-[0_0_15px_rgba(255,207,75,0.2)]"
                    : "border-nc-border text-nc-text-dim hover:bg-nc-text/5"
                }`}
              >
                <div
                  className={`w-2 h-2 rounded-full ${showRoadworks ? "bg-nc-gold animate-pulse" : "bg-nc-text/20"}`}
                />
                TYÖMAAT{roadworkStatus === "loading" ? " …" : roadworkStatus === "error" ? " (ei saatu)" : roadworkData ? ` (${roadworkData.features.length})` : ""}
              </button>

              <button
                type="button"
                onClick={() => setShowReservations(!showReservations)}
                className={`nv-glass rounded-3xl min-h-[44px] px-6 py-2 text-nv-text-xs font-bold transition-all pointer-events-auto flex items-center gap-2 border ${
                  showReservations
                    ? "border-orange-400 text-orange-400 bg-orange-400/10 shadow-[0_0_15px_rgba(251,146,60,0.2)]"
                    : "border-nc-border text-nc-text-dim hover:bg-nc-text/5"
                }`}
              >
                <div
                  className={`w-2 h-2 rounded-full ${showReservations ? "bg-orange-400 animate-pulse" : "bg-nc-text/20"}`}
                />
                VUOKRA-ALUEET{reservationStatus === "loading" ? " …" : reservationStatus === "error" ? " (ei saatu)" : ""}
              </button>

              <button
                type="button"
                onClick={() => setShowResList(!showResList)}
                className={`nv-glass rounded-3xl min-h-[44px] px-6 py-2 text-nv-text-xs font-bold transition-all pointer-events-auto flex items-center gap-2 border ${
                  showResList
                    ? "border-orange-400 text-orange-400 bg-orange-400/20 shadow-[0_0_15px_rgba(251,146,60,0.3)] font-black"
                    : "border-nc-border text-nc-text-dim hover:bg-nc-text/5"
                }`}
              >
                <div
                  className={`w-2 h-2 rounded-full ${showResList ? "bg-orange-400 animate-pulse" : "bg-nc-text/20"}`}
                />
                📋 LISTA
              </button>
            </div>
          </div>
        )}
      </div>
      <ParkingMapView
        mapRef={mapRef}
        geoControlRef={geoControlRef}
        initialViewState={INITIAL_VIEW_STATE}
        theme={theme}
        onMouseMove={onMouseMove}
        onMouseLeave={() => setHoverInfo(null)}
        onMapLoad={onMapLoad}
        hoverInfo={hoverInfo}
        distance={distance}
        selectedAddress={selectedAddress}
        riskData={riskData}
        violationData={violationData}
        signData={signData}
        roadworkData={roadworkData}
        reservationData={reservationData}
        liipiData={liipiData}
        hubiData={hubiData}
        espooData={espooShown}
        osmData={osmShown}
        showViolations={showViolations}
        showSigns={showSigns}
        showNewTraps={showNewTraps}
        showRoadworks={showRoadworks}
        showReservations={showReservations}
        activeFilter={activeFilter}
        pulseOpacity={pulseOpacity}
        ploughData={ploughData}
        helPriority={helPriority}
        cityLayers={cityLayers}
        cityShown={cityShown}
        showPlough={showPlough}
      />

      {/* Bento Stats Footer */}
      <div data-testid="bottom-hud" className="absolute bottom-6 left-1/2 -translate-x-1/2 w-full max-w-4xl px-6 flex flex-col gap-2 pointer-events-none transition-all duration-300">
        {/* Toggle Expand / Collapse Buttons & Version Badge */}
        <div className="flex items-center justify-between w-full pointer-events-auto pr-2 gap-2 flex-wrap">
          <div
            data-testid="app-version-badge"
            className="nv-glass rounded-full px-3 py-1 text-[10px] font-mono text-nc-text-muted flex items-center gap-1.5 shadow-lg pointer-events-auto border border-nc-border/40"
          >
            <span className="font-bold text-nc-neon-teal">ParkkiS</span>
            <span>•</span>
            <span>v{typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "1.0.0"}</span>
            <span className="hidden sm:inline">(git:{typeof __COMMIT_HASH__ !== "undefined" ? __COMMIT_HASH__ : "dev"})</span>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowMetadataModal(true)}
              className="nv-glass rounded-full min-h-[44px] px-4 py-1.5 text-[11px] font-bold text-nc-text hover:bg-nc-text/10 flex items-center gap-1.5 shadow-lg pointer-events-auto cursor-pointer"
            >
              <Database className="w-3.5 h-3.5 text-nc-neon-teal" />
              <span>Tietolähteet</span>
            </button>
          
          <button
            type="button"
            onClick={() => setIsFooterCollapsed(!isFooterCollapsed)}
            className="nv-glass rounded-full min-h-[44px] px-4 py-1.5 text-[11px] font-bold text-nc-text hover:bg-nc-text/10 flex items-center gap-1.5 shadow-lg pointer-events-auto cursor-pointer"
          >
            {isFooterCollapsed ? (
              <>
                <Info className="w-3.5 h-3.5 text-nc-neon-teal" />
                <span>Näytä ohje</span>
              </>
            ) : (
              <>
                <X className="w-3.5 h-3.5 text-nc-neon-red" />
                <span>Piilota ohje</span>
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
                  Käyttö
                </span>
              </div>
              <p className="text-[14px] font-bold text-nc-text">Napauta paikkaa</p>
              <p className="text-nv-text-xs text-nc-text-muted mt-1 leading-normal">
                Napauta parkkiviivaa tai merkkiä. Katso aina myös kadun kyltti.
              </p>
            </div>

            <div className="nv-bento-card pointer-events-auto">
              <div className="flex items-center gap-3 mb-2">
                <Shield className="w-4 h-4 text-nc-gold" />
                <span className="text-nv-text-xs font-black text-nc-text-dim uppercase tracking-wider">
                  Sakot kartalla
                </span>
              </div>
              <p className="text-[14px] font-bold text-nc-text" data-testid="fine-count">
                {dataFacts
                  ? `${dataFacts.fineCount.toLocaleString("fi-FI")} sakkoa${dataFacts.fineYears ? ` (${dataFacts.fineYears})` : ""}`
                  : "Ladataan…"}
              </p>
              <p className="text-nv-text-xs text-nc-text-muted mt-1 leading-normal">
                Helsingin kaupungin avoin sakkoaineisto. Kartta näyttää, missä sakkoja on annettu paljon.
              </p>
            </div>

            <div className="nv-bento-card pointer-events-auto border-nc-neon-teal/20">
              <div className="flex items-center gap-3 mb-2">
                <Sliders className="w-4 h-4 text-nc-neon-teal" />
                <span className="text-nv-text-xs font-black text-nc-text-dim uppercase tracking-wider">
                  Muista
                </span>
              </div>
              <p className="text-[14px] font-bold text-nc-text">Kyltti voittaa kartan</p>
              <p className="text-nv-text-xs text-nc-text-muted mt-1 leading-normal">
                Työmaa ja kyltit muuttuvat. Varmista paikka kadun merkistä.
                {dataFacts?.slotsUpdated ? ` Pysäköintipaikat päivitetty ${new Date(dataFacts.slotsUpdated).toLocaleDateString("fi-FI")}.` : ""}
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
        status={reservationStatus}
      />

      {/* Dynamic Metadata Catalogue Modal */}
      <MetadataCatalogueModal
        isOpen={showMetadataModal}
        onClose={() => setShowMetadataModal(false)}
        dataFacts={dataFacts}
      />
    </div>
  );
}

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  MapLayerMouseEvent,
  MapRef,
} from "react-map-gl/maplibre";
import "maplibre-gl/dist/maplibre-gl.css";
import type * as maplibregl from "maplibre-gl";
import { ParkingMapView, type Address } from "./components/ParkingMapView";
import { ChevronDown, ChevronUp, Database, Layers, Moon, Navigation, Search, Sun, X } from "lucide-react";
import { useParkingLayers } from "./hooks/useParkingLayers";
import { useRegionalParking } from "./hooks/useRegionalParking";
import { coverageNoteText, venueCoverage } from "./lib/coverage";
import { usePlough } from "./hooks/usePlough";
import { useCityLayers } from "./hooks/useCityLayers";
import { VenueInfo } from "./components/CityPanel";
import { LayerSheet } from "./components/LayerSheet";
import { pickBanner, ploughOnByDefault, showOsmFor, type Banner } from "./lib/banner";
import { busyDay, helsinkiDate, matchDateFrom, matchTarget, pickForecast, zonesAt, type CityLayerId } from "./lib/cityLayers";
import { EMPTY_TEXT, ERROR_TEXT, bboxAround, venueBanner, type Bbox } from "./lib/plough";
import { THEME_CONFIGS, getCentroid, type ThemeType } from "./lib/mapThemes";
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
const TAP_LAYERS = ["city-events-fill", "city-leases-fill", "city-leases-points", "city-coach-points", "city-cycling-lines", "city-access-lines", "city-zones-fill", "violation-cells", "parking-lines", "hubi-lines", "sign-points", "roadwork-fill", "reservation-fill", "liipi-points", "espoo-points", "osm-points", "plough-lines", "hel-winter-lines"];

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
  pitch: 0,
};

const BANNER_STYLE: Record<Banner["tone"], string> = {
  danger: "border-nc-danger/60 bg-nc-danger/10",
  warn: "border-nc-gold/60 bg-nc-gold/10",
  info: "border-sky-400/60 bg-sky-400/10",
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
  const [showDetails, setShowDetails] = useState(false);
  const [showLayers, setShowLayers] = useState(false);
  const [showLiipi, setShowLiipi] = useState(false);
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
        pitch: 0,
        duration: 2000,
      });
    }
  };

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
    // Centre the venue in the uncovered strip; keep at least 160 px of map for the pin.
    return { top, bottom: Math.max(0, Math.min(bottom, h - top - 160)), left: 0, right: 0 };
  }, []);
  const centerVenue = useCallback(
    (duration: number) => {
      if (!venueFromLink || !mapRef.current || userMovedMap.current) return;
      mapRef.current.flyTo({
        center: [venueFromLink.longitude, venueFromLink.latitude],
        zoom: 16,
        pitch: 0,
        padding: visiblePadding(),
        duration,
      });
    },
    [venueFromLink, visiblePadding],
  );

  // Opening the Tasot sheet or the details grows the bottom overlay: re-centre so the venue pin stays visible.
  useEffect(() => {
    if (!showLayers && !showDetails) return;
    const id = window.setTimeout(() => centerVenue(400), 50);
    return () => window.clearTimeout(id);
  }, [showLayers, showDetails, centerVenue]);

  const onMapLoad = useCallback(() => {
    performance.mark("parkkis:map-load");
    // MapLibre opens the compact attribution on load; it covers the map. Keep credits and licences one tap away (ⓘ).
    const attrib = mapRef.current?.getMap().getContainer().querySelector(".maplibregl-ctrl-attrib");
    attrib?.classList.remove("maplibregl-compact-show");
    attrib?.removeAttribute("open");
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
  const ploughTouched = useRef(false);
  const togglePlough = useCallback(() => {
    ploughTouched.current = true;
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
  // Plough layer on by default only when there is a recent real run near the venue.
  useEffect(() => {
    if (!ploughTouched.current && ploughOnByDefault(ploughBanner)) {
      ploughTouched.current = true;
      setShowPlough(true);
      loadHel();
    }
  }, [ploughBanner, loadHel]);
  const ploughText =
    ploughStatus === "loading"
      ? "Ladataan auraustietoja…"
      : ploughStatus === "error"
        ? `${ERROR_TEXT}. Yritä myöhemmin uudelleen.`
        : ploughStatus === "empty"
          ? EMPTY_TEXT
          : ploughStatus === "ready"
            ? ploughBanner
              ? ploughBanner.text
              : venueFromLink
                ? "Ei auraus-, hiekoitus- tai harjausajoja 2 km säteellä viime tunteina."
                : `${ploughData?.features.length ?? 0} kunnossapitoajoa näkyvällä alueella (valtion tiet 12 h, Espoon kadut 48 h).`
            : null;

  // Optional city layers + venue info (events, zones, contractor, FMI forecast). All lazy.
  const match = useMemo(() => matchDateFrom(window.location.search, new Date()), []);
  const matchAt = useMemo(() => matchTarget(window.location.search, new Date()), []);
  const { layers: cityLayers, load: loadCity, contractors, loadContractors, forecast, loadForecast } = useCityLayers(match.date);
  const [cityShown, setCityShown] = useState<Set<CityLayerId>>(new Set());
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
  // OSM points only where there is no city data at all near the venue (see lib/banner.ts).
  const showOsm = showOsmFor(coverage);

  // At most one banner, in priority order.
  const banner = pickBanner({
    loadError: loadFailed ? loadingMsg : null,
    coverage: venueFromLink && venueOutsideData ? coverageNoteText(coverage) : null,
    busyDay:
      busy.length > 0
        ? `Vilkas päivä: ${busy.length} ${busy.length === 1 ? "tapahtuma" : "tapahtumaa"} lähellä ${match.fromLink ? "ottelupäivänä" : "tänään"}. Pysäköinti voi olla tavallista vaikeampaa.`
        : null,
    plough: ploughBanner && ploughOnByDefault(ploughBanner) ? ploughBanner.text : null,
    loading: !dbReady ? (venueTiles ? "Lähialueen pysäköinti näkyy. Ladataan koko kaupungin aineistoa…" : loadingMsg) : null,
  });
  const colors = THEME_CONFIGS[theme].colors;
  const legend = [
    { label: "Maksullinen", color: colors.paid },
    { label: "Ilmainen", color: colors.free },
    { label: "Erityispaikka", color: colors.special },
    { label: "Kielto", color: colors.restricted },
    { label: "Pysäköintialue", color: colors.area, dashed: true },
  ];
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

  const activeLayerCount =
    [showViolations, showSigns, showNewTraps, showRoadworks, showReservations, showLiipi, showPlough].filter(Boolean).length +
    cityShown.size +
    (activeFilter === "all" ? 0 : 1);
  const bannerTestId: Record<Banner["kind"], string> = {
    "load-error": "loading-status",
    loading: "loading-status",
    coverage: "venue-coverage-note",
    "busy-day": "busy-day-banner",
    plough: "plough-banner",
  };
  const isDark = theme !== "light";

  return (
    <div className="relative w-full h-screen bg-nc-deep text-nc-text">
      {/* Theme: one button, top-right. Forest stays available through ?theme=forest. */}
      <button
        type="button"
        data-testid="theme-toggle"
        onClick={() => setTheme(isDark ? "light" : "dark")}
        aria-label={isDark ? "Vaihda päiväteemaan" : "Vaihda yöteemaan"}
        title={isDark ? "Päiväteema" : "Yöteema"}
        className="nv-sheet absolute top-3 right-3 z-50 min-w-[44px] min-h-[44px] rounded-full flex items-center justify-center pointer-events-auto"
      >
        {isDark ? <Sun className="w-5 h-5 text-nc-gold" /> : <Moon className="w-5 h-5 text-nc-text" />}
      </button>

      {/* Search only on the home view; a venue link already says where we are. */}
      {!venueFromLink && (
        <div data-testid="top-hud" className="absolute top-3 left-3 right-[68px] sm:right-auto sm:w-[420px] z-40 flex flex-col gap-2 pointer-events-none">
          <div className="nv-sheet rounded-full pl-4 pr-1 flex items-center pointer-events-auto">
            <Search className="w-5 h-5 text-nc-text-muted shrink-0" />
            <input
              type="search"
              aria-label="Hae osoite"
              placeholder="Hae osoite"
              className="bg-transparent border-none text-nc-text text-base w-full min-h-[44px] px-2 focus:outline-none placeholder:text-nc-text-muted"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            {searchQuery && (
              <button
                type="button"
                aria-label="Tyhjennä haku"
                onClick={() => setSearchQuery("")}
                className="min-w-[44px] min-h-[44px] flex items-center justify-center hover:bg-nc-text/10 rounded-full"
              >
                <X className="w-4 h-4 text-nc-text-muted" />
              </button>
            )}
          </div>
          {visibleSearchResults.length > 0 && (
            <div className="nv-sheet rounded-2xl overflow-hidden pointer-events-auto">
              {visibleSearchResults.map((result: SearchResult) => (
                <button
                  type="button"
                  key={`${result.name.fi}-${result.location.coordinates.join(",")}`}
                  onClick={() => onSelectAddress(result)}
                  className="w-full min-h-[44px] text-left px-4 py-2 hover:bg-nc-text/10 border-b border-nc-border last:border-0 flex items-center gap-3"
                >
                  <Navigation className="w-4 h-4 text-nc-text-muted" />
                  <span>
                    <span className="block text-sm font-bold text-nc-text">{result.name.fi || result.name.sv}</span>
                    <span className="block text-xs text-nc-text-muted">
                      {result.municipality?.name?.fi || result.municipality?.name?.sv || ""}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

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
        showOsm={showOsm}
        showLiipi={showLiipi}
        showViolations={showViolations}
        showSigns={showSigns}
        showNewTraps={showNewTraps}
        showRoadworks={showRoadworks}
        showReservations={showReservations}
        activeFilter={activeFilter}
        ploughData={ploughData}
        helPriority={helPriority}
        cityLayers={cityLayers}
        cityShown={cityShown}
        showPlough={showPlough}
      />

      {/* One compact card at the bottom (phone: full width, thumb reach). "Tasot" replaces it with the layer sheet. */}
      <div
        data-testid="bottom-hud"
        className="absolute bottom-0 left-0 right-0 sm:left-3 sm:bottom-3 sm:right-auto sm:w-[420px] z-40 pointer-events-none"
      >
        {showLayers ? (
          <LayerSheet
            onClose={() => setShowLayers(false)}
            activeFilter={activeFilter}
            onFilter={setActiveFilter}
            venueLink={!!venueFromLink}
            date={match.date}
            dateFromLink={match.fromLink}
            showViolations={showViolations}
            setShowViolations={setShowViolations}
            showSigns={showSigns}
            setShowSigns={setShowSigns}
            showNewTraps={showNewTraps}
            setShowNewTraps={setShowNewTraps}
            dataReady={dbReady}
            fineYears={dataFacts?.fineYears}
            finePeriod={dataFacts?.finePeriod}
            finesOutside={!!venueFromLink && venueOutsideData}
            showRoadworks={showRoadworks}
            setShowRoadworks={setShowRoadworks}
            roadworkStatus={roadworkStatus}
            roadworkCount={roadworkData?.features.length}
            showReservations={showReservations}
            setShowReservations={setShowReservations}
            reservationStatus={reservationStatus}
            reservationCount={reservationData?.features.length}
            onOpenList={() => setShowResList(true)}
            cityLayers={cityLayers}
            cityShown={cityShown}
            onToggleCity={toggleCity}
            showLiipi={showLiipi}
            setShowLiipi={setShowLiipi}
            liipiCount={liipiData?.features.length}
            showPlough={showPlough}
            onTogglePlough={togglePlough}
            ploughStatus={ploughStatus}
            ploughFailed={ploughFailed}
            ploughText={ploughText}
            helStatus={helStatus}
            helCount={helPriority?.features.length}
            showOsmNote={showOsm}
          />
        ) : (
          <section
            data-testid="info-card"
            aria-label="Pysäköinti"
            className="nv-sheet pointer-events-auto px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] flex flex-col gap-2 max-h-[60vh] overflow-y-auto overscroll-contain"
          >
            <div className="flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <h1 className="text-base font-bold text-nc-text truncate">
                  {venueFromLink?.name ?? (selectedAddress ? selectedAddress.name : "Parkkis")}
                </h1>
                <p className="text-xs text-nc-text-muted">Napauta viivaa: hinta, aikaraja ja sakot.</p>
              </div>
              <button
                type="button"
                data-testid="layers-button"
                aria-label={`Tasot${activeLayerCount ? `, ${activeLayerCount} päällä` : ""}`}
                onClick={() => {
                  setShowLayers(true);
                  setHoverInfo(null);
                }}
                className="min-h-[44px] min-w-[44px] px-4 rounded-full bg-nc-neon-teal text-nc-deep font-bold text-sm flex items-center gap-2 shrink-0"
              >
                <Layers className="w-4 h-4" />
                Tasot
                {activeLayerCount > 0 && (
                  <span className="min-w-5 h-5 px-1 rounded-full bg-nc-deep text-nc-text text-xs flex items-center justify-center">
                    {activeLayerCount}
                  </span>
                )}
              </button>
            </div>

            {banner && (
              <div
                data-testid={bannerTestId[banner.kind]}
                role="status"
                className={`rounded-xl border px-3 py-2 text-sm leading-snug text-nc-text ${BANNER_STYLE[banner.tone]}`}
              >
                {banner.text}
              </div>
            )}

            <ul aria-label="Selite" className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-nc-text">
              {legend.map((l) => (
                <li key={l.label} className="flex items-center gap-1.5">
                  <span
                    aria-hidden="true"
                    className="inline-block w-4 h-1.5 rounded-full"
                    style={l.dashed ? { borderTop: `3px dashed ${l.color}`, height: 0 } : { background: l.color }}
                  />
                  {l.label}
                </li>
              ))}
              {!venueOutsideData && (
                <li className="flex items-center gap-1.5">
                  <span
                    aria-hidden="true"
                    className="inline-block w-4 h-3 rounded-full blur-[1px]"
                    style={{ background: `linear-gradient(90deg, ${colors.glowMid}, ${colors.glowHigh})` }}
                  />
                  Paljon sakkoja
                </li>
              )}
              {!venueOutsideData && (
                <li className="flex items-center gap-1.5">
                  <b>2 h</b> aikaraja
                </li>
              )}
            </ul>

            <button
              type="button"
              data-testid="details-toggle"
              aria-expanded={showDetails}
              onClick={() => setShowDetails((v) => !v)}
              className="min-h-[44px] -mx-2 px-2 rounded-xl flex items-center justify-between text-sm font-semibold text-nc-text hover:bg-nc-text/5"
            >
              {venueFromLink ? "Kohteen tiedot ja ohjeet" : "Tietoa kartasta"}
              {showDetails ? <ChevronDown className="w-5 h-5" /> : <ChevronUp className="w-5 h-5" />}
            </button>

            {showDetails && (
              <div data-testid="details" className="flex flex-col gap-3 text-sm text-nc-text pb-1">
                {venueFromLink && (
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
                <p>
                  <b>Kyltti voittaa kartan.</b> Työmaat ja kyltit muuttuvat, varmista paikka kadun merkistä.
                  {dataFacts?.slotsUpdated ? ` Pysäköintipaikat päivitetty ${new Date(dataFacts.slotsUpdated).toLocaleDateString("fi-FI")}.` : ""}
                </p>
                <p data-testid="fine-count">
                  <b>Sakot:</b>{" "}
                  {dataFacts
                    ? `${dataFacts.fineCount.toLocaleString("fi-FI")} sakkoa${dataFacts.fineYears ? ` (${dataFacts.fineYears})` : ""}, Helsingin kaupungin avoin sakkoaineisto. Oranssi–punainen hehku: vähintään 5 sakkoa paikan lähellä.`
                    : "Ladataan…"}
                </p>
                <div className="flex items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => setShowMetadataModal(true)}
                    className="rounded-full min-h-[44px] px-4 border border-nc-border text-sm font-semibold text-nc-text hover:bg-nc-text/10 flex items-center gap-2"
                  >
                    <Database className="w-4 h-4" />
                    Tietolähteet
                  </button>
                  <span data-testid="app-version-badge" className="text-xs font-mono text-nc-text-muted">
                    Parkkis v{typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "1.0.0"} ({typeof __COMMIT_HASH__ !== "undefined" ? __COMMIT_HASH__ : "dev"})
                  </span>
                </div>
              </div>
            )}
          </section>
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

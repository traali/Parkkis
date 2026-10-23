import React from "react";
import ReactMap, {
  AttributionControl,
  GeolocateControl,
  Layer,
  Marker,
  NavigationControl,
  Popup,
  Source,
  type MapLayerMouseEvent,
  type MapRef,
} from "react-map-gl/maplibre";
import type * as maplibregl from "maplibre-gl";
import type { FeatureCollection } from "geojson";
import { THEME_CONFIGS, type ThemeType } from "../lib/mapThemes";
import { AGE_COLORS, type PloughFC } from "../lib/plough";
import { FINE_OPACITY } from "../lib/fines";
import { LAYER_COLORS } from "./LayerSheet";
import { ParkingPopup, type HoverInfo } from "./ParkingPopup";
import maplibreWorkerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";

// MapLibre 6 is ESM-only and, under a bundler, needs the worker URL set
// explicitly (see the v5 → v6 migration guide). Loaded lazily so the map
// library stays in its own chunk.
const maplibreLib = import("maplibre-gl").then((lib) => {
  lib.setWorkerUrl(maplibreWorkerUrl);
  return lib;
});

import { CITY_LAYERS, type CityLayerId } from "../lib/cityLayers";
import { OSM_MIN_ZOOM, timeLimitLabel } from "../lib/banner";
import type { LayerState } from "../hooks/useCityLayers";

export interface Address {
  longitude: number;
  latitude: number;
  name: string;
}

export interface ParkingMapViewProps {
  mapRef: React.RefObject<MapRef | null>;
  geoControlRef: React.RefObject<maplibregl.GeolocateControl | null>;
  initialViewState: { longitude: number; latitude: number; zoom: number };
  theme: ThemeType;
  onMouseMove: (event: MapLayerMouseEvent) => void;
  onMouseLeave: () => void;
  onMapLoad: () => void;
  hoverInfo: HoverInfo | null;
  distance: string | null;
  selectedAddress: Address | null;
  riskData: FeatureCollection | null;
  violationData: FeatureCollection | null;
  signData: FeatureCollection | null;
  roadworkData: FeatureCollection | null;
  reservationData: FeatureCollection | null;
  liipiData: FeatureCollection | null;
  hubiData: FeatureCollection | null;
  espooData?: FeatureCollection | null;
  osmData?: FeatureCollection | null;
  showViolations: boolean;
  showSigns: boolean;
  showNewTraps: boolean;
  showRoadworks: boolean;
  showReservations: boolean;
  activeFilter: string;
  /** OSM points only for venues with no city data nearby (see lib/banner.ts). */
  showOsm?: boolean;
  showLiipi?: boolean;
  ploughData?: PloughFC | null;
  showPlough?: boolean;
  helPriority?: FeatureCollection | null;
  cityLayers?: Record<CityLayerId, LayerState>;
  cityShown?: Set<CityLayerId>;
}

export const ParkingMapView: React.FC<ParkingMapViewProps> = ({
  mapRef,
  geoControlRef,
  initialViewState,
  theme,
  onMouseMove,
  onMouseLeave,
  onMapLoad,
  hoverInfo,
  distance,
  selectedAddress,
  riskData,
  violationData,
  signData,
  roadworkData,
  reservationData,
  liipiData,
  hubiData,
  espooData,
  osmData,
  showViolations,
  showSigns,
  showNewTraps,
  showRoadworks,
  showReservations,
  activeFilter,
  showOsm = false,
  showLiipi = false,
  ploughData = null,
  showPlough = false,
  helPriority = null,
  cityLayers,
  cityShown,
}) => {
  const vis = (id: CityLayerId) => (cityShown?.has(id) ? "visible" : "none") as "visible" | "none";
  const cityData = (id: CityLayerId) => cityLayers?.[id]?.data ?? null;
  const c = THEME_CONFIGS[theme].colors;
  const isPhone = typeof window !== "undefined" && window.matchMedia("(max-width: 640px)").matches;
  const darkMap = theme !== "light";
  // Pin contrasts with the basemap and with every parking colour.
  const pinColor = darkMap ? "#f8fafc" : "#0f172a";
  const haloColor = darkMap ? "rgba(5, 8, 10, 0.85)" : "rgba(255, 255, 255, 0.9)";
  // Time limit as the city wrote it ("4 h", "60 min"), shown along the line when zoomed in.
  const riskWithLimits = React.useMemo(() => {
    if (!riskData) return null;
    return {
      ...riskData,
      features: riskData.features.map((f) => {
        const limit = timeLimitLabel(f.properties?.kesto);
        return limit ? { ...f, properties: { ...f.properties, time_limit: limit } } : f;
      }),
    } as FeatureCollection;
  }, [riskData]);
  const colorOf = (id: CityLayerId) => CITY_LAYERS.find((l) => l.id === id)!.color;
  const mapFilter: import("maplibre-gl").FilterSpecification =
    activeFilter === "all"
      ? ["has", "category"]
      : activeFilter === "residential"
        ? ["==", ["get", "resident_zone"], true]
        : ["==", ["get", "category"], activeFilter];

  return (
      <ReactMap
        mapLib={maplibreLib}
        ref={mapRef}
        initialViewState={initialViewState}
        style={{ width: "100%", height: "100%" }}
        mapStyle={THEME_CONFIGS[theme].mapStyle}
        interactiveLayerIds={[
          "city-events-fill",
          "city-leases-fill",
          "city-leases-points",
          "city-coach-points",
          "city-cycling-lines",
          "city-access-lines",
          "city-zones-fill",
          "violation-cells",
          "parking-lines",
          "hubi-lines",
          "sign-points",
          "roadwork-fill",
          "reservation-fill",
          "liipi-points",
          "espoo-points",
          "osm-points",
          "plough-lines",
          "hel-winter-lines",
        ]}
        onMouseMove={onMouseMove}
        onClick={onMouseMove}
        onMouseLeave={onMouseLeave}
        onLoad={onMapLoad}
        attributionControl={false}
      >
        {/* Top-right column under the theme button: locate me, zoom (desktop only; phones pinch), credits ⓘ. */}
        <GeolocateControl
          ref={geoControlRef}
          position="top-right"
          trackUserLocation={true}
          showAccuracyCircle={false}
        />
        {!isPhone && <NavigationControl position="top-right" showCompass={false} />}
        <AttributionControl
          position="top-right"
          compact={true}
          customAttribution={[
            '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> © <a href="https://carto.com/attributions" target="_blank" rel="noopener">CARTO</a>',
            "Pysäköintipaikat, sakot, työmaat ja vuokra-alueet: Helsingin kaupunki (CC BY 4.0)",
            "Liikennemerkit: Väylävirasto / Digiroad (CC BY 4.0)",
            "Liityntäpysäköinti: Fintraffic (CC BY 4.0)",
            "Pysäköintialueet: Parkkihubi / Helsingin kaupunki",
            "Espoon pysäköintialueet: Espoon kaupunki (CC BY 4.0)",
            "Pysäköinti muualla: © OpenStreetMap-avustajat (ODbL)",
            "Auraus ja hiekoitus (valtion tiet): Fintraffic / digitraffic.fi (CC BY 4.0)",
            "Espoon katujen kunnossapito: Espoon kaupunki (CC BY 4.0)",
            "Talvihoidon ensisijaiset reitit: Helsingin kaupunki (CC BY 4.0)",
            "Lisätasot: Helsingin kaupunki (CC BY 4.0)",
            "Sää: Ilmatieteen laitos (CC BY 4.0)",
          ]}
        />

        {violationData && (
          // ~100 m squares shaded by the real number of fines (address-level data, so no single spots).
          <Source id="violation-cells-src" type="geojson" data={violationData}>
            <Layer
              id="violation-cells"
              type="fill"
              layout={{ visibility: showViolations ? "visible" : "none" }}
              paint={{
                "fill-color": LAYER_COLORS.violations,
                "fill-opacity": FINE_OPACITY,
              }}
            />
            <Layer
              id="violation-cells-outline"
              type="line"
              layout={{ visibility: showViolations ? "visible" : "none" }}
              paint={{ "line-color": LAYER_COLORS.violations, "line-opacity": 0.55, "line-width": 0.75 }}
            />
            <Layer
              id="violation-cells-count"
              type="symbol"
              minzoom={15}
              layout={{
                visibility: showViolations ? "visible" : "none",
                "text-field": ["to-string", ["get", "fines"]],
                "text-font": ["Open Sans Bold"],
                "text-size": 12,
                "text-allow-overlap": false,
              }}
              paint={{
                "text-color": theme === "light" ? "#7f1d1d" : "#fecaca",
                "text-halo-color": theme === "light" ? "#ffffff" : "#000000",
                "text-halo-width": 1.2,
              }}
            />
          </Source>
        )}


        {riskWithLimits && (
          <Source id="risk-data" type="geojson" data={riskWithLimits}>
            {/* Fine risk: a warm halo UNDER the line, only where at least 5 fines were given nearby. */}
            <Layer
              id="parking-glow"
              type="line"
              filter={["all", mapFilter, [">=", ["coalesce", ["get", "fine_count"], 0], 5]]}
              layout={{ "line-cap": "round" }}
              paint={{
                "line-color": [
                  "interpolate",
                  ["linear"],
                  ["get", "fine_count"],
                  5,
                  c.glowMid,
                  20,
                  c.glowHigh,
                ],
                "line-width": ["interpolate", ["linear"], ["zoom"], 12, 6, 18, 18],
                "line-blur": 3,
                "line-opacity": 0.55,
              }}
            />
            <Layer
              id="parking-lines"
              type="line"
              filter={mapFilter}
              layout={{ "line-cap": "round" }}
              paint={{
                "line-color": [
                  "match",
                  ["get", "category"],
                  "paid",
                  c.paid,
                  "restricted",
                  c.restricted,
                  "free",
                  c.free,
                  "special",
                  c.special,
                  c.other,
                ],
                "line-width": ["interpolate", ["linear"], ["zoom"], 10, 2, 18, 7],
                "line-opacity": 0.95,
              }}
            />
            <Layer
              id="parking-time-limits"
              type="symbol"
              minzoom={16}
              filter={["all", mapFilter, ["has", "time_limit"]]}
              layout={{
                "symbol-placement": "line-center",
                "text-field": ["get", "time_limit"],
                "text-font": ["Open Sans Bold"],
                "text-size": 12,
                "text-allow-overlap": false,
              }}
              paint={{
                "text-color": darkMap ? "#ffffff" : "#0f172a",
                "text-halo-color": haloColor,
                "text-halo-width": 2,
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
                "line-color": c.area,
                "line-width": [
                  "interpolate",
                  ["linear"],
                  ["zoom"],
                  10,
                  1,
                  18,
                  2.5,
                ],
                "line-opacity": 0.7,
                "line-dasharray": [3, 2],
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
                  darkMap ? "#e2e8f0" : "#334155",
                ],
                "circle-stroke-width": 1.5,
                "circle-stroke-color": darkMap ? "#0a0f14" : "#ffffff",
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
                "circle-opacity": 0.45,
                "circle-blur": 1,
              }}
            />
          </Source>
        )}


        {cityData("zones") && (
          <Source id="city-zones" type="geojson" data={cityData("zones")!}>
            <Layer id="city-zones-fill" type="fill" layout={{ visibility: vis("zones") }}
              paint={{ "fill-color": ["match", ["get", "city_kind"], "payzone", "#64748b", "#a3e635"], "fill-opacity": 0.12 }} />
            <Layer id="city-zones-line" type="line" layout={{ visibility: vis("zones") }}
              paint={{ "line-color": ["match", ["get", "city_kind"], "payzone", colorOf("zones"), "#a3e635"], "line-width": 1.5, "line-dasharray": [3, 2] }} />
          </Source>
        )}
        {cityData("cycling") && (
          <Source id="city-cycling" type="geojson" data={cityData("cycling")!}>
            <Layer id="city-cycling-lines" type="line" layout={{ visibility: vis("cycling"), "line-cap": "round" }}
              paint={{ "line-color": colorOf("cycling"), "line-width": ["case", ["get", "main"], 3, 1.5], "line-opacity": 0.8 }} />
          </Source>
        )}
        {cityData("access") && (
          <Source id="city-access" type="geojson" data={cityData("access")!}>
            <Layer id="city-access-lines" type="line" layout={{ visibility: vis("access"), "line-cap": "round" }}
              paint={{ "line-color": colorOf("access"), "line-width": 3, "line-opacity": 0.85 }} />
          </Source>
        )}
        {cityData("events") && (
          <Source id="city-events" type="geojson" data={cityData("events")!}>
            <Layer id="city-events-fill" type="fill" layout={{ visibility: vis("events") }}
              paint={{ "fill-color": colorOf("events"), "fill-opacity": 0.25, "fill-outline-color": colorOf("events") }} />
          </Source>
        )}
        {cityData("leases") && (
          <Source id="city-leases" type="geojson" data={cityData("leases")!}>
            <Layer id="city-leases-fill" type="fill" filter={["==", ["geometry-type"], "Polygon"]} layout={{ visibility: vis("leases") }}
              paint={{ "fill-color": colorOf("leases"), "fill-opacity": 0.3, "fill-outline-color": colorOf("leases") }} />
            <Layer id="city-leases-points" type="circle" filter={["==", ["geometry-type"], "Point"]} layout={{ visibility: vis("leases") }}
              paint={{ "circle-radius": 6, "circle-color": colorOf("leases"), "circle-stroke-width": 2, "circle-stroke-color": "#fff" }} />
          </Source>
        )}
        {cityData("coach") && (
          <Source id="city-coach" type="geojson" data={cityData("coach")!}>
            <Layer id="city-coach-points" type="circle" layout={{ visibility: vis("coach") }}
              paint={{ "circle-radius": 8, "circle-color": colorOf("coach"), "circle-stroke-width": 2, "circle-stroke-color": "#fff" }} />
          </Source>
        )}
        {helPriority && (
          <Source id="hel-winter" type="geojson" data={helPriority}>
            <Layer
              id="hel-winter-lines"
              type="line"
              layout={{ visibility: showPlough ? "visible" : "none" }}
              paint={{ "line-color": "#6ee7b7", "line-width": 4, "line-opacity": 0.7, "line-dasharray": [2, 1.5] }}
            />
          </Source>
        )}

        {ploughData && (
          <Source id="plough-data" type="geojson" data={ploughData}>
            <Layer
              id="plough-lines"
              type="line"
              layout={{ visibility: showPlough ? "visible" : "none", "line-cap": "round", "line-join": "round" }}
              paint={{
                "line-color": ["match", ["get", "age"], "lt1h", AGE_COLORS.lt1h, "1to3h", AGE_COLORS["1to3h"], "3to12h", AGE_COLORS["3to12h"], AGE_COLORS["12to48h"]],
                "line-width": ["interpolate", ["linear"], ["zoom"], 10, 3, 15, 7],
                "line-opacity": 0.9,
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
          </Source>
        )}

        {hoverInfo && (
          <Popup
            longitude={hoverInfo.longitude}
            latitude={hoverInfo.latitude}
            closeButton={false}
            closeOnClick={false}
            maxWidth="320px"
            className="nv-popup"
          >
            <ParkingPopup
              hoverInfo={hoverInfo}
              selectedAddress={selectedAddress}
              distance={distance}
            />
          </Popup>
        )}
        {selectedAddress && (
          <Marker
            // MapLibre reads the colour only when the marker is created; remount on theme change.
            key={pinColor}
            longitude={selectedAddress.longitude}
            latitude={selectedAddress.latitude}
            anchor="bottom"
            color={pinColor}
            scale={1.25}
          />
        )}
        {osmData && showOsm && (
          <Source id="osm-parking" type="geojson" data={osmData}>
            <Layer
              id="osm-points"
              type="circle"
              minzoom={OSM_MIN_ZOOM}
              paint={{
                "circle-radius": 5,
                "circle-color": "#9aa4ad",
                "circle-stroke-width": 1.5,
                "circle-stroke-color": darkMap ? "#ffffff" : "#0f172a",
              }}
            />
          </Source>
        )}
        {espooData && (
          <Source id="espoo-parking" type="geojson" data={espooData}>
            <Layer
              id="espoo-points"
              type="circle"
              paint={{
                "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 4, 16, 8],
                "circle-color": c.area,
                "circle-stroke-width": 2,
                "circle-stroke-color": darkMap ? "#ffffff" : "#0f172a",
              }}
            />
          </Source>
        )}
        {liipiData && showLiipi && (
          <Source id="liipi-hubs" type="geojson" data={liipiData}>
            <Layer
              id="liipi-glow"
              type="circle"
              paint={{
                "circle-radius": 15,
                "circle-color": c.area,
                "circle-opacity": 0.2,
                "circle-blur": 1,
              }}
            />
            <Layer
              id="liipi-points"
              type="circle"
              paint={{
                "circle-radius": 6,
                "circle-color": c.area,
                "circle-stroke-width": 2,
                "circle-stroke-color": darkMap ? "#ffffff" : "#0f172a",
              }}
            />
            <Layer
              id="liipi-labels"
              type="symbol"
              minzoom={12}
              layout={{
                "text-field": ["get", "name_fi"],
                "text-font": ["Open Sans Bold"],
                "text-variable-anchor": ["top", "bottom", "left", "right"],
                "text-radial-offset": 0.8,
                "text-justify": "auto",
                "text-size": 10,
              }}
              paint={{
                "text-color": c.area,
                "text-halo-color": haloColor,
                "text-halo-width": 2,
              }}
            />
          </Source>
        )}
      </ReactMap>
  );
};

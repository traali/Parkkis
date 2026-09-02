import React from "react";
import ReactMap, {
  GeolocateControl,
  Layer,
  NavigationControl,
  Popup,
  Source,
  type MapLayerMouseEvent,
  type MapRef,
} from "react-map-gl/maplibre";
import type maplibregl from "maplibre-gl";
import type { FeatureCollection } from "geojson";
import { THEME_CONFIGS, type ThemeType } from "../lib/mapThemes";
import { ParkingPopup, type HoverInfo } from "./ParkingPopup";

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
  walkTime: (meters: string) => number;
  selectedAddress: Address | null;
  riskData: FeatureCollection | null;
  violationData: FeatureCollection | null;
  signData: FeatureCollection | null;
  roadworkData: FeatureCollection | null;
  reservationData: FeatureCollection | null;
  liipiData: FeatureCollection | null;
  hubiData: FeatureCollection | null;
  showViolations: boolean;
  showSigns: boolean;
  showNewTraps: boolean;
  showRoadworks: boolean;
  showReservations: boolean;
  activeFilter: string;
  pulseOpacity: number;
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
  walkTime,
  selectedAddress,
  riskData,
  violationData,
  signData,
  roadworkData,
  reservationData,
  liipiData,
  hubiData,
  showViolations,
  showSigns,
  showNewTraps,
  showRoadworks,
  showReservations,
  activeFilter,
  pulseOpacity,
}) => {
  const mapFilter: import("maplibre-gl").FilterSpecification =
    activeFilter === "all"
      ? ["has", "category"]
      : ["==", ["get", "category"], activeFilter];

  return (
      <ReactMap
        ref={mapRef}
        initialViewState={initialViewState}
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
        onMouseLeave={onMouseLeave}
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
  );
};

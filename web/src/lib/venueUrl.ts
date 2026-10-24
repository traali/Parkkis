import type { Address } from "../components/ParkingMapView";
import type { ThemeType } from "./mapThemes";

/** Finland, generously. Anything outside is a broken link, not a venue. */
const FINLAND_BOUNDS = { minLat: 59.3, maxLat: 70.2, minLon: 19.0, maxLon: 31.7 };

/**
 * Reads Pelipäivä's deep link: /venue/<encoded name>?lat=..&lon=..&embed=true&theme=night-captain
 * (also accepts ?lng= and ?venue=<name>).
 */
export function readVenueFromUrl(): Address | null {
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

export function readThemeFromUrl(): ThemeType {
  const t = new URLSearchParams(window.location.search).get("theme");
  if (t === "light" || t === "forest") return t;
  return "dark"; // "dark" and Pelipäivä's "night-captain" are the same theme
}

export function metersBetween(
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

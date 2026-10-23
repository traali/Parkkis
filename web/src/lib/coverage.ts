import type { FeatureCollection, Geometry } from "geojson";

export interface LatLon {
  latitude: number;
  longitude: number;
}

/** Which real datasets have something within the radius of a venue. */
export interface VenueCoverage {
  helsinki: boolean;
  espoo: number;
  osm: number;
  /** Espoo/OSM data did not load, so "nothing nearby" cannot be claimed. */
  failed?: boolean;
}

export function metersBetween(a: LatLon, b: LatLon): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

function firstCoord(g: Geometry | null | undefined): number[] | null {
  if (!g || !("coordinates" in g)) return null;
  let c: unknown = g.coordinates;
  while (Array.isArray(c) && Array.isArray(c[0])) c = c[0];
  return Array.isArray(c) && typeof c[0] === "number" ? (c as number[]) : null;
}

function countNear(fc: FeatureCollection | null | undefined, at: LatLon, radius: number): number {
  if (!fc) return 0;
  let n = 0;
  for (const f of fc.features) {
    const c = firstCoord(f.geometry);
    if (c && metersBetween(at, { longitude: c[0], latitude: c[1] }) <= radius) n++;
  }
  return n;
}

export function venueCoverage(
  venue: LatLon,
  radius: number,
  data: { helsinki: FeatureCollection | null; espoo: FeatureCollection | null; osm: FeatureCollection | null },
  failed = false,
): VenueCoverage {
  return {
    failed,
    helsinki: countNear(data.helsinki, venue, radius) > 0,
    espoo: countNear(data.espoo, venue, radius),
    osm: countNear(data.osm, venue, radius),
  };
}

/** Finnish note that says exactly what data there is near the venue, and nothing more. */
export function coverageNoteText(c: VenueCoverage | null): string {
  const base = "Helsingin katupysäköinnin tiedot eivät ulotu tänne.";
  if (!c) return base;
  if (c.failed && c.espoo === 0 && c.osm === 0)
    return `${base} Tietojen lataus epäonnistui, joten emme tiedä lähialueen pysäköinnistä. Päivitä sivu tai tarkista kyltit.`;
  if (c.espoo > 0)
    return `${base} Lähellä on ${c.espoo} Espoon kaupungin pysäköintialuetta (turkoosi). Vapaista paikoista, hinnoista ja rajoituksista ei ole tietoa, tarkista kyltit.`;
  if (c.osm > 0)
    return `${base} Lähellä on ${c.osm} OpenStreetMapiin merkittyä pysäköintipaikkaa (harmaa). Ne ovat vapaaehtoisten merkintöjä, tarkista kyltit.`;
  return `${base} Lähellä ei ole pysäköintitietoja avoimessa datassa, joten katso pysäköinti paikan omista ohjeista ja kylteistä.`;
}

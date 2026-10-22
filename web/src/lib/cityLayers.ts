// Helsinki open-data layers (Helsingin kaupunki, CC BY 4.0) and the FMI forecast (Ilmatieteen laitos, CC BY 4.0).
// Everything here is fetched on demand only; nothing is estimated or invented. Self-contained (no imports)
// so the tests can transpile it alone.
import type { Feature, FeatureCollection, Geometry, Position } from "geojson";

export interface Bbox { minLon: number; minLat: number; maxLon: number; maxLat: number }

export const HEL_WFS = "https://kartta.hel.fi/ws/geoserver/avoindata/wfs";
export const HEL_PROXY = "/api/hel-wfs";
export const HEL_CREDIT = "Helsingin kaupunki (CC BY 4.0)";
export const FMI_CREDIT = "Ilmatieteen laitos (CC BY 4.0)";
/** Events within this distance of the venue make the match date a "busy day". */
export const BUSY_RADIUS_M = 1500;

export type CityLayerId = "events" | "leases" | "coach" | "cycling" | "access" | "zones";

export const CITY_LAYERS: { id: CityLayerId; label: string; color: string }[] = [
  { id: "events", label: "Tapahtumat", color: "#f472b6" },
  { id: "leases", label: "Lyhyet maanvuokraukset", color: "#fb923c" },
  { id: "coach", label: "Turistibussien pysäköinti", color: "#a78bfa" },
  { id: "cycling", label: "Pyöräreitit", color: "#22d3ee" },
  { id: "access", label: "Esteettömät reitit", color: "#facc15" },
  { id: "zones", label: "Maksu- ja asukasvyöhykkeet", color: "#94a3b8" },
];

/** YYYY-MM-DD in Helsinki. */
export function helsinkiDate(d: Date): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Helsinki" }).format(d);
}

/** "?date=YYYY-MM-DD" from the URL when valid, else today in Helsinki. */
export function matchDateFrom(search: string, now: Date): { date: string; fromLink: boolean } {
  const v = new URLSearchParams(search).get("date") ?? "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T12:00:00Z`))) return { date: v, fromLink: true };
  return { date: helsinkiDate(now), fromLink: false };
}

export function fiDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${Number(m[3])}.${Number(m[2])}.${m[1]}` : iso;
}

/** WFS 2.0 `bbox` parameter (lat/lon order for EPSG:4326). GeoServer cannot combine it with cql_filter. */
export function bboxParam(b: Bbox): string {
  return `${b.minLat.toFixed(5)},${b.minLon.toFixed(5)},${b.maxLat.toFixed(5)},${b.maxLon.toFixed(5)},urn:ogc:def:crs:EPSG::4326`;
}

export function wfsQuery(typeName: string, cql?: string, propertyName?: string[], count = 2000, bbox?: Bbox): string {
  const p = new URLSearchParams({ service: "WFS", version: "2.0.0", request: "GetFeature", typeName, outputFormat: "application/json", srsName: "EPSG:4326", count: String(count) });
  if (cql) p.set("cql_filter", cql);
  else if (bbox) p.set("bbox", bboxParam(bbox));
  if (propertyName) p.set("propertyName", propertyName.join(","));
  return p.toString();
}

type Fetch = typeof fetch;

/** Same-origin cached proxy first; the city's own server directly if the proxy is missing (dev) or fails. */
export async function helFetch(query: string, f: Fetch = fetch): Promise<Feature[]> {
  let lastErr: unknown;
  for (const base of [HEL_PROXY, HEL_WFS]) {
    try {
      const r = await f(`${base}?${query}`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const ct = r.headers?.get?.("content-type") ?? "application/json";
      if (!ct.includes("json")) throw new Error(`not JSON (${ct})`);
      const data = (await r.json()) as FeatureCollection;
      if (!Array.isArray(data?.features)) throw new Error("not a FeatureCollection");
      return data.features;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}

const fc = (features: Feature[]): FeatureCollection => ({ type: "FeatureCollection", features });
const s = (v: unknown) => (v == null ? "" : String(v).trim());

// ── Layers ────────────────────────────────────────────────────────────────────

/** Event areas active on `date` (build-up to tear-down), whole city (the layer is small). */
export function eventsQuery(date: string): string {
  return wfsQuery("avoindata:Tapahtumat_alue", `rakentaminen_alkaa<='${date}' AND purkaminen_paattyy>='${date}'`);
}
export function toEvents(features: Feature[], date: string): FeatureCollection {
  return fc(
    features.map((f) => {
      const p = (f.properties ?? {}) as Record<string, unknown>;
      const evStart = s(p.tapahtuma_alkaa).slice(0, 10);
      const evEnd = s(p.tapahtuma_paattyy).slice(0, 10);
      const phase = evStart && evEnd && evStart <= date && date <= evEnd ? "Tapahtuma käynnissä" : "Rakentaminen tai purku";
      return {
        type: "Feature",
        geometry: f.geometry,
        properties: {
          city_kind: "event",
          title: s(p.nimi) || "Tapahtuma",
          address: s(p.osoite),
          district: s(p.kaupunginosa),
          phase,
          event_period: `${s(p.tapahtuma_alkaa_txt) || fiDate(evStart)} – ${s(p.tapahtuma_paattyy_txt) || fiDate(evEnd)}`,
          site_period: `${s(p.rakentaminen_alkaa_txt) || fiDate(s(p.rakentaminen_alkaa))} – ${s(p.purkaminen_paattyy_txt) || fiDate(s(p.purkaminen_paattyy))}`,
          status: s(p.status),
        },
      } as Feature;
    }),
  );
}

/** Short-term land leases (areas and points) valid on `date`, whole city (≈600 rows). */
export function leaseQueries(date: string): string[] {
  const cql = `vuokraus_alkaa<='${date}' AND vuokraus_paattyy>='${date}'`;
  return ["avoindata:Lyhyt_maanvuokraus_alue", "avoindata:Lyhyt_maanvuokraus_piste"].map((t) => wfsQuery(t, cql));
}
export function toLeases(features: Feature[]): FeatureCollection {
  return fc(
    features.map((f) => {
      const p = (f.properties ?? {}) as Record<string, unknown>;
      return {
        type: "Feature",
        geometry: f.geometry,
        properties: {
          city_kind: "lease",
          title: s(p.nimi) || s(p.hakemuksen_laji) || "Lyhyt maanvuokraus",
          address: s(p.osoite),
          district: s(p.kaupunginosa),
          period: `${s(p.vuokraus_alkaa_txt) || fiDate(s(p.vuokraus_alkaa))} – ${s(p.vuokraus_paattyy_txt) || fiDate(s(p.vuokraus_paattyy))}`,
          status: s(p.status),
          ref: s(p.hakemustunnus),
        },
      } as Feature;
    }),
  );
}

export const COACH_QUERY = wfsQuery("avoindata:Matkailuliikenne_pysakointipaikat_piste");
export function toCoach(features: Feature[]): FeatureCollection {
  return fc(
    features.map((f) => {
      const p = (f.properties ?? {}) as Record<string, unknown>;
      return {
        type: "Feature",
        geometry: f.geometry,
        properties: {
          city_kind: "coach",
          title: `${s(p.p_kirjain) ? `${s(p.p_kirjain)}: ` : ""}${s(p.p_nimi) || "Turistibussipaikka"}`,
          info: s(p.lisatieto),
          limit: s(p.aika),
          season: s(p.kausi),
          updated: s(p.paivitetty_tietopalveluun),
        },
      } as Feature;
    }),
  );
}

export function cyclingQueries(b: Bbox): string[] {
  return ["avoindata:Pyorailykartta_2026_paapyorareitti", "avoindata:Pyorailykartta_2026_muu_pyorareitti"].map((t) => wfsQuery(t, undefined, undefined, 5000, b));
}
export function toCycling(features: Feature[]): FeatureCollection {
  return fc(
    features.map((f) => {
      const p = (f.properties ?? {}) as Record<string, unknown>;
      const cls = s(p.reittiluokka) || "Pyöräreitti";
      return { type: "Feature", geometry: f.geometry, properties: { city_kind: "cycling", title: cls, main: /pää/i.test(cls), oneway: s(p.yksisuuntaisuus) } } as Feature;
    }),
  );
}

export function accessQuery(b: Bbox): string {
  return wfsQuery("avoindata:Esteettomyysreitti_viiva", undefined, undefined, 5000, b);
}
export function toAccess(features: Feature[]): FeatureCollection {
  return fc(
    features.map((f) => {
      const p = (f.properties ?? {}) as Record<string, unknown>;
      const extras = [s(p.lisatieto1), s(p.str_lisatieto_2)].filter(Boolean);
      return {
        type: "Feature",
        geometry: f.geometry,
        properties: {
          city_kind: "access",
          title: "Esteettömyysreitti",
          address: s(p.katuosoite1),
          sound: s(p.aaniopastus_suojatiella),
          info: extras.join(", "),
          updated: s(p.paivitetty_tietopalveluun),
        },
      } as Feature;
    }),
  );
}

export const PAY_ZONE_QUERY = wfsQuery("avoindata:Pysakoinnin_maksuvyohykkeet_alue");
export const RESIDENT_ZONE_QUERY = wfsQuery("avoindata:Asukas_ja_yrityspysakointivyohykkeet_alue");
export function toZones(pay: Feature[], resident: Feature[]): FeatureCollection {
  return fc([
    ...pay.map((f) => {
      const p = (f.properties ?? {}) as Record<string, unknown>;
      return { type: "Feature", geometry: f.geometry, properties: { city_kind: "payzone", title: s(p.nimi) || "Maksuvyöhyke", info: s(p.lisatiedot), link: s(p.linkki), updated: s(p.paivitetty_tietopalveluun) } } as Feature;
    }),
    ...resident.map((f) => {
      const p = (f.properties ?? {}) as Record<string, unknown>;
      return {
        type: "Feature",
        geometry: f.geometry,
        properties: { city_kind: "resident", title: `Asukaspysäköintialue ${s(p.asukaspysakointitunnus)}${s(p.alueen_nimi) ? ` (${s(p.alueen_nimi)})` : ""}`, link: s(p.linkki), updated: s(p.paivitetty_tietopalveluun) },
      } as Feature;
    }),
  ]);
}

/** Maintenance areas whose bbox touches a ~20 m box around the venue; exact containment is tested client-side. */
export function contractorQuery(lat: number, lon: number): string {
  const d = 0.0002;
  return wfsQuery("avoindata:Vastuualue_rya_urakkarajat", undefined, undefined, 50, { minLat: lat - d, minLon: lon - d, maxLat: lat + d, maxLon: lon + d });
}
export interface Contractor { area: string; kind: string; contractor: string; period: string }
export function toContractors(features: Feature[], lat: number, lon: number, today: string): Contractor[] {
  const out: Contractor[] = [];
  const seen = new Set<string>();
  for (const f of features) {
    const p = (f.properties ?? {}) as Record<string, unknown>;
    if (s(p.status) && s(p.status) !== "voimassa") continue;
    if (s(p.loppu_pvm) && s(p.loppu_pvm).slice(0, 10) < today) continue;
    if (!pointInGeometry(f.geometry, lon, lat)) continue;
    const c: Contractor = { area: s(p.nimi), kind: s(p.urakkamuoto), contractor: s(p.urakoitsija), period: `${fiDate(s(p.alku_pvm))}–${fiDate(s(p.loppu_pvm))}` };
    const k = `${c.area}|${c.contractor}`;
    if (!c.contractor || seen.has(k)) continue;
    seen.add(k);
    out.push(c);
  }
  return out;
}

// ── Geometry helpers ─────────────────────────────────────────────────────────

export function metersBetween(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const r = (x: number) => (x * Math.PI) / 180;
  const a = Math.sin(r(lat2 - lat1) / 2) ** 2 + Math.cos(r(lat1)) * Math.cos(r(lat2)) * Math.sin(r(lon2 - lon1) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function positions(g: Geometry | null | undefined): Position[] {
  if (!g) return [];
  switch (g.type) {
    case "Point": return [g.coordinates];
    case "MultiPoint": case "LineString": return g.coordinates;
    case "MultiLineString": case "Polygon": return g.coordinates.flat();
    case "MultiPolygon": return g.coordinates.flat(2);
    case "GeometryCollection": return g.geometries.flatMap(positions);
  }
}

/** Nearest vertex distance; inside a polygon counts as 0. */
export function distanceTo(g: Geometry | null | undefined, lat: number, lon: number): number {
  if (!g) return Number.POSITIVE_INFINITY;
  if (pointInGeometry(g, lon, lat)) return 0;
  let best = Number.POSITIVE_INFINITY;
  for (const [x, y] of positions(g)) best = Math.min(best, metersBetween(lat, lon, y, x));
  return best;
}

function inRing(ring: Position[], x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
export function pointInGeometry(g: Geometry | null | undefined, lon: number, lat: number): boolean {
  if (!g) return false;
  const poly = (rings: Position[][]) => rings.length > 0 && inRing(rings[0], lon, lat) && !rings.slice(1).some((h) => inRing(h, lon, lat));
  if (g.type === "Polygon") return poly(g.coordinates);
  if (g.type === "MultiPolygon") return g.coordinates.some(poly);
  return false;
}

/** Busy-day warning: events near the venue on the match date, nearest first. Past/real dates only. */
export function busyDay(events: FeatureCollection | null, lat: number, lon: number, radius = BUSY_RADIUS_M) {
  if (!events) return [];
  return events.features
    .map((f) => ({ f, d: distanceTo(f.geometry, lat, lon) }))
    .filter((x) => x.d <= radius)
    .sort((a, b) => a.d - b.d)
    .map(({ f, d }) => {
      const p = f.properties as Record<string, string>;
      return { title: p.title, address: p.address, phase: p.phase, period: p.event_period, distanceM: Math.round(d) };
    });
}

/** Zones containing the venue point. */
export function zonesAt(zones: FeatureCollection | null, lat: number, lon: number) {
  if (!zones) return [];
  return zones.features.filter((f) => pointInGeometry(f.geometry, lon, lat)).map((f) => f.properties as Record<string, string>);
}

// ── FMI forecast ─────────────────────────────────────────────────────────────

export const FMI_WFS = "https://opendata.fmi.fi/wfs";
export const FMI_PARAMS = ["Temperature", "WindSpeedMS", "Precipitation1h", "WeatherSymbol3"] as const;

export function fmiUrl(lat: number, lon: number): string {
  const p = new URLSearchParams({
    service: "WFS", version: "2.0.0", request: "getFeature",
    storedquery_id: "fmi::forecast::edited::weather::scandinavia::point::simple",
    latlon: `${lat.toFixed(4)},${lon.toFixed(4)}`,
    parameters: FMI_PARAMS.join(","),
    timestep: "60",
  });
  return `${FMI_WFS}?${p}`;
}

export interface ForecastHour { time: string; temperature?: number; wind?: number; precip?: number; symbol?: number }

export function parseFmi(xml: string): ForecastHour[] {
  const byTime = new Map<string, ForecastHour>();
  const re = /<BsWfs:Time>([^<]+)<\/BsWfs:Time>\s*<BsWfs:ParameterName>([^<]+)<\/BsWfs:ParameterName>\s*<BsWfs:ParameterValue>([^<]*)<\/BsWfs:ParameterValue>/g;
  for (let m = re.exec(xml); m; m = re.exec(xml)) {
    const [, time, name, raw] = m;
    const v = Number(raw);
    if (!Number.isFinite(v)) continue;
    const h = byTime.get(time) ?? { time };
    if (name === "Temperature") h.temperature = v;
    else if (name === "WindSpeedMS") h.wind = v;
    else if (name === "Precipitation1h") h.precip = v;
    else if (name === "WeatherSymbol3") h.symbol = v;
    byTime.set(time, h);
  }
  return [...byTime.values()].sort((a, b) => a.time.localeCompare(b.time));
}

const SYMBOL_FI: Record<number, string> = {
  1: "selkeää", 2: "puolipilvistä", 3: "pilvistä",
  21: "heikkoja sadekuuroja", 22: "sadekuuroja", 23: "voimakkaita sadekuuroja",
  31: "heikkoa vesisadetta", 32: "vesisadetta", 33: "voimakasta vesisadetta",
  41: "heikkoja lumikuuroja", 42: "lumikuuroja", 43: "voimakkaita lumikuuroja",
  51: "heikkoa lumisadetta", 52: "lumisadetta", 53: "voimakasta lumisadetta",
  61: "ukkoskuuroja", 62: "voimakkaita ukkoskuuroja", 63: "ukkosta", 64: "voimakasta ukkosta",
  71: "heikkoja räntäkuuroja", 72: "räntäkuuroja", 73: "voimakkaita räntäkuuroja",
  81: "heikkoa räntäsadetta", 82: "räntäsadetta", 83: "voimakasta räntäsadetta",
  91: "utua", 92: "sumua",
};

/**
 * Picks the forecast hour for the match: the hour nearest `target` (match date at `hh:mm` Helsinki, or now).
 * Returns null when the target lies outside the forecast range — never extrapolates.
 */
export function pickForecast(hours: ForecastHour[], target: Date): ForecastHour | null {
  if (!hours.length) return null;
  const t = target.getTime();
  const first = Date.parse(hours[0].time);
  const last = Date.parse(hours[hours.length - 1].time);
  if (t < first - 3600e3 || t > last + 3600e3) return null;
  let best = hours[0];
  for (const h of hours) if (Math.abs(Date.parse(h.time) - t) < Math.abs(Date.parse(best.time) - t)) best = h;
  return best;
}

export function forecastText(h: ForecastHour): string {
  const time = new Intl.DateTimeFormat("fi-FI", { timeZone: "Europe/Helsinki", day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(h.time));
  const parts = [
    h.temperature != null ? `${h.temperature.toFixed(0)} °C` : null,
    h.symbol != null && SYMBOL_FI[h.symbol] ? SYMBOL_FI[h.symbol] : null,
    h.wind != null ? `tuuli ${h.wind.toFixed(0)} m/s` : null,
    h.precip != null ? `sade ${h.precip.toFixed(1)} mm/h` : null,
  ].filter(Boolean);
  return `${time}: ${parts.join(", ")}`;
}

/** Match time: `?date=` with optional `&time=hh:mm` (Helsinki), else now. */
export function matchTarget(search: string, now: Date): { at: Date; label: "match" | "now" } {
  const q = new URLSearchParams(search);
  const d = q.get("date") ?? "";
  const tm = /^(\d{1,2}):(\d{2})$/.exec(q.get("time") ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return { at: now, label: "now" };
  const hh = tm ? Number(tm[1]) : 12;
  const mm = tm ? Number(tm[2]) : 0;
  // Helsinki offset for that day (+2 or +3).
  const probe = new Date(`${d}T12:00:00Z`);
  const hel = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Helsinki", hour: "2-digit", hourCycle: "h23" }).format(probe));
  const offset = hel - 12;
  const at = new Date(Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10)), hh - offset, mm));
  return Number.isNaN(at.getTime()) ? { at: now, label: "now" } : { at, label: "match" };
}

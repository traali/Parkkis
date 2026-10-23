import type { FeatureCollection, Geometry } from "geojson";
import type { LatLon } from "./coverage";
import { fiRange } from "./signs";

/**
 * Where parking is allowed, taken only from the city's own parking-space data.
 * Paid and free spaces are "allowed" because the city says so; nothing is inferred
 * from a missing sign or a missing line.
 */
export const ALLOWED_CATEGORIES = ["paid", "free"] as const;
export const NO_INFO = "Ei tietoa";
export const ALLOWED_NEAR_M = 300;

type Props = Record<string, unknown>;
const str = (v: unknown) => (v === null || v === undefined ? "" : String(v).trim());

/** Time limit from `kesto`, or from the class name ("Kertamaksu enintään 4 tuntia"). Bare numbers without a unit are not guessed. */
export function timeLimit(p: Props): string {
  const kesto = str(p.kesto).split(/,\s*\(/)[0].trim();
  if (/\d/.test(kesto) && /[a-zäöå]/i.test(kesto)) return kesto.replace(/(\d)\s*(h|min)\b/i, (_m, d, u) => `${d} ${u.toLowerCase()}`);
  const m = str(p.luokka_nimi).match(/enintään\s+(\d+)\s*(h|tunti|tuntia)\b/i);
  if (m) return `enintään ${m[1]} h`;
  return NO_INFO;
}

export function payment(p: Props): string {
  if (p.category === "paid") return "Maksullinen";
  if (p.category === "free") return "Maksuton";
  return NO_INFO;
}

/** Only "Kyllä" when the city's class name tells drivers to use the disc; otherwise no claim. */
export function parkingDisc(p: Props): string {
  return /pysäköintikiek/i.test(str(p.luokka_nimi)) ? "Kyllä" : NO_INFO;
}

export function hours(p: Props): string {
  const v = str(p.voimassaolo);
  return v ? fiRange(v) : NO_INFO;
}

export interface FactRow {
  label: string;
  value: string;
}

/** Rows for the tap popup of a Helsinki parking space. */
export function parkingFacts(p: Props): FactRow[] {
  return [
    { label: "Maksu", value: payment(p) },
    { label: "Aikaraja", value: timeLimit(p) },
    { label: "Pysäköintikiekko", value: parkingDisc(p) },
    { label: "Voimassa", value: hours(p) },
  ];
}

export interface AllowedNear {
  paid: number;
  free: number;
  /** Sum of `paikat_ala` where the city gives it; areas without a count add nothing. */
  spaces: number;
  /** Espoo public parking areas (Yleinen pysäköintialue). */
  espoo: number;
}

type XY = [number, number];

/** Rings/lines of a geometry in local metres around `at` (equirectangular; fine at 300 m). */
function parts(g: Geometry, at: LatLon): { lines: XY[][]; polygons: XY[][][] } {
  const kx = 111320 * Math.cos((at.latitude * Math.PI) / 180);
  const ky = 110540;
  const xy = (c: number[]): XY => [(c[0] - at.longitude) * kx, (c[1] - at.latitude) * ky];
  const ring = (r: number[][]) => r.map(xy);
  switch (g.type) {
    case "Point":
      return { lines: [[xy(g.coordinates)]], polygons: [] };
    case "MultiPoint":
      return { lines: g.coordinates.map((c) => [xy(c)]), polygons: [] };
    case "LineString":
      return { lines: [ring(g.coordinates)], polygons: [] };
    case "MultiLineString":
      return { lines: g.coordinates.map(ring), polygons: [] };
    case "Polygon":
      return { lines: g.coordinates.map(ring), polygons: [g.coordinates.map(ring)] };
    case "MultiPolygon":
      return { lines: g.coordinates.flatMap((p) => p.map(ring)), polygons: g.coordinates.map((p) => p.map(ring)) };
    case "GeometryCollection": {
      const all = g.geometries.map((x) => parts(x, at));
      return { lines: all.flatMap((a) => a.lines), polygons: all.flatMap((a) => a.polygons) };
    }
    default:
      return { lines: [], polygons: [] };
  }
}

/** Distance from the origin to segment a–b, in metres. */
function segDist(a: XY, b: XY): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = dx * dx + dy * dy;
  const t = len ? Math.max(0, Math.min(1, -(a[0] * dx + a[1] * dy) / len)) : 0;
  return Math.hypot(a[0] + t * dx, a[1] + t * dy);
}

/** Even-odd test: is the origin inside this ring? */
function inRing(r: XY[]): boolean {
  let inside = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, yi] = r[i];
    const [xj, yj] = r[j];
    if (yi > 0 !== yj > 0 && 0 < ((xj - xi) * (0 - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Shortest distance from `at` to the whole geometry; 0 when `at` is inside a polygon. */
export function distanceTo(g: Geometry | null | undefined, at: LatLon): number {
  if (!g) return Number.POSITIVE_INFINITY;
  const { lines, polygons } = parts(g, at);
  for (const p of polygons) if (p.length && inRing(p[0]) && !p.slice(1).some(inRing)) return 0;
  let best = Number.POSITIVE_INFINITY;
  for (const l of lines) {
    if (l.length === 1) best = Math.min(best, Math.hypot(l[0][0], l[0][1]));
    for (let i = 1; i < l.length; i++) best = Math.min(best, segDist(l[i - 1], l[i]));
  }
  return best;
}

const near = (f: { geometry: Geometry | null }, at: LatLon, radius: number) => distanceTo(f.geometry, at) <= radius;

export function allowedNear(
  helsinki: FeatureCollection | null | undefined,
  espoo: FeatureCollection | null | undefined,
  at: LatLon,
  radius = ALLOWED_NEAR_M,
): AllowedNear {
  const out: AllowedNear = { paid: 0, free: 0, spaces: 0, espoo: 0 };
  for (const f of helsinki?.features ?? []) {
    const cat = f.properties?.category;
    if ((cat !== "paid" && cat !== "free") || !near(f, at, radius)) continue;
    if (cat === "paid") out.paid += 1;
    else out.free += 1;
    const n = Number(f.properties?.paikat_ala);
    if (Number.isFinite(n) && n > 0) out.spaces += n;
  }
  for (const f of espoo?.features ?? []) {
    if (f.properties?.class === "yleinenpysakointialue" && near(f, at, radius)) out.espoo += 1;
  }
  return out;
}

/** One line for the venue card. With no city data nearby it says "Ei tietoa", never that parking is allowed. */
export function allowedNearText(a: AllowedNear | null, radius = ALLOWED_NEAR_M): string {
  const head = `Sallittu pysäköinti ${radius} m säteellä:`;
  if (!a) return `${head} ${NO_INFO}.`;
  const parts: string[] = [];
  if (a.paid) parts.push(`${a.paid} maksullista`);
  if (a.free) parts.push(`${a.free} maksutonta`);
  const hel = parts.length
    ? `${parts.join(" ja ")} katupysäköintialuetta${a.spaces ? ` (${a.spaces} paikkaa)` : ""} Helsingin kaupungin aineistossa`
    : "";
  const esp = a.espoo ? `${a.espoo} ${a.espoo === 1 ? "yleinen pysäköintialue" : "yleistä pysäköintialuetta"} Espoon kaupungin aineistossa` : "";
  const body = [hel, esp].filter(Boolean).join(", ");
  return body ? `${head} ${body}.` : `${head} ${NO_INFO}. Tarkista kyltit paikan päällä.`;
}

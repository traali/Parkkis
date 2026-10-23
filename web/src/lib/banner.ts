// One banner at a time. Pure and self-contained (no imports) so the tests can transpile it alone.

export type BannerKind = "load-error" | "coverage" | "busy-day" | "plough" | "loading";
export type BannerTone = "danger" | "warn" | "info";

export interface Banner {
  kind: BannerKind;
  tone: BannerTone;
  text: string;
}

export interface BannerInput {
  /** The parking data failed to load at all. */
  loadError?: string | null;
  /** Honest note when the venue is outside the Helsinki street-parking data. */
  coverage?: string | null;
  /** City events near the venue on the match day. */
  busyDay?: string | null;
  /** A real, recent winter-maintenance run near the venue. */
  plough?: string | null;
  /** Still loading (only shown when nothing more important is). */
  loading?: string | null;
}

/** Priority order: what the parent must know first. */
export const BANNER_PRIORITY: BannerKind[] = ["load-error", "coverage", "busy-day", "plough", "loading"];

const TONE: Record<BannerKind, BannerTone> = {
  "load-error": "danger",
  coverage: "warn",
  "busy-day": "warn",
  plough: "info",
  loading: "info",
};

const FIELD: Record<BannerKind, keyof BannerInput> = {
  "load-error": "loadError",
  coverage: "coverage",
  "busy-day": "busyDay",
  plough: "plough",
  loading: "loading",
};

/** The single most important banner, or null. Never more than one. */
export function pickBanner(input: BannerInput): Banner | null {
  for (const kind of BANNER_PRIORITY) {
    const text = input[FIELD[kind]];
    if (typeof text === "string" && text.trim()) return { kind, tone: TONE[kind], text: text.trim() };
  }
  return null;
}

/** Plough is on by default only when a run near the venue is this recent. */
export const PLOUGH_RECENT_MIN = 12 * 60;

export function ploughOnByDefault(banner: { ageMin: number } | null | undefined): boolean {
  return !!banner && banner.ageMin <= PLOUGH_RECENT_MIN;
}

/**
 * OpenStreetMap parking points add little where the city's own data exists (Helsinki, Espoo):
 * they have no price or time limits and duplicate the official spaces. Show them only for venues
 * with no city data nearby, and only at close zoom.
 */
export const OSM_MIN_ZOOM = 15;

export function showOsmFor(coverage: { helsinki: boolean; espoo: number; osm: number } | null): boolean {
  return !!coverage && !coverage.helsinki && coverage.espoo === 0 && coverage.osm > 0;
}

/** Time limit as written in the city's data, without the duplicate Russian text ("30 min, (30 мин)" → "30 min"). */
export function timeLimitLabel(kesto: unknown): string {
  if (typeof kesto !== "string") return "";
  return kesto.split(/,\s*\(/)[0].trim();
}

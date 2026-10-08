/**
 * Cross-Repo Contract Adapter for Parkkis
 * Canonical Contracts v1.0.0
 *
 * No invented values: a ParkingRiskContract is only built from a real fine
 * count measured from Helsinki's open parking-fine data. Venues without such
 * a measurement get a deep link to the live map instead of made-up numbers.
 */

export const CONTRACT_VERSION = "1.0.0" as const;

export const PARKKIS_BASE_URL = "https://parkkis.pages.dev" as const;

export type SupportedSport = "football" | "volleyball" | "floorball" | "basketball" | "weather" | "other";

export interface ParkingRiskContract {
  venueSlug: string;
  venueName?: string;
  riskRating: number;
  riskRating1to10?: number;
  safetyCategory: "safe" | "moderate" | "trap";
  parkingZone?: string;
  zoneLabel?: string;
  walkDistanceMeters?: number;
  walkTimeMinutes?: number;
  deepLinkUrl: string;
  advisoryNote?: string;
  updatedAt?: string;
}

export interface CrossRepoQueryContract {
  theme?: string;
  embed?: boolean;
  parentOrigin?: string;
  targetId?: string;
}

/**
 * Deep link Pelipäivä uses: /venue/<encoded name>?lat=..&lon=..[&embed=true]
 */
export function buildParkingDeepLink(
  venueName: string,
  coords: { lat: number; lng: number },
  opts: { embed?: boolean; theme?: string } = {},
): string {
  const url = new URL(`/venue/${encodeURIComponent(venueName)}`, PARKKIS_BASE_URL);
  url.searchParams.set("lat", String(coords.lat));
  url.searchParams.set("lon", String(coords.lng));
  if (opts.embed) url.searchParams.set("embed", "true");
  if (opts.theme) url.searchParams.set("theme", opts.theme);
  return url.toString();
}

/** Same deterministic 1-10 scale the map uses for each parking space. */
export function riskRatingFromFineCount(fineCount: number): number {
  if (!Number.isFinite(fineCount) || fineCount < 0) throw new RangeError("fineCount must be >= 0");
  return Math.min(10, Math.ceil(1 + fineCount * 0.5));
}

/**
 * Builds the contract from a measured fine count near the venue.
 * Fields Parkkis cannot measure (zone, walking distance) are left out.
 */
export function calculateParkingRiskContract(
  venueSlug: string,
  venueName: string,
  coords: { lat: number; lng: number },
  measured: { fineCount: number; measuredAt: string },
): ParkingRiskContract {
  const risk = riskRatingFromFineCount(measured.fineCount);
  return {
    venueSlug,
    venueName,
    riskRating: risk,
    riskRating1to10: risk,
    safetyCategory: risk >= 7 ? "trap" : risk >= 4 ? "moderate" : "safe",
    deepLinkUrl: buildParkingDeepLink(venueName, coords, { embed: true }),
    advisoryNote: `${measured.fineCount} pysäköintivirhemaksua lähistöllä Helsingin avoimessa aineistossa. Tarkista aina kyltit.`,
    updatedAt: measured.measuredAt,
  };
}

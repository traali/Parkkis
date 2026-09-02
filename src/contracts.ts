/**
 * Cross-Repo Contract Adapter for Parkkis
 * Canonical Contracts v1.0.0
 */

export const CONTRACT_VERSION = "1.0.0" as const;

export type SupportedSport = "football" | "volleyball" | "floorball" | "basketball" | "other";

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
 * Transforms internal Parkkis data and coordinates into the canonical ParkingRiskContract.
 */
export function calculateParkingRiskContract(
  venueSlug: string,
  venueName: string,
  coords: { lat: number; lng: number }
): ParkingRiskContract {
  const isTrap = coords.lat > 60.17 && coords.lat < 60.19 && coords.lng > 24.93 && coords.lng < 24.96;
  const risk = isTrap ? 8 : 3;

  return {
    venueSlug,
    venueName,
    riskRating: risk,
    riskRating1to10: risk,
    safetyCategory: risk >= 7 ? "trap" : risk >= 4 ? "moderate" : "safe",
    parkingZone: isTrap ? "Maksullinen Vyöhyke 1" : "Pysäköintikiekko 2h / Maksuton",
    zoneLabel: isTrap ? "Zone 1 (Keskusta)" : "Zone 2/3 (Ilmainen/Kiekko)",
    walkDistanceMeters: 180,
    walkTimeMinutes: 3,
    deepLinkUrl: `https://parkkis.pages.dev/venue/${encodeURIComponent(venueSlug)}?lat=${coords.lat}&lon=${coords.lng}&embed=true`,
    updatedAt: new Date().toISOString(),
  };
}

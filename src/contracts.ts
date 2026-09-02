/**
 * Cross-Repo Contract Adapter for Parkkis (Helsinki Parking Intelligence)
 * Implements / re-exports the canonical contracts defined in contracts/index.ts.
 */

export type {
  SupportedSport,
  MatchdayContextContract,
  ParkingRiskContract,
  CrossRepoQueryContract
} from '../../contracts/index';

import type { ParkingRiskContract, CrossRepoQueryContract } from '../../contracts/index';

/**
 * Transforms internal Parkkis venue risk ratings into the canonical ParkingRiskContract.
 */
export function formatParkingRiskContract(data: {
  venueSlug: string;
  riskRating: number;
  parkingZone?: string;
  walkDistanceMeters?: number;
  walkTimeMinutes?: number;
  advisoryNote?: string;
  baseUrl?: string;
}): ParkingRiskContract {
  const base = data.baseUrl || 'https://parkkis.pages.dev';
  
  // Categorize risk on 1-10 scale
  let safetyCategory: 'safe' | 'moderate' | 'trap' = 'safe';
  if (data.riskRating >= 7) {
    safetyCategory = 'trap';
  } else if (data.riskRating >= 4) {
    safetyCategory = 'moderate';
  }

  return {
    venueSlug: data.venueSlug,
    riskRating: Math.min(10, Math.max(1, data.riskRating)),
    safetyCategory,
    parkingZone: data.parkingZone,
    walkDistanceMeters: data.walkDistanceMeters,
    walkTimeMinutes: data.walkTimeMinutes,
    deepLinkUrl: `${base}/venue/${data.venueSlug}?theme=night-captain`,
    advisoryNote: data.advisoryNote,
    updatedAt: new Date().toISOString()
  };
}

/**
 * Parses incoming query params according to CrossRepoQueryContract.
 */
export function parseIncomingCrossRepoQuery(searchParams: URLSearchParams): CrossRepoQueryContract {
  return {
    theme: searchParams.get('theme') || 'night-captain',
    embed: searchParams.get('embed') === 'true',
    parentOrigin: searchParams.get('parentOrigin') || undefined,
    targetId: searchParams.get('targetId') || searchParams.get('venue') || undefined
  };
}

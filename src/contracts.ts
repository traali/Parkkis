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

interface CuratedArenaPreset {
  venueName: string;
  riskRating: number;
  safetyCategory: "safe" | "moderate" | "trap";
  parkingZone: string;
  zoneLabel: string;
  walkDistanceMeters: number;
  walkTimeMinutes: number;
  advisoryNote: string;
}

const ARENA_PRESETS: Record<string, CuratedArenaPreset> = {
  otahalli: {
    venueName: "Otahalli Espoo",
    riskRating: 2,
    safetyCategory: "safe",
    parkingZone: "Pysäköintikiekko 4h (Maksuton)",
    zoneLabel: "Otahallin P-alue (Luolamiehentie)",
    walkDistanceMeters: 120,
    walkTimeMinutes: 2,
    advisoryNote: "Ilmainen 4h kiekkopysäköinti hallin pohjoispuolella. Muista asettaa kiekko tuulilasille!",
  },
  vaiski: {
    venueName: "Töölön Pallokenttä / Väiski / Bubu",
    riskRating: 7,
    safetyCategory: "moderate",
    parkingZone: "Maksullinen Vyöhyke 2 (klo 9-21)",
    zoneLabel: "Urheilukatu & Stadionin P-alue",
    walkDistanceMeters: 180,
    walkTimeMinutes: 3,
    advisoryNote: "Korkea valvontatiheys viikonloppuisin. Maksa EasyParkilla tai hyödynnä Pohjoisen Stadiontien kiekkopaikat.",
  },
  "esport-center": {
    venueName: "Esport Center / Ratiopharm Tapiola",
    riskRating: 2,
    safetyCategory: "safe",
    parkingZone: "Pysäköintikiekko 3h",
    zoneLabel: "Tapiolan Urheilupuiston P-alue",
    walkDistanceMeters: 90,
    walkTimeMinutes: 1,
    advisoryNote: "Runsaasti ilmaista tilaa hallin edessä. 3h kiekkorajoitus riittää mainiosti otteluun.",
  },
  "arena-center-hakaniemi": {
    venueName: "Arena Center Hakaniemi",
    riskRating: 6,
    safetyCategory: "moderate",
    parkingZone: "Maksullinen Vyöhyke 1 / P-Kallio",
    zoneLabel: "Haapaniemenkatu & P-Kallio halli",
    walkDistanceMeters: 80,
    walkTimeMinutes: 1,
    advisoryNote: "Pysäköi maanalaiseen P-Kallioon sateelta suojaan tai käytä metroa/ratikkaa Hakaniemen torilta.",
  },
  kisakallio: {
    venueName: "Kisakallion Urheiluopisto Lohja",
    riskRating: 1,
    safetyCategory: "safe",
    parkingZone: "Ilmainen (Rajoittamaton)",
    zoneLabel: "Päärakennuksen P-alue",
    walkDistanceMeters: 50,
    walkTimeMinutes: 1,
    advisoryNote: "Laaja maksuton pysäköinti pääovien välittömässä läheisyydessä.",
  },
};

/**
 * Transforms internal Parkkis data and coordinates into the canonical ParkingRiskContract.
 */
export function calculateParkingRiskContract(
  venueSlug: string,
  venueName: string,
  coords: { lat: number; lng: number }
): ParkingRiskContract {
  const normSlug = venueSlug.toLowerCase().replace(/[^a-z0-9]/g, "");

  // 1. Check if matches a curated arena preset
  for (const [key, preset] of Object.entries(ARENA_PRESETS)) {
    if (normSlug.includes(key.replace(/[^a-z0-9]/g, "")) || venueName.toLowerCase().includes(key)) {
      return {
        venueSlug,
        venueName: preset.venueName,
        riskRating: preset.riskRating,
        riskRating1to10: preset.riskRating,
        safetyCategory: preset.safetyCategory,
        parkingZone: preset.parkingZone,
        zoneLabel: preset.zoneLabel,
        walkDistanceMeters: preset.walkDistanceMeters,
        walkTimeMinutes: preset.walkTimeMinutes,
        advisoryNote: preset.advisoryNote,
        deepLinkUrl: `https://parkkis.pages.dev/venue/${encodeURIComponent(venueSlug)}?lat=${coords.lat}&lon=${coords.lng}&embed=true`,
        updatedAt: new Date().toISOString(),
      };
    }
  }

  // 2. Spatial heuristic fallback
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
    advisoryNote: isTrap
      ? "Korkean valvontariskin keskusta-alue. Maksa pysäköintisovelluksella heti autosta poistuttaessa."
      : "Rauhallinen pysäköintialue. Tarkista kiekkorajoitus tai maksullisuus liikennemerkistä.",
    deepLinkUrl: `https://parkkis.pages.dev/venue/${encodeURIComponent(venueSlug)}?lat=${coords.lat}&lon=${coords.lng}&embed=true`,
    updatedAt: new Date().toISOString(),
  };
}

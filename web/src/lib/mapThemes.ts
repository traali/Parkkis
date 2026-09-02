export type ThemeType = "dark" | "light" | "forest";

export const THEME_CONFIGS = {
  dark: {
    mapStyle: "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json",
    colors: {
      paid: "#3b82f6",
      residential: "#ffb800",
      free: "#22c55e",
      special: "#a855f7",
      other: "#888888",
      glowLow: "#00f2ff",
      glowMid: "#ffcf4b",
      glowHigh: "#ff3e3e",
    }
  },
  light: {
    mapStyle: "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json",
    colors: {
      paid: "#1d4ed8",
      residential: "#d97706",
      free: "#16a34a",
      special: "#7c3aed",
      other: "#4b5563",
      glowLow: "#0891b2",
      glowMid: "#d97706",
      glowHigh: "#dc2626",
    }
  },
  forest: {
    mapStyle: "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json",
    colors: {
      paid: "#10b981",
      residential: "#f59e0b",
      free: "#34d399",
      special: "#8b5cf6",
      other: "#4b5563",
      glowLow: "#10b981",
      glowMid: "#f59e0b",
      glowHigh: "#ef4444",
    }
  }
};

export const CATEGORIES = [
  { id: "all", label: "All Slots" },
  { id: "residential", label: "Residential" },
  { id: "paid", label: "Paid" },
  { id: "free", label: "Free" },
  { id: "special", label: "Special (EV/Inva)" },
];

export const getCategoryLabel = (category: string, luokka: string = "") => {
  if (category === "residential") return "Resident Permit Parking (Asukaspysäköinti)";
  if (category === "paid") return "Paid Parking (Maksullinen)";
  if (category === "free") return "Free Parking (Ilmainen)";
  if (category === "special") return "Special Parking (EV/Disabled)";
  return luokka || "Standard Parking";
};

export const getSignLabel = (type: string) => {
  const labels: Record<string, string> = {
    C37: "No Stopping",
    C38: "No Parking",
    C39: "No Parking Zone Starts",
    C40: "No Parking Zone Ends",
    C32: "Speed Limit",
    C34: "Speed Limit Zone",
    E2: "Parking Place",
    E3: "Parking Place",
    "E3.1": "Parking Place (Time Limit)",
    "E4.1": "Taxi Stand",
    H19: "Time Limit",
    H24: "Except with Resident Permit",
    H25: "For Maintenance Only",
  };
  return labels[type] || type;
};

export const getSignVisuals = (type: string) => {
  const t = String(type).trim().toUpperCase();

  if (/^C37/.test(t)) {
    return { emoji: "🛑", colorClass: "border-l-4 border-nc-neon-red bg-nc-neon-red/10", textClass: "text-nc-neon-red" };
  }
  if (/^(C38|C39|C40|C44)/.test(t)) {
    return { emoji: "🚫", colorClass: "border-l-4 border-nc-neon-red bg-nc-neon-red/10", textClass: "text-nc-neon-red" };
  }
  if (/^C/.test(t)) {
    return { emoji: "🚫", colorClass: "border-l-4 border-nc-neon-red bg-nc-neon-red/10", textClass: "text-nc-neon-red" };
  }
  if (/^(E2|E3)/.test(t)) {
    return { emoji: "🅿️", colorClass: "border-l-4 border-nc-neon-teal bg-nc-neon-teal/10", textClass: "text-nc-neon-teal" };
  }
  if (/^E4/.test(t)) {
    return { emoji: "🚕", colorClass: "border-l-4 border-nc-gold bg-nc-gold/10", textClass: "text-nc-gold" };
  }
  if (/^H12\.7/.test(t)) {
    return { emoji: "♿", colorClass: "border-l-4 border-nc-purple bg-nc-purple/10", textClass: "text-nc-purple" };
  }
  if (/^H12\.9/.test(t)) {
    return { emoji: "🔌", colorClass: "border-l-4 border-nc-neon-teal bg-nc-neon-teal/10", textClass: "text-nc-neon-teal" };
  }
  if (/^H12/.test(t)) {
    return { emoji: "🚗", colorClass: "border-l-4 border-nc-text/30 bg-nc-text/5", textClass: "text-nc-text" };
  }
  if (/^H(17|18)/.test(t)) {
    return { emoji: "↔️", colorClass: "border-l-4 border-nc-text/30 bg-nc-text/5", textClass: "text-nc-text" };
  }
  if (/^H19/.test(t)) {
    return { emoji: "🕒", colorClass: "border-l-4 border-nc-neon-teal bg-nc-neon-teal/10", textClass: "text-nc-neon-teal" };
  }
  if (/^H24/.test(t)) {
    return { emoji: "🎫", colorClass: "border-l-4 border-nc-purple bg-nc-purple/10", textClass: "text-nc-purple" };
  }
  if (/^H25/.test(t)) {
    return { emoji: "🛠️", colorClass: "border-l-4 border-nc-gold bg-nc-gold/10", textClass: "text-nc-gold" };
  }

  return { emoji: "ℹ️", colorClass: "border-l-4 border-nc-text/30 bg-nc-text/5", textClass: "text-nc-text" };
};

export const parseJsonSafe = (str: unknown) => {
  if (!str) return null;
  try {
    return JSON.parse(String(str));
  } catch {
    return null;
  }
};

export const safeGeoJSON = (data: unknown) => {
  return JSON.parse(
    JSON.stringify(data, (_, v) => (typeof v === "bigint" ? Number(v) : v)),
  );
};

export const getCentroid = (geometry: any): [number, number] | null => {
  if (!geometry) return null;
  try {
    if (geometry.type === "Point") {
      return geometry.coordinates as [number, number];
    }
    if (geometry.type === "Polygon") {
      const coords = geometry.coordinates[0];
      let sumLng = 0;
      let sumLat = 0;
      for (const c of coords) {
        sumLng += c[0];
        sumLat += c[1];
      }
      return [sumLng / coords.length, sumLat / coords.length];
    }
    if (geometry.type === "MultiPolygon") {
      const coords = geometry.coordinates[0][0];
      let sumLng = 0;
      let sumLat = 0;
      for (const c of coords) {
        sumLng += c[0];
        sumLat += c[1];
      }
      return [sumLng / coords.length, sumLat / coords.length];
    }
  } catch {
    return null;
  }
  return null;
};

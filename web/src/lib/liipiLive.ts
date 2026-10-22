// Fintraffic park-and-ride live utilisation (parking.fintraffic.fi, CC BY 4.0), via /api/liipi-utilization.
// A count is called "live" only when its own timestamp is fresh; older rows show their age instead.
export const LIVE_MAX_AGE_MIN = 20;

export interface Utilization { facilityId: number; capacityType: string; usage?: string; timestamp: string; spacesAvailable: number; capacity?: number; openNow?: boolean }
export interface LiveRow { capacityType: string; spacesAvailable: number; capacity: number | null; ageMin: number; fresh: boolean; timestamp: string; openNow: boolean | null }

export function rowsFor(all: Utilization[], facilityId: number, now: Date): LiveRow[] {
  return all
    .filter((u) => Number(u.facilityId) === facilityId && Number.isFinite(u.spacesAvailable) && !Number.isNaN(Date.parse(u.timestamp)))
    .map((u) => {
      const ageMin = Math.max(0, Math.round((now.getTime() - Date.parse(u.timestamp)) / 60000));
      return {
        capacityType: u.capacityType,
        spacesAvailable: u.spacesAvailable,
        capacity: Number.isFinite(u.capacity) ? (u.capacity as number) : null,
        ageMin,
        fresh: ageMin <= LIVE_MAX_AGE_MIN,
        timestamp: u.timestamp,
        openNow: typeof u.openNow === "boolean" ? u.openNow : null,
      };
    });
}

export function ageText(min: number): string {
  if (min < 60) return `${min} min sitten`;
  if (min < 48 * 60) return `${Math.round(min / 60)} h sitten`;
  return `${Math.round(min / 1440)} vrk sitten`;
}

let cache: { at: number; p: Promise<Utilization[]> } | null = null;
export function fetchUtilizations(f: typeof fetch = fetch, now = Date.now()): Promise<Utilization[]> {
  if (cache && now - cache.at < 60_000) return cache.p;
  const p = f("/api/liipi-utilization").then(async (r) => {
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    if (!(r.headers?.get?.("content-type") ?? "json").includes("json")) throw new Error("not JSON");
    const d = await r.json();
    if (!Array.isArray(d)) throw new Error("unexpected shape");
    return d as Utilization[];
  });
  cache = { at: now, p };
  p.catch(() => { cache = null; });
  return p;
}

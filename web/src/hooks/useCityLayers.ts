import { useCallback, useRef, useState } from "react";
import type { FeatureCollection } from "geojson";
import {
  COACH_QUERY, PAY_ZONE_QUERY, RESIDENT_ZONE_QUERY, accessQuery, contractorQuery, cyclingQueries, eventsQuery, fmiUrl, helFetch,
  leaseQueries, parseFmi, toAccess, toCoach, toContractors, toCycling, toEvents, toLeases, toZones,
  type Bbox, type CityLayerId, type Contractor, type ForecastHour,
} from "../lib/cityLayers";

export type LoadStatus = "idle" | "loading" | "ready" | "empty" | "error";
export interface LayerState { status: LoadStatus; data: FeatureCollection | null }

const IDLE: LayerState = { status: "idle", data: null };

/** Optional city layers: nothing is fetched until a toggle (or a venue link) asks for it. */
export function useCityLayers(date: string) {
  const [layers, setLayers] = useState<Record<CityLayerId, LayerState>>({
    events: IDLE, leases: IDLE, coach: IDLE, cycling: IDLE, access: IDLE, zones: IDLE,
  });
  const inflight = useRef(new Map<CityLayerId, Promise<FeatureCollection | null>>());
  const lineBbox = useRef<Record<string, string>>({});

  const load = useCallback((id: CityLayerId, bbox: Bbox): Promise<FeatureCollection | null> => {
    const key = `${bbox.minLon.toFixed(3)},${bbox.minLat.toFixed(3)},${bbox.maxLon.toFixed(3)},${bbox.maxLat.toFixed(3)}`;
    const bboxBound = id === "cycling" || id === "access";
    const existing = inflight.current.get(id);
    if (existing && (!bboxBound || lineBbox.current[id] === key)) return existing;
    lineBbox.current[id] = key;
    setLayers((l) => ({ ...l, [id]: { status: "loading", data: l[id].data } }));
    const run = async (): Promise<FeatureCollection> => {
      switch (id) {
        case "events": return toEvents(await helFetch(eventsQuery(date)), date);
        case "leases": return toLeases((await Promise.all(leaseQueries(date).map((q) => helFetch(q)))).flat());
        case "coach": return toCoach(await helFetch(COACH_QUERY));
        case "cycling": return toCycling((await Promise.all(cyclingQueries(bbox).map((q) => helFetch(q)))).flat());
        case "access": return toAccess(await helFetch(accessQuery(bbox)));
        case "zones": {
          const [pay, res] = await Promise.all([helFetch(PAY_ZONE_QUERY), helFetch(RESIDENT_ZONE_QUERY)]);
          return toZones(pay, res);
        }
      }
    };
    const p = run()
      .then((fc) => {
        setLayers((l) => ({ ...l, [id]: { status: fc.features.length ? "ready" : "empty", data: fc } }));
        return fc;
      })
      .catch((e) => {
        console.warn(`City layer ${id} failed`, e);
        inflight.current.delete(id);
        setLayers((l) => ({ ...l, [id]: { status: "error", data: null } }));
        return null;
      });
    inflight.current.set(id, p);
    return p;
  }, [date]);

  const [contractors, setContractors] = useState<{ status: LoadStatus; list: Contractor[] }>({ status: "idle", list: [] });
  const loadContractors = useCallback((lat: number, lon: number, today: string) => {
    setContractors({ status: "loading", list: [] });
    helFetch(contractorQuery(lat, lon))
      .then((f) => {
        const list = toContractors(f, lat, lon, today);
        setContractors({ status: list.length ? "ready" : "empty", list });
      })
      .catch((e) => { console.warn("Contractor lookup failed", e); setContractors({ status: "error", list: [] }); });
  }, []);

  const [forecast, setForecast] = useState<{ status: LoadStatus; hours: ForecastHour[] }>({ status: "idle", hours: [] });
  const loadForecast = useCallback((lat: number, lon: number) => {
    setForecast({ status: "loading", hours: [] });
    fetch(fmiUrl(lat, lon))
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.text(); })
      .then((xml) => { const hours = parseFmi(xml); setForecast({ status: hours.length ? "ready" : "empty", hours }); })
      .catch((e) => { console.warn("FMI forecast failed", e); setForecast({ status: "error", hours: [] }); });
  }, []);

  return { layers, load, contractors, loadContractors, forecast, loadForecast };
}

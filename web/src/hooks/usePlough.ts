import { useCallback, useEffect, useRef, useState } from "react";
import { fetchHelPriority, fetchWinterMaintenance, type Bbox, type PloughFC, type PloughStatus } from "../lib/plough";

/** Lazily loads (network only on demand) Digitraffic winter-maintenance routes; nothing is fetched until `load` is called. */
export function usePlough() {
  const [data, setData] = useState<PloughFC | null>(null);
  const [status, setStatus] = useState<PloughStatus>("idle");
  const [failed, setFailed] = useState<("state" | "espoo")[]>([]);
  const seq = useRef(0);
  const [helPriority, setHelPriority] = useState<Awaited<ReturnType<typeof fetchHelPriority>> | null>(null);
  const [helStatus, setHelStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const loadHel = useCallback(() => {
    if (helStatus !== "idle") return;
    setHelStatus("loading");
    fetchHelPriority()
      .then((fc) => { setHelPriority(fc); setHelStatus("ready"); })
      .catch((e) => { console.warn("Helsinki winter routes failed", e); setHelStatus("error"); });
  }, [helStatus]);
  const load = useCallback(async (b: Bbox) => {
    const id = ++seq.current;
    setStatus("loading");
    try {
      const { fc, failed: f } = await fetchWinterMaintenance(b, new Date());
      if (id !== seq.current) return;
      setData(fc);
      setFailed(f);
      setStatus(fc.features.length ? "ready" : "empty");
    } catch (e) {
      if (id !== seq.current) return;
      console.warn("Plough data failed", e);
      setData(null);
      setStatus("error");
    }
  }, []);
  useEffect(() => () => { seq.current++; }, []);
  return { ploughData: data, ploughStatus: status, ploughFailed: failed, loadPlough: load, helPriority, helStatus, loadHel };
}

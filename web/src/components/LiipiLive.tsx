import { useEffect, useState } from "react";
import { ageText, fetchUtilizations, rowsFor, type LiveRow } from "../lib/liipiLive";

const TYPE_FI: Record<string, string> = { CAR: "Autot", ELECTRIC_CAR: "Sähköautot", DISABLED: "Liikkumisesteiset", BICYCLE: "Pyörät", BICYCLE_SECURE_SPACE: "Pyörät (lukittu)", MOTORCYCLE: "Moottoripyörät" };

/** Fetched only when a park-and-ride popup is opened. */
export function LiipiLive({ facilityId }: { facilityId: number }) {
  const [state, setState] = useState<{ status: "loading" | "ready" | "none" | "error"; rows: LiveRow[] }>({ status: "loading", rows: [] });
  useEffect(() => {
    let alive = true;
    fetchUtilizations()
      .then((all) => { if (!alive) return; const rows = rowsFor(all, facilityId, new Date()); setState({ status: rows.length ? "ready" : "none", rows }); })
      .catch((e) => { console.warn("Fintraffic utilization failed", e); if (alive) setState({ status: "error", rows: [] }); });
    return () => { alive = false; };
  }, [facilityId]);
  return (
    <div data-testid="liipi-live" className="bg-nc-text/5 border border-nc-border/40 rounded-xl p-3 space-y-1 text-xs">
      {state.status === "loading" && <span className="text-nc-text-muted">Haetaan käyttöastetta…</span>}
      {state.status === "error" && <span className="text-nc-danger">Käyttöasteen haku epäonnistui.</span>}
      {state.status === "none" && <span className="text-nc-text-muted">Tälle paikalle ei julkaista käyttöastetta.</span>}
      {state.status === "ready" && state.rows.map((r) => (
        <div key={r.capacityType} className="flex items-center justify-between gap-2">
          <span className="text-nc-text-muted">{TYPE_FI[r.capacityType] ?? r.capacityType}</span>
          <span className="font-bold text-nc-text text-right">
            {r.fresh ? <span data-testid="liipi-live-badge" className="text-nc-neon-teal">● Live </span> : null}
            vapaana {r.spacesAvailable}{r.capacity != null ? ` / ${r.capacity}` : ""}
            <span className={`block text-[10px] font-normal ${r.fresh ? "text-nc-text-dim" : "text-nc-gold"}`}>
              {r.fresh ? `päivitetty ${ageText(r.ageMin)}` : `vanha tieto, päivitetty ${ageText(r.ageMin)}`}
              {r.openNow === false ? " · suljettu nyt" : ""}
            </span>
          </span>
        </div>
      ))}
      <span className="block text-[9px] text-nc-text-dim">Käyttöaste: Fintraffic / parking.fintraffic.fi (CC BY 4.0).</span>
    </div>
  );
}
